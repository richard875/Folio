import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { hashMatches } from "./auth.ts";
import { fetchHtml, fetchHtmlWithRedirects } from "./fetch.ts";
import { readArticle } from "./read.ts";
import { probeList } from "./targets.ts";
import { isSubstantial, parseArticleHtml } from "./extract.ts";

const originalFetch = globalThis.fetch;
const originalAccessHash = process.env.ACCESS_HASH;
const originalRetryLimit = process.env.FETCH_RETRY_LIMIT;
const originalMaxResponseBytes = process.env.ARTICLE_MAX_RESPONSE_BYTES;
const originalProxyEnv = Object.fromEntries(["OUTBOUND_PROXY_ENABLED", "OUTBOUND_PROXY_URL", "OUTBOUND_PROXY_URLS", "OUTBOUND_PROXY_MODE", "OUTBOUND_PROXY_BYPASS_HOSTS"].map((key) => [key, process.env[key]]));
const ACCESS_HASH = "test-reader-access-hash";

beforeEach(() => {
  process.env.ACCESS_HASH = ACCESS_HASH;
  delete process.env.FETCH_RETRY_LIMIT;
  delete process.env.ARTICLE_MAX_RESPONSE_BYTES;
  for (const key of Object.keys(originalProxyEnv)) delete process.env[key];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAccessHash === undefined) delete process.env.ACCESS_HASH;
  else process.env.ACCESS_HASH = originalAccessHash;
  if (originalRetryLimit === undefined) delete process.env.FETCH_RETRY_LIMIT;
  else process.env.FETCH_RETRY_LIMIT = originalRetryLimit;
  if (originalMaxResponseBytes === undefined) delete process.env.ARTICLE_MAX_RESPONSE_BYTES;
  else process.env.ARTICLE_MAX_RESPONSE_BYTES = originalMaxResponseBytes;
  for (const [key, value] of Object.entries(originalProxyEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("reader access hash", () => {
  it("accepts only the configured environment value", () => {
    assert.equal(hashMatches(ACCESS_HASH), true);
    assert.equal(hashMatches("x".repeat(ACCESS_HASH.length)), false);
    assert.equal(hashMatches("wrong"), false);
    assert.equal(hashMatches(null), false);
    assert.equal(hashMatches(undefined), false);
    assert.equal(hashMatches(""), false);
  });

  it("rejects access when the environment value is missing or empty", () => {
    delete process.env.ACCESS_HASH;
    assert.equal(hashMatches(ACCESS_HASH), false);
    process.env.ACCESS_HASH = "";
    assert.equal(hashMatches(ACCESS_HASH), false);
  });
});

function articleResponse(): Response {
  const paragraph =
    "The newspaper reported on the changing situation and explained what the new details mean for readers. ".repeat(6);
  const jsonLd = JSON.stringify({
    "@type": "NewsArticle",
    headline: "Example article",
    articleBody: Array.from({ length: 4 }, () => paragraph).join("\n\n"),
  });
  return new Response(`<html><head><title>Example article</title></head><body><script type="application/ld+json">${jsonLd}</script></body></html>`, {
    headers: { "content-type": "text/html" },
  });
}

describe("fetch retries", () => {
  it("retries network failures and stops immediately on success", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      if (++calls < 3) throw new Error("fetch failed");
      return new Response("article");
    };
    assert.equal(await fetchHtml("https://example.com", "direct", Date.now() + 1000), "article");
    assert.equal(calls, 3);
  });

  it("defaults to eight retries after the initial request", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("fetch failed");
    };
    await assert.rejects(fetchHtml("https://example.com", "direct", Date.now() + 1000), /fetch failed/);
    assert.equal(calls, 9);
  });

  it("honors the configured limit for unsuccessful HTTP responses", async () => {
    process.env.FETCH_RETRY_LIMIT = "2";
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("unavailable", { status: 503 });
    };
    await assert.rejects(fetchHtml("https://example.com", "direct", Date.now() + 1000), /HTTP 503/);
    assert.equal(calls, 3);
  });

  it("allows retries to be disabled", async () => {
    process.env.FETCH_RETRY_LIMIT = "0";
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("fetch failed");
    };
    await assert.rejects(fetchHtml("https://example.com", "direct", Date.now() + 1000), /fetch failed/);
    assert.equal(calls, 1);
  });

  it("falls back to eight retries for invalid settings", async () => {
    for (const value of ["", "invalid", "-1", "1.5", "Infinity", "9007199254740992"]) {
      process.env.FETCH_RETRY_LIMIT = value;
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        throw new Error("fetch failed");
      };
      await assert.rejects(fetchHtml("https://example.com", "direct", Date.now() + 1000), /fetch failed/);
      assert.equal(calls, 9, value);
    }
  });

  it("does not fetch after the overall deadline", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("article");
    };
    await assert.rejects(fetchHtml("https://example.com", "direct", Date.now() - 1), /time budget/);
    assert.equal(calls, 0);
  });

  it("does not retry a successfully fetched unsupported payload", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("image", { headers: { "content-type": "image/png" } });
    };
    await assert.rejects(fetchHtml("https://example.com", "direct", Date.now() + 1000), /Unsupported type/);
    assert.equal(calls, 1);
  });

  it("retries response-body read failures", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) {
        return new Response(new ReadableStream({
          start(controller) { controller.error(new Error("connection lost")); },
        }));
      }
      return new Response("article");
    };
    assert.equal(await fetchHtml("https://example.com", "direct", Date.now() + 1000), "article");
    assert.equal(calls, 2);
  });
});

