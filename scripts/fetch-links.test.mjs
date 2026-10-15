import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
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
</channel></rss>`;

test("catalog uses exactly the twelve primary feed URLs in the replacement attachment", async () => {
  const source = await readFile(
    new URL("../attachments/News site RSS feeds by section.md", import.meta.url),
    "utf8",
  );
  const feeds = parseFeedCatalog(source);
  assert.equal(feeds.length, 12);
  assert.equal(new Set(feeds.map((item) => item.site)).size, 12);
  const urls = new Set(feeds.map((item) => item.url));
  assert.ok(urls.has("https://thehill.com/news/feed/"));
  assert.ok(urls.has("https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"));
  assert.ok(urls.has("https://flipboard.com/@WSJ.rss"));
  assert.ok(urls.has("https://www.bloomberg.com/sitemaps/news/latest.xml"));
  assert.ok(urls.has("https://www.businessinsider.com/sitemap/google-news.xml"));
  assert.equal(feeds.find((item) => item.site === "Bloomberg").format, "news-sitemap");
  assert.equal(feeds.find((item) => item.site === "NY Times").ordering, "editorial");
  assert.equal(feeds.find((item) => item.site === "Axios").homepageScore, 10);
  assert.match(
    feeds.find((item) => item.site === "Washington Post").description,
    /Associated Press/,
  );
  assert.ok(feeds.every((item) => item.section === "Main feed"));
  assert.ok(
    !urls.has("https://www.ft.com/rss/home/international"),
    "Ignore alternate URLs in notes",
  );
  assert.ok(!urls.has("https://api.axios.com/feed/audience/denver"), "Do not add historical feeds");
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
    "# Feeds\n| Site | Feed URL | Notes |\n| --- | --- | --- |\n| Example One | `https://example.com/axios` | Alternate: `https://example.com/alternate` |\n| Example Two | `https://example.com/nyt` | |\n\n## Sources\n| Site | Feed URL |\n| --- | --- | --- |\n| Reference | `https://example.com/reference` |\n";
  const feeds = parseFeedCatalog(source);
  const requested = [];
  const results = await collectFeeds(feeds, {
    limit: 1,
    fetchImpl: async (url) => {
      requested.push(url);
      return new Response(rss);
    },
  });
  assert.deepEqual(requested, ["https://example.com/axios", "https://example.com/nyt"]);
  assert.equal(
    results.reduce((sum, result) => sum + result.urls.length, 0),
    2,
  );
});

