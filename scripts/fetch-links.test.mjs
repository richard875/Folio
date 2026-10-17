import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  collectFeeds,
  configuredLinkLimit,
  configuredRetryLimit,
  fetchFeed,
  generateLinks,
  linksFilename,
  parseArticleLinks,
  renderLinksMarkdown,
  saveLinks,
} from "../src/lib/rss/links.ts";
import { parseFeedCatalog } from "../src/lib/rss/catalog.ts";
import { createLinksHandler } from "../src/lib/rss/api.ts";

const feed = { site: "Example News", section: "World", url: "https://example.com/rss" };
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><link>https://example.com</link><description>News</description>
<item><title>First</title><link>https://example.com/story?a=1&amp;b=2</link></item>
<item><title>Duplicate</title><link>https://example.com/story?a=1&amp;b=2#fragment</link></item>
<item><title>Relative</title><link>/other</link></item>
<item><title>Unsafe</title><link>javascript:alert(1)</link></item>
<item><title>Credentials</title><link>https://user:pass@example.com/private</link></item>
<item><title>Only ID</title><guid isPermaLink="false">internal-id</guid></item>
</channel></rss>`.replaceAll("</item>", `<pubDate>${new Date().toISOString()}</pubDate></item>`);

test("catalog uses exactly the seven primary feed URLs in the replacement attachment", async () => {
  const source = await readFile(
    new URL("../attachments/News site RSS feeds by section.md", import.meta.url),
    "utf8",
  );
  const feeds = parseFeedCatalog(source);
  assert.equal(feeds.length, 7);
  assert.equal(new Set(feeds.map((item) => item.site)).size, 7);
  const urls = new Set(feeds.map((item) => item.url));
  assert.deepEqual([...urls].sort(), [
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    "https://www.washingtonpost.com/arcio/rss/",
    "https://www.bloomberg.com/sitemaps/news/latest.xml",
    "https://www.economist.com/latest/rss.xml",
    "https://www.ft.com/?format=rss",
    "https://foreignpolicy.com/feed/",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
  ].sort());
  assert.equal(feeds.find((item) => item.site === "Bloomberg").format, "news-sitemap");
  assert.equal(feeds.find((item) => item.site === "NY Times").ordering, "editorial");
  assert.equal(feeds.find((item) => item.site === "Washington Post").ordering, "newest");
  assert.match(
    feeds.find((item) => item.site === "Washington Post").description,
    /Associated Press/,
  );
  assert.ok(feeds.every((item) => item.section === "Main feed"));
  assert.ok(
    !urls.has("https://www.ft.com/rss/home/international"),
    "Ignore alternate URLs in notes",
  );
  assert.ok(feeds.every((item) => !/[<>]|\.\.\./.test(item.url)));
  assert.ok(feeds.every((item) => !/feeder\.co|feedspot\.com/.test(item.url)));
  assert.ok(feeds.every((item) => item.site !== "At a glance" && item.site !== "Sources"));
  assert.equal(new Set(feeds.map((item) => `${item.site}:${item.url}`)).size, feeds.length);
});

test("catalog ignores dead/prose links and supports CRLF and escaped table pipes", () => {
  const feeds = parseFeedCatalog(
    "## Test\r\nDead: `https://old.example.com/feed`\r\n| Section | URL |\r\n| --- | --- |\r\n| Main | `https://example.com/feed` |\r\n| Categories | `https://example.com/<one\\|two>/feed` |\r\n",
  );
  assert.deepEqual(
    feeds.map((item) => item.url),
    ["https://example.com/feed"],
  );
});

test("a smaller site table fetches only its explicit URLs and yields at most one article per row", async () => {
  const source =
    "# Feeds\n| Site | Feed URL | Notes |\n| --- | --- | --- |\n| Example One | `https://example.com/first` | Alternate: `https://example.com/alternate` |\n| Example Two | `https://example.com/second` | |\n\n## Sources\n| Site | Feed URL |\n| --- | --- | --- |\n| Reference | `https://example.com/reference` |\n";
  const feeds = parseFeedCatalog(source);
  const requested = [];
  const results = await collectFeeds(feeds, {
    limit: 1,
    fetchImpl: async (url) => {
      requested.push(url);
      return new Response(
        `<rss version="2.0"><channel><title>News</title><item><title>Article</title><link>https://example.com/story</link><pubDate>${new Date().toISOString()}</pubDate></item></channel></rss>`
      );
    },
  });
  assert.deepEqual(requested, ["https://example.com/first", "https://example.com/second"]);
  assert.equal(
    results.reduce((sum, result) => sum + result.urls.length, 0),
    2,
  );
});