describe("extraction service catalog", () => {
  it("places the normal WallHop page first or second for all ten publishers in either transport mode", () => {
    const first = ["wsj.com", "foreignpolicy.com", "cnbc.com"];
    const second = ["nytimes.com", "washingtonpost.com", "bloomberg.com", "economist.com", "ft.com", "reuters.com", "businessinsider.com"];
    for (const mode of ["unconfigured", "disabled", "enabled"]) {
      process.env.OUTBOUND_PROXY_ENABLED = String(mode === "enabled");
      if (mode === "unconfigured") delete process.env.OUTBOUND_PROXY_URL;
      else process.env.OUTBOUND_PROXY_URL = "http://test-user:test-password@127.0.0.1:9999/";
      const baseline = probeList("https://example.com/story").map((probe) => probe.method);
      for (const domain of [...first, ...second]) {
        for (const prefix of ["", "www."]) {
          const url = `https://${prefix}${domain}/world/story?edition=us&item=2`;
          const probes = probeList(url);
          const index = first.includes(domain) ? 0 : 1;
          assert.deepEqual(probes[index], { method: "wallhop", url: `https://wallhop.io/${url}` });
          assert.equal(probes.filter((probe) => probe.method === "wallhop").length, 1);
          assert.deepEqual(probes.filter((probe) => probe.method !== "wallhop").map((probe) => probe.method), baseline);
          assert.equal(probes[first.includes(domain) ? 1 : 0].method, mode === "enabled" ? "direct" : "freedium-mirror");
        }
      }
    }
  });

  it("does not add WallHop to unrelated or lookalike publisher domains", () => {
    for (const host of ["example.com", "notwsj.com", "wsj.com.example.com", "ft.com.example.com"]) {
      assert.equal(probeList(`https://${host}/story`).some((probe) => probe.method === "wallhop"), false);
    }
  });

  it("keeps both working mirror variants and never schedules the retired service", () => {
    for (const proxyEnabled of [false, true]) {
      process.env.OUTBOUND_PROXY_ENABLED = String(proxyEnabled);
      process.env.OUTBOUND_PROXY_URL = "http://test-user:test-password@127.0.0.1:9999/";
      for (const host of ["example.com", "www.ft.com", "www.wsj.com", "foreignpolicy.com"]) {
        const probes = probeList(`https://${host}/article?example=1`);
        assert.deepEqual(probes.filter((probe) => new URL(probe.url).hostname === "freedium-mirror.cfd").map((probe) => probe.method), ["freedium-mirror", "freedium-mirror-encoded"]);
        assert.equal(probes.some((probe) => new URL(probe.url).hostname === "freedium.cfd"), false);
        assert.equal(probes.some((probe) => ["freedium", "freedium-encoded"].includes(probe.method)), false);
      }
    }
  });
});

