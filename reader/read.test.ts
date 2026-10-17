import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { hashMatches } from "./auth.ts";
import { fetchHtml } from "./fetch.ts";
import { readArticle } from "./read.ts";

const originalFetch = globalThis.fetch;
const originalAccessHash = process.env.ACCESS_HASH;
const originalRetryLimit = process.env.FETCH_RETRY_LIMIT;
const originalMaxResponseBytes = process.env.ARTICLE_MAX_RESPONSE_BYTES;
const ACCESS_HASH = "test-reader-access-hash";

beforeEach(() => {
  process.env.ACCESS_HASH = ACCESS_HASH;
  delete process.env.FETCH_RETRY_LIMIT;
  delete process.env.ARTICLE_MAX_RESPONSE_BYTES;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAccessHash === undefined) delete process.env.ACCESS_HASH;
  else process.env.ACCESS_HASH = originalAccessHash;
  if (originalRetryLimit === undefined) delete process.env.FETCH_RETRY_LIMIT;
  else process.env.FETCH_RETRY_LIMIT = originalRetryLimit;
  if (originalMaxResponseBytes === undefined) delete process.env.ARTICLE_MAX_RESPONSE_BYTES;
  else process.env.ARTICLE_MAX_RESPONSE_BYTES = originalMaxResponseBytes;
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