test("limit one with the current attachment returns no more than seven links", async () => {
  const source = await readFile(
    new URL("../attachments/News site RSS feeds by section.md", import.meta.url),
    "utf8",
  );
  const feeds = parseFeedCatalog(source);
  let feedRequests = 0;
  const results = await collectFeeds(feeds, {
    limit: 1,
    fetchImpl: async (input) => {
      feedRequests++;
      const entry = feeds.find((item) => item.url === String(input));
      const domains = {
        "NY Times": "nytimes.com",
        "Washington Post": "washingtonpost.com",
        Bloomberg: "bloomberg.com",
        "The Economist": "economist.com",
        "Financial Times": "ft.com",
        "Foreign Policy": "foreignpolicy.com",
        CNBC: "cnbc.com",
      };
      const url = `https://www.${domains[entry.site]}/news/story`;
      const published = new Date().toISOString();
      if (entry.site === "Bloomberg") {
        return new Response(
          `<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>${url}</loc><news:news><news:title>Example article</news:title><news:publication_date>${published}</news:publication_date></news:news></url></urlset>`,
          { headers: { "content-type": "application/xml" } },
        );
      }
      return new Response(
        `<rss version="2.0"><channel><title>News</title><item><title>Example article</title><link>${url}</link><pubDate>${published}</pubDate></item></channel></rss>`,
        { headers: { "content-type": "application/xml" } },
      );
    },
  });
  const details = results.map((r, i) => `${feeds[i].site}: ${r.urls.length}`).join(", ");
  assert.equal(feedRequests, 7, `feed requests: ${details}`);
  assert.equal(
    results.reduce((sum, result) => sum + result.urls.length, 0),
    7,
    `total urls: ${details}`,
  );
});

test("extracts and deduplicates RSS article links, not IDs or unsafe URLs", async () => {
  assert.deepEqual(await parseArticleLinks(rss, feed.url), [
    "https://example.com/story?a=1&b=2",
    "https://example.com/other",
  ]);
});

test("supports Atom feeds and preserves Google News article URLs", async () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><id>news</id><entry><title>Article</title><id>article</id><published>${new Date().toISOString()}</published><link rel="alternate" href="https://news.google.com/rss/articles/example"/></entry></feed>`;
  assert.deepEqual(await parseArticleLinks(atom, feed.url), [
    "https://news.google.com/rss/articles/example",
  ]);
});

test("defaults to five unique links per feed and supports a custom limit", async () => {
  const xml = `<rss version="2.0"><channel><title>News</title>${Array.from(
    { length: 8 },
    (_, index) =>
      `<item><link>https://example.com/story-${index}</link><pubDate>${new Date().toISOString()}</pubDate></item><item><link>https://example.com/story-${index}#duplicate</link><pubDate>${new Date().toISOString()}</pubDate></item>`,
  ).join("")}</channel></rss>`;
  const defaults = await parseArticleLinks(xml, feed.url);
  assert.equal(defaults.length, 5);
  assert.equal(defaults[4], "https://example.com/story-4");
  assert.equal((await parseArticleLinks(xml, feed.url, 2)).length, 2);
  assert.equal(
    (await fetchFeed(feed, { limit: 7, fetchImpl: async () => new Response(xml) })).urls.length,
    7,
  );
});

test("the cap is shared across feeds in a subsection and enforced in Markdown", async () => {
  const results = await collectFeeds([feed, { ...feed, url: "https://example.com/second-feed" }], {
    limit: 3,
    fetchImpl: async (url) =>
      new Response(
        `<rss version="2.0"><channel><title>News</title>${Array.from(
          { length: 5 },
          (_, index) => `<item><link>${url}/story-${index}</link><pubDate>${new Date().toISOString()}</pubDate></item>`,
        ).join("")}</channel></rss>`,
      ),
  });
  assert.equal(
    results.reduce((sum, result) => sum + result.urls.length, 0),
    3,
  );
  const rawResults = [
    {
      ...feed,
      ok: true,
      urls: Array.from({ length: 8 }, (_, index) => `https://example.com/story-${index}`),
    },
    { ...feed, ok: true, urls: ["https://example.com/extra"] },
  ];
  assert.equal((renderLinksMarkdown(rawResults).match(/^- </gm) || []).length, 5);
  assert.equal((renderLinksMarkdown(rawResults, new Date(), 7).match(/^- </gm) || []).length, 7);
});

test("rejects HTML instead of treating it as an empty feed", async () => {
  await assert.rejects(parseArticleLinks("<html><body>Access denied</body></html>", feed.url));
});