describe("WallHop HTML extraction", () => {
  it("preserves real article paragraphs instead of collapsing them into a falsely partial block", () => {
    const paragraphs = ["First", "Second", "Third", "Fourth"].map((label) =>
      `${label} paragraph explains the evidence. ` + "Detailed reporting on a developing situation gives readers context. ".repeat(8));
    const html = `<html><head><title>Paragraph fixture</title></head><body><article>${paragraphs.map((p) => `<p>${p}<em>Inline emphasis.</em></p>`).join("")}</article></body></html>`;
    const result = parseArticleHtml(html, "https://wallhop.io/https://www.wsj.com/paragraph-story");
    assert.ok(result);
    assert.ok(result.text.includes("Inline emphasis.\n\nSecond paragraph"));
    for (const paragraph of paragraphs) assert.ok(result.text.includes(paragraph));
    assert.equal(isSubstantial(result.text), true);
    assert.equal(result.text.split(/\n\s*\n/).filter((p) => p.length > 40).length, 4);
  });

  it("requests document HTML first and does not forward WallHop headers to a redirected publisher", async () => {
    const requested: Array<{ url: string; load: string | null; destination: string | null }> = [];
    globalThis.fetch = async (input, init) => {
      requested.push({ url: String(input), load: new Headers(init?.headers).get("X-Wallhop-Load"), destination: new Headers(init?.headers).get("sec-fetch-dest") });
      return requested.length === 1
        ? new Response(null, { status: 302, headers: { location: "https://www.wsj.com/story" } })
        : articleResponse();
    };
    const result = await fetchHtmlWithRedirects("https://wallhop.io/https://www.wsj.com/story", "wallhop", Date.now() + 1000);
    assert.deepEqual(requested, [
      { url: "https://wallhop.io/https://www.wsj.com/story", load: null, destination: "document" },
      { url: "https://www.wsj.com/story", load: null, destination: null },
    ]);
    assert.equal(result.finalUrl, "https://www.wsj.com/story");
    assert.ok(result.html.includes("Example article"));
  });

  it("reads the reported WSJ URL without the legacy header that returns an empty 403", async () => {
    process.env.FETCH_RETRY_LIMIT = "0";
    const url = "https://www.wsj.com/world/ukraine-starlink-elon-musk-trump-dbc49193?mod=hp_lead_pos1";
    const requested: string[] = [];
    globalThis.fetch = async (input, init) => {
      requested.push(String(input));
      const headers = new Headers(init?.headers);
      if (headers.has("X-Wallhop-Load")) return new Response(null, { status: 403 });
      assert.equal(headers.get("sec-fetch-dest"), "document");
      assert.equal(headers.get("sec-fetch-mode"), "navigate");
      assert.equal(headers.get("sec-fetch-site"), "none");
      return articleResponse();
    };
    const result = await readArticle(url, ACCESS_HASH);
    assert.equal(result.title, "Example article");
    assert.equal(result.partial, false);
    assert.deepEqual(requested, ["https://wallhop.io/https://www.wsj.com/world/ukraine-starlink-elon-musk-trump-dbc49193"]);
  });

  it("retains one advertised legacy loader step on the same URL even with retries disabled", async () => {
    process.env.FETCH_RETRY_LIMIT = "0";
    const headers: Headers[] = [];
    const requested: string[] = [];
    globalThis.fetch = async (input, init) => {
      requested.push(String(input));
      headers.push(new Headers(init?.headers));
      return headers.length === 1
        ? new Response('<html><body>Loading article<script>fetch(location.href, {headers: {"X-Wallhop-Load":"1"}})</script></body></html>')
        : articleResponse();
    };
    const url = "https://wallhop.io/https://www.wsj.com/legacy-loader-story";
    const html = await fetchHtml(url, "wallhop", Date.now() + 1000);
    assert.ok(html.includes("Example article"));
    assert.deepEqual(requested, [url, url]);
    assert.equal(headers[0].get("sec-fetch-dest"), "document");
    assert.equal(headers[0].get("X-Wallhop-Load"), null);
    assert.equal(headers[1].get("X-Wallhop-Load"), "1");
    assert.equal(headers[1].get("sec-fetch-dest"), null);
  });

  it("does not treat article prose mentioning the load header as a loading-page script", async () => {
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("X-Wallhop-Load"), null);
      return new Response('<html><body><article>The X-Wallhop-Load header is mentioned in this article.</article></body></html>');
    };
    await fetchHtml("https://wallhop.io/https://www.wsj.com/header-story", "wallhop", Date.now() + 1000);
    assert.equal(calls, 1);
  });

  it("does not loop on legacy loaders or leak their header after a redirect", async () => {
    process.env.FETCH_RETRY_LIMIT = "0";
    const headers: Array<{ host: string; load: string | null }> = [];
    globalThis.fetch = async (input, init) => {
      headers.push({ host: new URL(String(input)).hostname, load: new Headers(init?.headers).get("X-Wallhop-Load") });
      if (headers.length === 1) return new Response('<script>fetch(location.href, {headers: {"X-Wallhop-Load":"1"}})</script>');
      if (headers.length === 2) return new Response(null, { status: 302, headers: { location: "https://www.wsj.com/legacy-result" } });
      return articleResponse();
    };
    await fetchHtml("https://wallhop.io/https://www.wsj.com/legacy-result", "wallhop", Date.now() + 1000);
    assert.deepEqual(headers, [
      { host: "wallhop.io", load: null }, { host: "wallhop.io", load: "1" }, { host: "www.wsj.com", load: null },
    ]);
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('<script>fetch(location.href, {headers: {"X-Wallhop-Load":"1"}})</script>'); };
    await fetchHtml("https://wallhop.io/https://www.wsj.com/repeated-loader", "wallhop", Date.now() + 1000);
    assert.equal(calls, 2);
  });

  it("shares the original deadline with the legacy loader rather than resetting its 25 seconds", async (t) => {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    let calls = 0;
    globalThis.fetch = async () => {
      calls++; now += 25100;
      return new Response('<script>fetch(location.href, {headers: {"X-Wallhop-Load":"1"}})</script>');
    };
    await assert.rejects(fetchHtml("https://wallhop.io/https://www.wsj.com/slow-loader", "wallhop", now + 48000), /time budget/);
    assert.equal(calls, 1);
  });

  it("allows slow WallHop HTML but caps the total method budget at 25 seconds in both transport modes", async (t) => {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    for (const enabled of [false, true]) {
      process.env.OUTBOUND_PROXY_ENABLED = String(enabled);
      process.env.OUTBOUND_PROXY_URL = "http://test-user:test-password@127.0.0.1:9999/";
      globalThis.fetch = async () => { now += 20000; return new Response("article"); };
      assert.equal(await fetchHtml("https://93.184.216.34/story", "wallhop", now + 48000), "article");
      let calls = 0;
      globalThis.fetch = async () => { calls++; now += 25100; throw new TypeError("fetch failed"); };
      await assert.rejects(fetchHtml("https://93.184.216.34/story", "wallhop", now + 48000), /fetch failed/);
      assert.equal(calls, 1);
    }
  });

  it("never extends the caller's remaining article deadline for WallHop", async (t) => {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    let calls = 0;
    globalThis.fetch = async () => { calls++; now += 1100; throw new TypeError("fetch failed"); };
    await assert.rejects(fetchHtml("https://example.com/story", "wallhop", now + 1000), /fetch failed/);
    assert.equal(calls, 1);
  });

  it("reads normal WallHop HTML first for WSJ, Foreign Policy and CNBC", async () => {
    for (const host of ["www.wsj.com", "foreignpolicy.com", "www.cnbc.com"]) {
      const url = `https://${host}/wallhop-first-story`;
      const requested: string[] = [];
      globalThis.fetch = async (input, init) => {
        requested.push(String(input));
        assert.equal(new Headers(init?.headers).get("X-Wallhop-Load"), null);
        assert.equal(new Headers(init?.headers).get("sec-fetch-dest"), "document");
        return articleResponse();
      };
      const result = await readArticle(url, ACCESS_HASH);
      assert.deepEqual(requested, [`https://wallhop.io/${url}`]);
      assert.equal(result.originalUrl, url);
      assert.equal(result.sourceUrl, `https://wallhop.io/${url}`);
      assert.equal(result.title, "Example article");
      assert.ok(result.text.includes("The newspaper reported"));
      assert.equal(result.partial, false);
    }
  });

  it("uses WallHop second after a failed first attempt, with and without the proxy", async () => {
    process.env.FETCH_RETRY_LIMIT = "0";
    for (const enabled of [false, true]) {
      process.env.OUTBOUND_PROXY_ENABLED = String(enabled);
      process.env.OUTBOUND_PROXY_URL = "http://test-user:test-password@127.0.0.1:9999/";
      const url = `https://www.ft.com/wallhop-second-story-${enabled}`;
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        requested.push(String(input));
        return requested.length === 1 ? new Response(null, { status: 404 }) : articleResponse();
      };
      const result = await readArticle(url, ACCESS_HASH);
      assert.deepEqual(requested, [enabled ? url : `https://freedium-mirror.cfd/${url}`, `https://wallhop.io/${url}`]);
      assert.equal(result.originalUrl, url);
      assert.equal(result.sourceUrl, `https://wallhop.io/${url}`);
      assert.equal(result.partial, false);
    }
  });

  it("continues to the existing fallback after WallHop fails or returns unusable HTML", async () => {
    process.env.FETCH_RETRY_LIMIT = "0";
    for (const failure of ["http", "html"]) {
      const url = `https://www.wsj.com/wallhop-fallback-${failure}`;
      const requested: string[] = [];
      globalThis.fetch = async (input) => {
        requested.push(String(input));
        if (requested.length > 1) return articleResponse();
        return failure === "http"
          ? new Response(null, { status: 503 })
          : new Response("<html><body>No article</body></html>", { headers: { "content-type": "text/html" } });
      };
      const result = await readArticle(url, ACCESS_HASH);
      assert.deepEqual(requested, [`https://wallhop.io/${url}`, `https://freedium-mirror.cfd/${url}`]);
      assert.equal(result.sourceUrl, `https://freedium-mirror.cfd/${url}`);
      assert.equal(result.partial, false);
    }
  });
});

