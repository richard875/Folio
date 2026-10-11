import { hashMatches } from "./auth";
import { isSubstantial, looksLikeShell, parseArticleHtml, toMarkdown, userAgentFor } from "./extract";
import { assertPublicHttpUrl, probeList } from "./targets";
import type { ArticleResult, Attempt } from "./types";

const CACHE = new Map<string, { at: number; result: ArticleResult }>();
const CACHE_MS = 30 * 60 * 1000;
const MAX_CACHE = 40;
const ATTEMPT_MS = 12_000;
const BUDGET_MS = 48_000;
const MAX_BYTES = 1_800_000;

const HITS: number[] = [];

function rateOk(): boolean {
  const now = Date.now();
  while (HITS.length && now - HITS[0] > 60_000) HITS.shift();
  if (HITS.length >= 24) return false;
  HITS.push(now);
  return true;
}

async function pull(url: string, method: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(ATTEMPT_MS),
    headers: {
      "user-agent": userAgentFor(method),
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (type && !/html|text|json|xml/i.test(type)) throw new Error(`Unsupported type ${type}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new Error("Response too large");
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

export async function readArticle(rawUrl: string, hash: string | null): Promise<ArticleResult> {
  if (!hashMatches(hash)) {
    const err = new Error("Unauthorized");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  if (!rateOk()) {
    const err = new Error("Too many requests. Wait a minute.");
    (err as Error & { status: number }).status = 429;
    throw err;
  }

  const original = assertPublicHttpUrl(rawUrl.trim()).href;
  const cached = CACHE.get(original);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;

  const started = Date.now();
  const attempts: Attempt[] = [];
  let best: ArticleResult | null = null;

  for (const probe of probeList(original)) {
    if (Date.now() - started > BUDGET_MS) {
      attempts.push({ method: probe.method, url: probe.url, ok: false, note: "time budget" });
      break;
    }
    try {
      assertPublicHttpUrl(probe.url);
      const html = await pull(probe.url, probe.method);
      const parsed = parseArticleHtml(html, probe.url);
      if (!parsed || looksLikeShell(parsed.title, parsed.text)) {
        attempts.push({ method: probe.method, url: probe.url, ok: false, note: parsed ? "service shell" : "no article text" });
        continue;
      }
      const partial = !isSubstantial(parsed.text);
      const draft: ArticleResult = {
        title: parsed.title,
        author: parsed.author,
        published: parsed.published,
        originalUrl: original,
        method: probe.method,
        methodUrl: probe.url,
        text: parsed.text,
        images: parsed.images,
        partial,
        markdown: "",
      };
      draft.markdown = toMarkdown(draft);
      attempts.push({
        method: probe.method,
        url: probe.url,
        ok: !partial,
        note: partial ? `${parsed.text.length} chars, short` : `${parsed.text.length} chars`,
      });
      if (!best || parsed.text.length > best.text.length) best = draft;
      if (!partial) break;
    } catch (error) {
      const note = error instanceof Error ? error.message : "failed";
      attempts.push({ method: probe.method, url: probe.url, ok: false, note });
    }
  }

  if (!best) {
    const err = new Error(
      `Could not extract an article. Tried: ${attempts.map((a) => `${a.method} (${a.note})`).join("; ")}`,
    );
    (err as Error & { status: number }).status = 422;
    throw err;
  }

  if (CACHE.size >= MAX_CACHE) {
    const oldest = [...CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) CACHE.delete(oldest[0]);
  }
  CACHE.set(original, { at: Date.now(), result: best });
  return best;
}

export function statusOf(error: unknown): number {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return 500;
}
