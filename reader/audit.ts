/** Explicit, bounded live QA; never part of npm test or daily collection. */
import { mkdir, writeFile } from "node:fs/promises";
import { METHODS, methodUrl, type MethodId } from "./methods.ts";
import { fetchHtmlWithRedirects } from "./fetch.ts";
import { parseArticleResponse } from "./response.ts";
import { isSubstantial, looksLikeShell } from "./extract.ts";
import { networkErrorDetails, outboundProxyActive, outboundProxyUrls, proxyBypassed, publicUrl } from "../src/lib/runtime/network.ts";

const args = process.argv.slice(2);
if (!args.length || args[0] === "--help") {
  console.log("Usage: npm run reader:audit -- --live <article-url> [method,method,...]\nUses configured proxies except exact wallhop.io/freedium-mirror.cfd hosts. One attempt per method, two workers, existing deadlines/byte limits. Writes metadata only to docs/qa/method-audit/latest.json; no article bodies or credentials.");
} else {
  try {
    if (args[0] !== "--live" || !args[1] || args.length > 3) throw new Error();
    const article = publicUrl(args[1]);
    if (!outboundProxyActive()) throw new Error();
    // Refuse an audit with different routing rather than silently changing env.
    const bypass = ["wallhop.io", "freedium-mirror.cfd"];
    const configured = (process.env.OUTBOUND_PROXY_BYPASS_HOSTS || "").split(",").map(s => s.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
    if (bypass.some(host => !configured.includes(host)) || configured.some(host => !bypass.includes(host))) throw new Error();
    const selected = args[2]?.split(",") ?? Object.keys(METHODS);
    if (!selected.length || selected.some(method => !Object.hasOwn(METHODS, method)) || new Set(selected).size !== selected.length) throw new Error();
    process.env.FETCH_RETRY_LIMIT = "0";
    const queue = [...selected] as MethodId[];
    const results: Record<string, unknown>[] = [];
    async function worker() {
      while (queue.length) {
        const method = queue.shift()!;
        const requested = methodUrl(method, article.href);
        const start = Date.now();
        const result: Record<string, unknown> = {
          method,
          initialTransport: proxyBypassed(new URL(requested)) ? "direct" : "proxy",
        };
        try {
          const response = await fetchHtmlWithRedirects(requested, method, start + 25_000);
          const parsed = parseArticleResponse(response.html, response.finalUrl, method);
          const shell = parsed ? looksLikeShell(parsed.title, parsed.text) : false;
          const serviceError = /\bcode:"(UNSUPPORTED_SITE|UPSTREAM_BLOCKED|ARTICLE_NOT_FOUND)"/.exec(response.html)?.[1];
          Object.assign(result, {
            outcome: serviceError ? "service-error" : !parsed ? "no-article" : shell ? "shell" : isSubstantial(parsed.text) ? "substantial" : "partial",
            serviceError,
            finalOrigin: new URL(response.finalUrl).origin,
            finalTransport: proxyBypassed(new URL(response.finalUrl)) ? "direct" : "proxy",
            bytes: Buffer.byteLength(response.html),
            characters: parsed?.text.length ?? 0,
          });
        } catch (error) {
          const http = error instanceof Error ? /^HTTP ([1-5]\d{2})$/.exec(error.message) : null;
          Object.assign(result, { outcome: "failed", httpStatus: http ? Number(http[1]) : null, ...networkErrorDetails(error) });
        }
        result.durationMs = Date.now() - start;
        results.push(result);
        console.log(JSON.stringify(result));
      }
    }
    await Promise.all([worker(), worker()]);
    const report = { at: new Date().toISOString(), articleOrigin: article.origin, proxyAccounts: outboundProxyUrls().length, retries: 0, results: selected.map(method => results.find(result => result.method === method)) };
    await mkdir("docs/qa/method-audit", { recursive: true });
    await writeFile("docs/qa/method-audit/latest.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    // Availability failures are reported, not hidden by an always-success exit.
    if (results.some(result => result.outcome !== "substantial")) process.exitCode = 2;
  } catch {
    console.error("Audit refused: use --live <public-article-url> [known,distinct,methods], an enabled configured proxy, and only wallhop.io,freedium-mirror.cfd as bypass hosts. No credentials or supplied arguments are logged.");
    process.exitCode = 1;
  }
}