describe("failure handling and proxy extraction budgets", () => {
  function enableProxy(poolOnly = false) {
    process.env.OUTBOUND_PROXY_ENABLED = "true";
    process.env.OUTBOUND_PROXY_URL = "http://test-user:test-password@127.0.0.1:9999/";
    process.env.FETCH_RETRY_LIMIT = "8";
    if (poolOnly) {
      process.env.OUTBOUND_PROXY_URLS = JSON.stringify([
        process.env.OUTBOUND_PROXY_URL,
        "http://second-test-user:test-password@127.0.0.1:9999/",
      ]);
      delete process.env.OUTBOUND_PROXY_URL;
    }
  }

  it("does not repeatedly retry invalid certificates in direct or proxy mode", async () => {
    for (const enabled of [false, true]) {
      if (enabled) enableProxy();
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("invalid chain"), { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" }) });
      };
      await assert.rejects(fetchHtml("https://93.184.216.34/story", "direct", Date.now() + 1000), /fetch failed/);
      assert.equal(calls, 1);
    }
  });

  it("does not retry a missing article eight times", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 404 }); };
    await assert.rejects(fetchHtml("https://example.com/story", "direct", Date.now() + 1000), /HTTP 404/);
    assert.equal(calls, 1);
  });

  it("caps proxy retries even when FETCH_RETRY_LIMIT is eight", async () => {
    enableProxy();
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new TypeError("fetch failed"); };
    await assert.rejects(fetchHtml("https://93.184.216.34/story", "direct", Date.now() + 1000), /fetch failed/);
    assert.equal(calls, 2);
  });

  it("stops a proxy method after six seconds rather than consuming the article budget", async (t) => {
    enableProxy();
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    let calls = 0;
    globalThis.fetch = async () => { calls++; now += 6100; throw new TypeError("fetch failed"); };
    await assert.rejects(fetchHtml("https://93.184.216.34/story", "direct", now + 48000), /fetch failed/);
    assert.equal(calls, 1);
  });

  it("keeps the one-retry cap when only the proxy pool is configured", async () => {
    enableProxy(true);
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new TypeError("fetch failed"); };
    await assert.rejects(fetchHtml("https://93.184.216.34/pool-retries", "direct", Date.now() + 1000), /fetch failed/);
    assert.equal(calls, 2);
  });

  it("keeps the six-second method budget when only the proxy pool is configured", async (t) => {
    enableProxy(true);
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    let calls = 0;
    globalThis.fetch = async () => { calls++; now += 6100; throw new TypeError("fetch failed"); };
    await assert.rejects(fetchHtml("https://93.184.216.34/pool-budget", "direct", now + 48000), /fetch failed/);
    assert.equal(calls, 1);
  });

  it("tries the publisher via the configured proxy before retrieval services", async () => {
    enableProxy();
    const requested: string[] = [];
    globalThis.fetch = async (input) => { requested.push(String(input)); return articleResponse(); };
    const url = "https://93.184.216.34/proxy-publisher-story";
    assert.equal((await readArticle(url, ACCESS_HASH)).originalUrl, url);
    assert.deepEqual(requested, [url]);
  });
});