test("limit one with the current attachment returns no more than twelve links", async () => {
  const source = await readFile(
    new URL("../attachments/News site RSS feeds by section.md", import.meta.url),
    "utf8",
  );
  const feeds = parseFeedCatalog(source);
  let requests = 0;
  const results = await collectFeeds(feeds, {
    limit: 1,
    fetchImpl: async (input) => {
      requests++;
      const entry = feeds.find((item) => item.url === String(input));
      const domains = {
        WSJ: "wsj.com",
        "NY Times": "nytimes.com",
        "Washington Post": "washingtonpost.com",
        Bloomberg: "bloomberg.com",
        "The Economist": "economist.com",
        "The Hill": "thehill.com",
        Axios: "axios.com",
        "Financial Times": "ft.com",
        "Foreign Policy": "foreignpolicy.com",
        CNBC: "cnbc.com",
        Reuters: "reuters.com",
        "Business Insider": "businessinsider.com",
      };
      const url = `https://www.${domains[entry.site]}/news/story`;
      if (entry.site === "Reuters") {
        return new Response(
          JSON.stringify({
            result: {
              articles: [
                {
                  canonical_url: "/world/test-article-2026-10-15/",
                  title: "Test Article",
                  description: "Test summary",
                  published_time: "2026-10-15T12:00:00Z",
                  kicker: { names: ["World"] },
                },
              ],
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        entry.format === "news-sitemap"
          ? `<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>${url}</loc><news:news><news:title>Example article</news:title></news:news></url></urlset>`
          : `<rss version="2.0"><channel><title>News</title><item><title>Example article</title><link>${url}</link></item></channel></rss>`,
      );
    },
  });
  // Debug: include in assertion message
  const details = results.map((r, i) => `${feeds[i].site}: ${r.urls.length}`).join(", ");
  assert.equal(requests, 12, `requests: ${details}`);
  assert.equal(
    results.reduce((sum, result) => sum + result.urls.length, 0),
    12,
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
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><id>news</id><updated>2026-10-11T00:00:00Z</updated><entry><title>Article</title><id>article</id><link rel="alternate" href="https://news.google.com/rss/articles/example"/></entry></feed>`;
  assert.deepEqual(await parseArticleLinks(atom, feed.url), [
    "https://news.google.com/rss/articles/example",
  ]);
});

test("defaults to five unique links per feed and supports a custom limit", async () => {
  const xml = `<rss version="2.0"><channel><title>News</title>${Array.from(
    { length: 8 },
    (_, index) =>
      `<item><link>https://example.com/story-${index}</link></item><item><link>https://example.com/story-${index}#duplicate</link></item>`,
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
          (_, index) => `<item><link>${url}/story-${index}</link></item>`,
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
  assert.equal(result.urls.length, 2);
});

test("failed feeds do not abort other feeds and completion order is stable", async () => {
  let active = 0;
  let maximum = 0;
  const feeds = Array.from({ length: 5 }, (_, index) => ({
    ...feed,
    section: `${index}`,
    url: `https://example.com/${index}`,
  }));
  const results = await collectFeeds(feeds, {
    concurrency: 2,
    retryLimit: 0,
    fetchImpl: async (url) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((done) => setTimeout(done, url.endsWith("0") ? 15 : 1));
      active--;
      if (url.endsWith("1")) throw new Error("internal request details");
      return new Response(rss);
    },
  });
  assert.equal(maximum, 2);
  assert.deepEqual(
    results.map((item) => item.section),
    ["0", "1", "2", "3", "4"],
  );
  assert.equal(results[1].ok, false);
  assert.equal(results.filter((item) => item.ok).length, 4);
});

test("Markdown groups sites and sections without request metadata", () => {
  const markdown = renderLinksMarkdown(
    [
      { ...feed, urls: ["https://example.com/story"], ok: true },
      { ...feed, urls: ["https://example.com/story", "https://example.com/second"], ok: true },
      { ...feed, section: "Tech", urls: [], ok: false },
      { ...feed, site: "Other", urls: [], ok: true },
    ],
    new Date("2026-10-11T12:34:56Z"),
  );
  assert.match(markdown, /^# Example News$/m);
  assert.match(markdown, /^## World$/m);
  assert.match(markdown, /^## Tech$/m);
  assert.match(markdown, /^# Other$/m);
  assert.equal(markdown.match(/<https:\/\/example.com\/story>/g).length, 1);
  assert.match(markdown, /Some feeds were unavailable/);
  assert.match(markdown, /No article links available/);
  assert.doesNotMatch(markdown, /method|bypass|internal request|https:\/\/example.com\/rss/i);
});

test("timestamped output never overwrites an existing run", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "folio-links-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const results = [{ ...feed, urls: ["https://example.com/story"], ok: true }];
  let current = new Date("2026-10-11T12:34:56Z");
  assert.equal(linksFilename(current), "links_2026-10-11_12-34-56.md");
  const first = await saveLinks(results, dir, { now: () => current });
  const original = await readFile(first, "utf8");
  const second = await saveLinks(results, dir, {
    now: () => current,
    wait: async () => {
      current = new Date(current.getTime() + 1000);
    },
  });
  assert.notEqual(first, second);
  assert.equal(await readFile(first, "utf8"), original);
  assert.equal((await readdir(dir)).length, 2);
});

test("collection generates a saved report, keeps successful feeds and honors environment limits", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "folio-links-cli-"));
  const server = createServer((request, response) => {
    if (request.url === "/slow") return;
    response.writeHead(200, { "content-type": "application/rss+xml" });
    response.end(rss);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = join(dir, "links");
  const research = `## Local News\n| Section | Feed |\n| --- | --- |\n| World | \`${origin}/rss\` |\n| Tech | \`${origin}/slow\` |\n`;
  // Explicit fixture transport: production's default deliberately rejects loopback feeds.
  const options = { outputDir: output, retryLimit: 0, timeoutMs: 100, limit: 5, fetchImpl: fetch };
  const result = await generateLinks(research, options);
  assert.equal(result.linkCount, 2);
  assert.equal(result.failedFeedCount, 1);
  const files = await readdir(output);
  assert.equal(files.length, 1);
  assert.match(files[0], /^links_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/);
  assert.match(await readFile(join(output, files[0]), "utf8"), /# Local News/);
  assert.equal(await readFile(join(output, files[0]), "utf8"), result.markdown);
  const oldLimit = process.env.RSS_LINKS_PER_SECTION;
  t.after(() => {
    if (oldLimit === undefined) delete process.env.RSS_LINKS_PER_SECTION;
    else process.env.RSS_LINKS_PER_SECTION = oldLimit;
  });
  process.env.RSS_LINKS_PER_SECTION = "1";
  const envRun = await generateLinks(research, {
    ...options,
    limit: undefined,
    outputDir: join(dir, "env"),
  });
  assert.equal(envRun.limit, 1);
  assert.equal(envRun.linkCount, 1);
  const failed = await generateLinks(
    `## Local News\n| Section | Feed |\n| --- | --- |\n| Tech | \`${origin}/slow\` |\n`,
    { ...options, outputDir: join(dir, "failed") },
  );
  assert.equal(failed.linkCount, 0);
  assert.equal(failed.failedFeedCount, 1);
  assert.match(failed.markdown, /unavailable/);
});

test("links endpoint authenticates, returns JSON or Markdown and prevents overlapping runs", async (t) => {
  const originalHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "test-links-key";
  t.after(() => {
    if (originalHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = originalHash;
  });
  const report = {
    savedFile: "output/links/links_2026-10-11_12-34-56.md",
    limit: 5,
    feedCount: 1,
    failedFeedCount: 0,
    linkCount: 1,
    markdown: "# News\n## World\n- <https://example.com/story>\n",
    websites: [
      {
        name: "News",
        sections: [{ name: "World", links: ["https://example.com/story"], available: true }],
      },
    ],
  };
  let calls = 0;
  const handler = createLinksHandler("research", async (source) => {
    assert.equal(source, "research");
    calls++;
    return report;
  });
  assert.equal((await handler(new Request("http://localhost/api/links?format=json"))).status, 401);
  assert.equal(calls, 0);
  const json = await handler(
    new Request("http://localhost/api/links?hash=test-links-key&format=json"),
  );
  assert.equal(json.status, 200);
  assert.deepEqual(await json.json(), report);
  const markdown = await handler(new Request("http://localhost/api/links?hash=test-links-key"));
  assert.equal(await markdown.text(), report.markdown);
  assert.equal(markdown.headers.get("x-saved-file"), report.savedFile);
  assert.equal(markdown.headers.get("cache-control"), "no-store");
  let release;
  const pending = new Promise((done) => {
    release = done;
  });
  const locked = createLinksHandler("research", async () => {
    await pending;
    return report;
  });
  const first = locked(new Request("http://localhost/api/links?hash=test-links-key"));
  assert.equal(
    (await locked(new Request("http://localhost/api/links?hash=test-links-key"))).status,
    409,
  );
  release();
  assert.equal((await first).status, 200);
  assert.equal(
    (await locked(new Request("http://localhost/api/links?hash=test-links-key"))).status,
    200,
  );
  const failed = createLinksHandler("research", async () => ({ ...report, failedFeedCount: 1 }));
  assert.equal(
    (await failed(new Request("http://localhost/api/links?hash=test-links-key"))).status,
    502,
  );
  const broken = createLinksHandler("research", async () => {
    throw new Error("EACCES: private path");
  });
  const error = await broken(
    new Request("http://localhost/api/links?hash=test-links-key&format=json"),
  );
  assert.equal(error.status, 500);
  assert.doesNotMatch(await error.text(), /EACCES|private path/);
});
