import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ACCESS_HASH } from "./auth.ts";
import { readArticle } from "./read.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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

describe("readArticle URL query handling", () => {
  it("tries the URL without search parameters first", async () => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      requested.push(String(input));
      return articleResponse();
    };

    const result = await readArticle("https://example.com/story?mod=hp_lead_pos1", ACCESS_HASH);

    assert.equal(requested[0], "https://example.com/story");
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

    assert.equal(requested[0], "https://example.com/retry-story");
    assert.ok(requested.indexOf(originalUrl) > 0);
    assert.equal(result.methodUrl, originalUrl);
    assert.equal(result.originalUrl, originalUrl);
  });

  it("does not add a retry pass when the URL has no search parameters", async () => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      requested.push(String(input));
      return articleResponse();
    };

    await readArticle("https://example.com/plain-story", ACCESS_HASH);

    assert.deepEqual(requested, ["https://example.com/plain-story"]);
  });
});