describe("article response size", () => {
  it("accepts archive HTML larger than the old 3 MB limit", async () => {
    const html = `<html><body>${"article text ".repeat(300_000)}</body></html>`;
    assert.ok(Buffer.byteLength(html) > 3_000_000);
    globalThis.fetch = async () => new Response(html, {
      headers: { "content-type": "text/html", "content-length": String(Buffer.byteLength(html)) },
    });
    assert.equal(await fetchHtml("https://archive.is/example", "archive.is-newest", Date.now() + 5000), html);
  });

  it("allows a configured limit above the default", async () => {
    process.env.ARTICLE_MAX_RESPONSE_BYTES = "9000000";
    const html = "x".repeat(8_000_001);
    globalThis.fetch = async () => new Response(html);
    assert.equal((await fetchHtml("https://example.com", "direct", Date.now() + 5000)).length, html.length);
  });

  it("rejects advertised oversized bodies once with an actionable limit", async () => {
    let calls = 0;
    let cancelled = false;
    globalThis.fetch = async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        headers: { "content-length": "8000001" },
      });
    };
    await assert.rejects(fetchHtml("https://archive.is/example", "archive.is-newest", Date.now() + 1000), /Response too large.*8000000.*ARTICLE_MAX_RESPONSE_BYTES/);
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
  });

  it("enforces custom byte limits on chunked or decoded compressed bodies without truncation", async () => {
    process.env.ARTICLE_MAX_RESPONSE_BYTES = "64";
    for (const headers of [new Headers(), new Headers({ "content-encoding": "gzip", "content-length": "10" })]) {
      let calls = 0;
      let cancelled = false;
      globalThis.fetch = async () => {
        calls++;
        // Native fetch exposes already-decoded bytes, even with compression headers.
        return new Response(new ReadableStream({
          pull(controller) { controller.enqueue(new Uint8Array(40)); },
          cancel() { cancelled = true; },
        }), { headers });
      };
      await assert.rejects(fetchHtml("https://example.com", "direct", Date.now() + 1000), /Response too large.*64 bytes/);
      assert.equal(calls, 1);
      assert.equal(cancelled, true);
    }
  });

  it("invalid limits cannot disable or exceed the 16 MB hard ceiling", async () => {
    for (const value of ["0", "-1", "Infinity", "16000001", "invalid"]) {
      process.env.ARTICLE_MAX_RESPONSE_BYTES = value;
      globalThis.fetch = async () => new Response("", { headers: { "content-length": "8000001" } });
      await assert.rejects(fetchHtml("https://example.com", "direct", Date.now() + 1000), /article limit: 8000000 bytes/);
    }
  });
});

