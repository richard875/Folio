import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { buildProbeList } from "./targets.ts";
import { METHODS, METHOD_DEFAULTS, methodDefinition, userAgentFor } from "./methods.ts";
import { DEFAULT_ORDER, PUBLISHERS } from "./retrieval.config.ts";

// Independent expectations: do not import the fallback list to compute them.
const FALLBACK = [
  "freedium-mirror-encoded", "archive.is-newest", "archive.today", "archive.ph",
  "archive.is", "removepaywalls", "removepaywall", "removepaywall-co", "wayback",
  "wayback-id", "jina-http", "jina-https", "jina-enc", "textise-dot-iitty", "smry",
  "12ft", "googlebot", "direct-bingbot", "direct-facebook", "direct-twitter",
];
const FIRST = ["wsj.com", "foreignpolicy.com", "cnbc.com"];
const SECOND = ["nytimes.com", "washingtonpost.com", "bloomberg.com", "economist.com", "ft.com", "reuters.com", "businessinsider.com"];

describe("declarative retrieval configuration", () => {
  it("preserves every publisher's complete order, with and without a configured proxy", () => {
    assert.deepEqual(Object.keys(PUBLISHERS).sort(), [...FIRST, ...SECOND].sort());
    for (const proxyActive of [false, true]) {
      for (const host of [...FIRST, ...SECOND]) {
        const first = FIRST.includes(host);
        const expected = proxyActive
          ? first ? ["wallhop", "direct", "freedium-mirror", ...FALLBACK] : ["direct", "wallhop", "freedium-mirror", ...FALLBACK]
          : first ? ["wallhop", "freedium-mirror", ...FALLBACK] : ["freedium-mirror", "wallhop", ...FALLBACK];
        for (const prefix of ["", "www.", "WWW."]) {
          const probes = buildProbeList(`https://${prefix}${host}/story?edition=us`, proxyActive);
          assert.deepEqual(probes.map((probe) => probe.method), expected);
        }
      }
    }
  });

  it("keeps the generic fallback and does not match publisher subdomains or lookalikes", () => {
    for (const host of ["example.com", "wsj.com.example.com", "notwsj.com", "news.wsj.com", "constructor"]) {
      for (const proxyActive of [false, true]) {
        assert.deepEqual(buildProbeList(`https://${host}/story`, proxyActive).map((probe) => probe.method),
          [...(proxyActive ? ["direct"] : []), "freedium-mirror", ...FALLBACK]);
      }
    }
  });

  it("has only known, nonduplicated methods and well-formed URL placeholders in all editable lists", () => {
    for (const order of [DEFAULT_ORDER, ...Object.values(PUBLISHERS)]) {
      for (const methods of [order.withProxy, order.withoutProxy]) {
        assert.equal(new Set(methods).size, methods.length);
        for (const method of methods) assert.ok(Object.hasOwn(METHODS, method));
      }
    }
    for (const definition of Object.values(METHODS)) {
      assert.ok(definition.name);
      assert.ok(/\{(?:url|encodedUrl|urlWithoutProtocol)\}/.test(definition.url));
      assert.doesNotMatch(definition.url.replace(/\{(?:url|encodedUrl|urlWithoutProtocol)\}/g, ""), /[{}]/);
    }
  });

  it("preserves every service URL including encoded variants, query strings and fragments", () => {
    for (const protocol of ["http", "https"]) {
      const url = `${protocol}://www.wsj.com/economy/story?mod=hp&item=a%20b#section`;
      const enc = encodeURIComponent(url);
      const noProto = url.replace(/^https?:\/\//, "");
      const expected = [
        ["wallhop", `https://wallhop.io/${url}`], ["direct", url],
        ["freedium-mirror", `https://freedium-mirror.cfd/${url}`],
        ["freedium-mirror-encoded", `https://freedium-mirror.cfd/${enc}`],
        ["archive.is-newest", `https://archive.is/newest/${url}`],
        ["archive.today", `https://archive.today/latest/${url}`],
        ["archive.ph", `https://archive.ph/${url}`], ["archive.is", `https://archive.is/${url}`],
        ["removepaywalls", `https://removepaywalls.com/${url}`],
        ["removepaywall", `https://www.removepaywall.com/search?url=${enc}`],
        ["removepaywall-co", `https://removepaywall.co/${url}`],
        ["wayback", `https://web.archive.org/web/2/${url}`], ["wayback-id", `https://web.archive.org/web/2id_/${url}`],
        ["jina-http", `https://r.jina.ai/http://${noProto}`], ["jina-https", `https://r.jina.ai/https://${noProto}`],
        ["jina-enc", `https://r.jina.ai/http://${enc}`],
        ["textise-dot-iitty", `https://r.jina.ai/http://cc.bingj.com/cache.aspx?d=503-123&u=${enc}`],
        ["smry", `https://smry.ai/${url}`], ["12ft", `https://12ft.io/${url}`],
        ["googlebot", url], ["direct-bingbot", url], ["direct-facebook", url], ["direct-twitter", url],
      ].map(([method, url]) => ({ method, url }));
      assert.deepEqual(buildProbeList(url, true), expected);
    }
  });

  it("retains method-specific timeouts, header restrictions and user agents", () => {
    assert.equal(METHOD_DEFAULTS.attemptTimeoutMs, 15000);
    assert.equal(METHOD_DEFAULTS.proxyBudgetMs, 6000);
    assert.equal(methodDefinition("wallhop")?.totalBudgetMs, 25000);
    assert.equal(methodDefinition("wallhop")?.attemptTimeoutMs, 25000);
    for (const method of ["wayback", "wayback-id"]) assert.equal(methodDefinition(method)?.totalBudgetMs, 10000);
    assert.deepEqual(methodDefinition("wallhop")?.headers, { hostname: "wallhop.io", values: { "X-Wallhop-Load": "1" } });
    for (const method of ["jina-http", "jina-https", "jina-enc", "textise-dot-iitty", "textise-iitty"]) {
      assert.equal(methodDefinition(method)?.attemptTimeoutMs, 10000);
    }
    for (const method of ["wallhop", "direct", "unknown", "constructor"]) assert.equal(userAgentFor(method), METHOD_DEFAULTS.userAgent);
    assert.match(userAgentFor("googlebot"), /Googlebot/);
    assert.match(userAgentFor("direct-bingbot"), /bingbot/);
    assert.match(userAgentFor("direct-facebook"), /FacebookBot/);
    assert.equal(userAgentFor("direct-twitter"), "Twitterbot/1.0");
    assert.equal(methodDefinition("constructor"), undefined);
  });

  it("prints both real configured orders without fetching or reading proxy configuration", () => {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "reader/plan.ts", "https://www.wsj.com/story"], {
      encoding: "utf8",
      env: { ...process.env, OUTBOUND_PROXY_ENABLED: "invalid", OUTBOUND_PROXY_URL: "invalid" },
    });
    assert.match(output, /PROXY ENABLED AND CONFIGURED\n1\. wallhop/);
    assert.match(output, /PROXY DISABLED \/ UNCONFIGURED\n1\. wallhop/);
    assert.match(output, /2\. direct/);
    assert.match(output, /2\. freedium-mirror/);
    assert.match(output, /https:\/\/wallhop.io\/https:\/\/www.wsj.com\/story/);
    assert.doesNotMatch(output, /outbound_proxy_request|outbound_proxy_bypass/);
    const invalid = spawnSync(process.execPath, ["--experimental-strip-types", "reader/plan.ts", "https://user:private-password@example.com/story"], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.doesNotMatch(invalid.stderr + invalid.stdout, /private-password/);
  });
});