test("retry setting defaults to 5 and accepts zero", () => {
  for (const value of [undefined, "", "-1", "1.5", "invalid", "9007199254740992"])
    assert.equal(configuredRetryLimit(value), 5);
  assert.equal(configuredRetryLimit("0"), 0);
  assert.equal(configuredRetryLimit(" 2 "), 2);
});

test("link limit environment setting defaults to 5 and accepts positive integers", () => {
  for (const value of [undefined, "", "0", "-1", "1.5", "invalid", "9007199254740992"]) {
    assert.equal(configuredLinkLimit(value), 5);
  }
  assert.equal(configuredLinkLimit(" 10 "), 10);
  assert.equal(configuredLinkLimit("1"), 1);
});

test("retries a failed request, stopping on success", async () => {
  let calls = 0;
  const result = await fetchFeed(feed, {
    retryLimit: 2,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return new Response("Unavailable", { status: 503 });
      return new Response(rss);
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
});

test("failed feeds do not abort other feeds and completion order is stable", async () => {
  const order = [];
  const results = await collectFeeds(
    [
      feed,
      { ...feed, url: "https://example.com/second" },
    ],
    {
      limit: 1,
      fetchImpl: async (url) => {
        order.push(url);
        await new Promise((r) => setTimeout(r, 10));
        return new Response(rss);
      },
    },
  );
  assert.deepEqual(order, ["https://example.com/rss", "https://example.com/second"]);
  assert.equal(results.length, 2);
});

test("Markdown groups sites and sections without request metadata", async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), "folio-links-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const source = `## Example News
| Site | Score (0–10) | Feed URL | Edition | What it actually is | How I know |
| --- | --- | --- | --- | --- | --- |
| Example News | 8 | \`https://example.com/feed\` | US | Test feed | Manual |
`;
  const report = await generateLinks(source, { outputDir, limit: 1, retryLimit: 0, fetchImpl: async () => new Response(rss) });
  assert.match(report.markdown, /^# Example News\n\n## Main feed\n\n- <https:\/\/example\.com\/story\?a=1&b=2>/m);
  assert.doesNotMatch(report.markdown, /requested at|took|fetch|status/m);
});

test("timestamped output never overwrites an existing run", async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), "folio-links-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  await writeFile(join(outputDir, "links_2026-10-12_12-34-56.md"), "old");
  const current = new Date("2026-10-12T12:34:56Z");
  assert.equal(linksFilename(current), "links_2026-10-12_12-34-56.md");
  const path = await saveLinks([{ ...feed, ok: true, urls: ["https://example.com/story"] }], outputDir, {
    now: () => current,
    wait: async () => { current.setSeconds(current.getSeconds() + 1); },
  });
  assert.equal(await readFile(join(outputDir, "links_2026-10-12_12-34-56.md"), "utf8"), "old");
  assert.equal(path, join(outputDir, "links_2026-10-12_12-34-57.md"));
});

test("collection generates a saved report, keeps successful feeds and honors environment limits", async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), "folio-links-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const source = `## Example News
| Site | Score (0–10) | Feed URL | Edition | What it actually is | How I know |
| --- | --- | --- | --- | --- | --- |
| Example News | 8 | \`https://example.com/feed\` | US | Test feed | Manual |
`;
  const report = await generateLinks(source, { outputDir, limit: 5, retryLimit: 0, fetchImpl: async () => new Response(rss) });
  assert.equal(report.feedCount, 1);
  assert.equal(report.failedFeedCount, 0);
  assert.equal(report.linkCount, 2);
});

test("links endpoint authenticates, returns JSON or Markdown and prevents overlapping runs", async () => {
  const originalHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "test-key";
  try {
    const handler = createLinksHandler("test-source", async () => {
      await new Promise((r) => setTimeout(r, 50));
      return {
        savedFile: "output/links/test.md",
        limit: 5,
        feedCount: 1,
        failedFeedCount: 0,
        linkCount: 1,
        markdown: "test",
        websites: [{ name: "Test", sections: [{ name: "Main", links: ["https://example.com/story"], available: true }] }],
      };
    });
    const jsonResponse = await handler(new Request("https://folio.example/api/links?hash=test-key&format=json"));
    assert.equal(jsonResponse.status, 200);
    const promise1 = handler(new Request("https://folio.example/api/links?hash=test-key&format=json"));
    await new Promise((r) => setTimeout(r, 10));
    const response2 = await handler(new Request("https://folio.example/api/links?hash=test-key"));
    assert.equal(response2.status, 409);
    await promise1;
    const response3 = await handler(new Request("https://folio.example/api/links?hash=test-key"));
    assert.equal(response3.status, 200);
  } finally {
    if (originalHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = originalHash;
  }
});