describe("article output", () => {
  it("returns only article fields in JSON and Markdown after a fallback succeeds", async () => {
    const url = "https://example.com/output-story";
    globalThis.fetch = async (input) => {
      if (String(input) === url) throw new Error("request failed");
      return articleResponse();
    };
    const result = await readArticle(url, ACCESS_HASH);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(result))).sort(), [
      "author", "images", "markdown", "originalUrl", "partial", "published", "sourceUrl", "text", "title",
    ]);
    assert.match(result.markdown, /Example article/);
    assert.ok(result.markdown.includes(url));
    // Ensure internal method identifiers aren't exposed as fields (sourceUrl may contain service domain)
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, /"method"\s*:/i);
    assert.doesNotMatch(json, /"bypass"\s*:/i);
    assert.doesNotMatch(json, /Tried:/i);
  });

  it("does not expose internal request details in failure messages", async () => {
    process.env.FETCH_RETRY_LIMIT = "0";
    globalThis.fetch = async (input) => {
      throw new Error(`fetch failed: ${String(input)}`);
    };
    await assert.rejects(readArticle("https://example.com/unavailable-story", ACCESS_HASH), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Could not extract an article. Please try again later.");
      return true;
    });
  });
});

describe("readArticle URL query handling", () => {
  it("recovers from a failed fetch before moving to another extraction method", async () => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      requested.push(String(input));
      if (requested.length === 1) throw new Error("fetch failed");
      return articleResponse();
    };
    const url = "https://example.com/transient-story";
    const result = await readArticle(url, ACCESS_HASH);
    assert.equal(result.originalUrl, url);
    // First probe is freedium-mirror (no direct fetch), so both attempts go through freedium-mirror
    assert.deepEqual(requested, [
      "https://freedium-mirror.cfd/https://example.com/transient-story",
      "https://freedium-mirror.cfd/https://example.com/transient-story",
    ]);
  });

  it("tries the URL without search parameters first (via bypass service)", async () => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      requested.push(String(input));
      return articleResponse();
    };

    const result = await readArticle("https://example.com/story?mod=hp_lead_pos1", ACCESS_HASH);

    // First probe uses clean URL via freedium-mirror
    assert.equal(requested[0], "https://freedium-mirror.cfd/https://example.com/story");
    assert.equal(requested.length, 1);
    assert.equal(result.originalUrl, "https://example.com/story?mod=hp_lead_pos1");
  });

  it("retries the original URL with search parameters if the clean URL fails", async () => {
    const requested: string[] = [];
    const originalUrl = "https://example.com/retry-story?mod=hp_lead_pos1";
    globalThis.fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === originalUrl) return articleResponse();
      throw new Error("Not found");
    };

    const result = await readArticle(originalUrl, ACCESS_HASH);

    // First probe uses clean URL via freedium-mirror
    assert.equal(requested[0], "https://freedium-mirror.cfd/https://example.com/retry-story");
    // Second probe uses original URL with search params via freedium-mirror
    assert.ok(requested.indexOf("https://freedium-mirror.cfd/https://example.com/retry-story?mod=hp_lead_pos1") > 0);
    assert.ok(requested.includes("https://freedium-mirror.cfd/https://example.com/retry-story?mod=hp_lead_pos1"));
    assert.equal(result.originalUrl, originalUrl);
  });

  it("does not add a retry pass when the URL has no search parameters", async () => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      requested.push(String(input));
      return articleResponse();
    };

    await readArticle("https://example.com/plain-story", ACCESS_HASH);

    // Only one probe via freedium-mirror
    assert.deepEqual(requested, ["https://freedium-mirror.cfd/https://example.com/plain-story"]);
  });
});
