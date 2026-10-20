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
  buildLinksReport,
  saveLinks,
} from "../src/lib/rss/links.ts";
import { validateFeedCatalog } from "../src/lib/rss/catalog.ts";
import { createLinksHandler } from "../src/lib/rss/api.ts";
import { feedInventory as catalog, mainFeeds } from "../src/lib/rss/sources.ts";

const feed = { site: "Example News", section: "World", url: "https://example.com/rss" };
const catalogEntry = { ...feed, ordering: "feed", format: "rss" };
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><link>https://example.com</link><description>News</description>
<item><title>First</title><link>https://example.com/story?a=1&amp;b=2</link></item>
<item><title>Duplicate</title><link>https://example.com/story?a=1&amp;b=2#fragment</link></item>
<item><title>Relative</title><link>/other</link></item>
<item><title>Unsafe</title><link>javascript:alert(1)</link></item>
<item><title>Credentials</title><link>https://user:pass@example.com/private</link></item>
<item><title>Only ID</title><guid isPermaLink="false">internal-id</guid></item>
</channel></rss>`;

test("catalog preserves the ten primary feed URLs and metadata alongside WSJ and NY Times additions", async () => {
  const allFeeds = validateFeedCatalog(catalog);
  assert.equal(allFeeds.length, 708);
  const feeds = allFeeds.filter((item) => item.section === "Main feed");
  assert.equal(feeds.length, 10);
  assert.equal(new Set(feeds.map((item) => item.site)).size, 10);
  const urls = new Set(feeds.map((item) => item.url));
  assert.deepEqual([...urls].sort(), [
    "https://flipboard.com/@WSJ.rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    "https://www.washingtonpost.com/arcio/rss/",
    "https://www.bloomberg.com/sitemaps/news/latest.xml",
    "https://www.economist.com/latest/rss.xml",
    "https://www.ft.com/?format=rss",
    "https://foreignpolicy.com/feed/",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    "https://news.google.com/rss/search?q=when:24h+site:reuters.com&ceid=US:en&hl=en-US&gl=US",
    "https://www.businessinsider.com/sitemap/google-news.xml",
  ].sort());
  assert.ok(urls.has("https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"));
  assert.ok(urls.has("https://flipboard.com/@WSJ.rss"));
  assert.ok(urls.has("https://www.bloomberg.com/sitemaps/news/latest.xml"));
  assert.ok(urls.has("https://www.businessinsider.com/sitemap/google-news.xml"));
  assert.equal(feeds.find((item) => item.site === "Bloomberg").format, "news-sitemap");
  assert.equal(feeds.find((item) => item.site === "NY Times").ordering, "editorial");
  assert.equal(feeds.find((item) => item.site === "Financial Times").homepageScore, 9);
  assert.deepEqual(feeds.map(({ site, ordering, format, homepageScore, edition }) => [site, ordering, format, homepageScore, edition]), [
    ["WSJ", "newest", "rss", 8, "US"],
    ["NY Times", "editorial", "rss", 8, "US"],
    ["Washington Post", "newest", "rss", 6, "US"],
    ["Bloomberg", "newest", "news-sitemap", 4, "Only one"],
    ["The Economist", "newest", "rss", 5, "Only one"],
    ["Financial Times", "editorial", "rss", 9, "International"],
    ["Foreign Policy", "newest", "rss", 7, "Only one"],
    ["CNBC", "editorial", "rss", 9, "US"],
    ["Reuters", "google-ranked", "rss", 4, "US"],
    ["Business Insider", "newest", "news-sitemap", 7, "US"],
  ]);
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

test("catalog validates explicit fields and rejects Markdown, prose, unsafe URLs and invalid metadata", () => {
  for (const invalid of [null, {}, "# Feeds\n| Site | URL |", JSON.stringify([catalogEntry])]) {
    assert.throws(() => validateFeedCatalog(invalid), /JSON array/);
  }
  for (const invalid of [
    null, [], {},
    { ...catalogEntry, site: "" }, { ...catalogEntry, section: " " },
    { ...catalogEntry, url: "not-a-url" }, { ...catalogEntry, url: "file:///private/file" },
    { ...catalogEntry, url: "https://user:private-password@example.com/feed" },
    { ...catalogEntry, ordering: undefined }, { ...catalogEntry, ordering: "Newest first" },
    { ...catalogEntry, format: undefined }, { ...catalogEntry, format: "xml" },
    { ...catalogEntry, homepageScore: "8" }, { ...catalogEntry, homepageScore: NaN },
    { ...catalogEntry, homepageScore: -1 }, { ...catalogEntry, homepageScore: 11 },
    { ...catalogEntry, edition: 12 }, { ...catalogEntry, edition: "" },
    { ...catalogEntry, description: "Homepage, in order" },
    { ...catalogEntry, evidence: "Alternate: https://example.com/extra" },
  ]) {
    assert.throws(() => validateFeedCatalog([invalid]), (error) => {
      assert.match(error.message, /Invalid feed catalog entry 1/);
      assert.doesNotMatch(error.message, /private-password/);
      return true;
    });
  }
  assert.deepEqual(validateFeedCatalog([]), []);
});

test("catalog normalizes URLs, preserves section identity and deduplicates without mutating input", () => {
  const source = [
    { ...catalogEntry, site: " Example News ", section: " World ", url: "https://EXAMPLE.COM:443/rss" },
    catalogEntry,
    { ...catalogEntry, section: "Tech" },
  ];
  const original = structuredClone(source);
  assert.deepEqual(validateFeedCatalog(source), [catalogEntry, { ...catalogEntry, section: "Tech" }]);
  assert.deepEqual(source, original);
});

test("a smaller JSON catalog fetches only its explicit URLs and yields at most one article per entry", async () => {
  const feeds = validateFeedCatalog([
    { ...catalogEntry, site: "Example One", url: "https://example.com/one" },
    { ...catalogEntry, site: "Example Two", url: "https://example.com/nyt" },
  ]);
  const requested = [];
  const results = await collectFeeds(feeds, {
    limit: 1,
    fetchImpl: async (url) => {
      requested.push(url);
      return new Response(rss);
    },
  });
  assert.deepEqual(requested, ["https://example.com/one", "https://example.com/nyt"]);
  assert.equal(
    results.reduce((sum, result) => sum + result.urls.length, 0),
    2,
  );
});

test("limit one fetches only the ten main feeds, never the reference feeds", async () => {
  const feeds = mainFeeds;
  let feedRequests = 0;
  let resolveRequests = 0;
  const results = await collectFeeds(feeds, {
    limit: 1,
    fetchImpl: async (input) => {
      if (input.includes("/rss/articles/CBMiTEST")) {
        resolveRequests++;
        const testNum = input.split("CBMiTEST")[1]?.split("?")[0] || "0";
        return new Response(null, { 
          status: 302, 
          headers: { 
            location: `https://www.reuters.com/world/test-article-${testNum}-2026-10-15/`,
            "content-type": "text/html" 
          } 
        });
      }
      feedRequests++;
      const entry = feeds.find((item) => item.url === String(input));
      const domains = {
        WSJ: "wsj.com",
        "NY Times": "nytimes.com",
        "Washington Post": "washingtonpost.com",
        Bloomberg: "bloomberg.com",
        "The Economist": "economist.com",
        "Financial Times": "ft.com",
        "Foreign Policy": "foreignpolicy.com",
        CNBC: "cnbc.com",
        Reuters: "reuters.com",
        "Business Insider": "businessinsider.com",
      };
      const url = `https://www.${domains[entry.site]}/news/story`;
      if (entry.site === "Reuters") {
        return new Response(
          `<rss version="2.0"><channel><title>Google News</title>` +
          Array.from({ length: 5 }, (_, i) => 
            `<item><title>Test Article ${i}</title><link>https://news.google.com/rss/articles/CBMiTEST${i}?oc=5</link></item>`
          ).join("") +
          `</channel></rss>`,
          { headers: { "content-type": "application/xml" } },
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
  assert.equal(feedRequests, 10, `feed requests: ${details}`);
  assert.ok(resolveRequests > 0, "Reuters wrappers are resolved in the fixture");
  const wsj = results.filter(({ site }) => site === "WSJ");
  assert.equal(wsj.length, 1);
  assert.ok(wsj.every(({ urls }) => urls.length === 1 && urls[0] === "https://www.wsj.com/news/story"));
  const nyt = results.filter(({ site }) => site === "NY Times");
  assert.equal(nyt.length, 1);
  assert.ok(nyt.every(({ urls }) => urls.length === 1 && urls[0] === "https://www.nytimes.com/news/story"));
  assert.equal(
    results.reduce((sum, result) => sum + result.urls.length, 0),
    10,
    `total urls: ${details}`,
  );
});

test("extracts and deduplicates RSS article links, not IDs or unsafe URLs", async () => {
  assert.deepEqual(await parseArticleLinks(rss, feed.url), [
    "https://example.com/story?a=1&b=2",
    "https://example.com/other",
  ]);
});

test("GET/POST links filter the full inventory before transport and cannot enable references or fallback", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "folio-main-feeds-"));
  const old = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "main-feed-test-key";
  t.after(async () => {
    if (old === undefined) delete process.env.ACCESS_HASH; else process.env.ACCESS_HASH = old;
    await rm(output, { recursive: true, force: true });
  });
  let run = 0;
  const calls = [];
  const handle = createLinksHandler(catalog, (source) => {
    assert.deepEqual(source, mainFeeds);
    return generateLinks(source, {
      outputDir: join(output, String(run++)), retryLimit: 0, limit: 1,
      fetchImpl: async (input) => {
        calls.push(String(input));
        // Deliberately empty mains: reference feeds must not be used to refill them.
        return new Response("<rss><channel><title>Empty main</title></channel></rss>");
      },
    });
  });
  for (const method of ["GET", "POST"]) {
    const response = await handle(new Request("https://folio.example/api/links?hash=main-feed-test-key&section=all&allFeeds=true", {
      method, ...(method === "POST" ? { body: JSON.stringify({ feeds: catalog }) } : {}),
    }));
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.feedCount, 10);
    assert.equal(report.linkCount, 0);
    assert.ok(report.websites.every(({ sections }) => sections.length === 1 && sections[0].name === "Main feed"));
  }
  // Direct generator use must have the same policy even without the HTTP handler.
  const direct = await generateLinks(catalog, {
    outputDir: join(output, "direct"), retryLimit: 0,
    fetchImpl: async (input) => {
      calls.push(String(input));
      return new Response("unavailable", { status: 503 });
    },
  });
  assert.equal(direct.failedFeedCount, 10);
  assert.equal(direct.linkCount, 0);
  assert.equal(calls.length, 30);
  for (const url of mainFeeds.map(({ url }) => url)) assert.equal(calls.filter((call) => call === url).length, 3);
  assert.ok(calls.every((url) => mainFeeds.some((feed) => feed.url === url)));
  let dispatched = false;
  await assert.rejects(generateLinks(catalog.filter(({ section }) => section !== "Main feed"), {
    outputDir: join(output, "invalid"), fetchImpl: async () => { dispatched = true; return new Response(); },
  }), /exactly one Main feed/);
  assert.equal(dispatched, false);
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
  assert.equal(buildLinksReport(rawResults).linkCount, 5);
  assert.equal(buildLinksReport(rawResults, new Date(), 7).linkCount, 7);
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

test("JSON groups sites and sections without request metadata", () => {
  const report = buildLinksReport(
    [
      { ...feed, urls: ["https://example.com/story"], ok: true },
      { ...feed, urls: ["https://example.com/story", "https://example.com/second"], ok: true },
      { ...feed, section: "Tech", urls: [], ok: false },
      { ...feed, site: "Other", urls: [], ok: true },
    ],
    new Date("2026-10-11T12:34:56Z"),
  );
  assert.deepEqual(report.websites.map((site) => site.name), ["Example News", "Other"]);
  assert.deepEqual(report.websites[0].sections.map((section) => section.name), ["World", "Tech"]);
  assert.equal(report.websites[0].sections[0].articles.length, 2);
  assert.equal(report.websites[0].sections[1].available, false);
  assert.deepEqual(report.websites[1].sections[0].articles, []);
  assert.equal(report.linkCount, 2);
  assert.doesNotMatch(JSON.stringify(report), /method|bypass|internal request|https:\/\/example.com\/rss/i);
});

test("timestamped output never overwrites an existing run", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "folio-links-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const results = [{ ...feed, urls: ["https://example.com/story"], ok: true }];
  let current = new Date("2026-10-11T12:34:56Z");
  assert.equal(linksFilename(current), "links_2026-10-11_12-34-56.json");
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
  const source = [
    { ...catalogEntry, site: "Local News", section: "Main feed", url: `${origin}/rss` },
    { ...catalogEntry, site: "Slow News", section: "Main feed", url: `${origin}/slow` },
  ];
  // Explicit fixture transport: production's default deliberately rejects loopback feeds.
  const options = { outputDir: output, retryLimit: 0, timeoutMs: 100, limit: 5, fetchImpl: fetch };
  const result = await generateLinks(source, options);
  assert.equal(result.linkCount, 2);
  assert.equal(result.failedFeedCount, 1);
  const files = await readdir(output);
  assert.equal(files.length, 1);
  assert.match(files[0], /^links_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);
  assert.equal(result.websites[0].name, "Local News");
  assert.deepEqual(JSON.parse(await readFile(join(output, files[0]), "utf8")), result);
  const oldLimit = process.env.RSS_LINKS_PER_SECTION;
  t.after(() => {
    if (oldLimit === undefined) delete process.env.RSS_LINKS_PER_SECTION;
    else process.env.RSS_LINKS_PER_SECTION = oldLimit;
  });
  process.env.RSS_LINKS_PER_SECTION = "1";
  const envRun = await generateLinks(source, {
    ...options,
    limit: undefined,
    outputDir: join(dir, "env"),
  });
  assert.equal(envRun.limit, 1);
  assert.equal(envRun.linkCount, 1);
  const failed = await generateLinks(
    [source[1]],
    { ...options, outputDir: join(dir, "failed") },
  );
  assert.equal(failed.linkCount, 0);
  assert.equal(failed.failedFeedCount, 1);
  assert.equal(failed.websites[0].sections[0].available, false);
});

test("links endpoint authenticates, returns only JSON and prevents overlapping runs", async (t) => {
  const originalHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "test-links-key";
  t.after(() => {
    if (originalHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = originalHash;
  });
  const report = buildLinksReport([{ ...feed, urls: ["https://example.com/story"], ok: true }], new Date("2026-10-11T12:34:56Z"));
  let calls = 0;
  const sourceCatalog = [{ ...catalogEntry, section: "Main feed" }];
  const handler = createLinksHandler(sourceCatalog, async (source) => {
    assert.deepEqual(source, sourceCatalog);
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
  const defaultResponse = await handler(new Request("http://localhost/api/links?hash=test-links-key"));
  assert.deepEqual(await defaultResponse.json(), report);
  assert.equal(defaultResponse.headers.get("x-saved-file"), report.savedFile);
  assert.equal(defaultResponse.headers.get("cache-control"), "no-store");
  assert.equal((await handler(new Request("http://localhost/api/links?hash=test-links-key&format=markdown"))).status, 400);
  let release;
  const pending = new Promise((done) => {
    release = done;
  });
  const locked = createLinksHandler(sourceCatalog, async () => {
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
  const failed = createLinksHandler(sourceCatalog, async () => ({ ...report, failedFeedCount: 1 }));
  assert.equal(
    (await failed(new Request("http://localhost/api/links?hash=test-links-key"))).status,
    502,
  );
  const broken = createLinksHandler(sourceCatalog, async () => {
    throw new Error("EACCES: private path");
  });
  const error = await broken(
    new Request("http://localhost/api/links?hash=test-links-key&format=json"),
  );
  assert.equal(error.status, 500);
  assert.doesNotMatch(await error.text(), /EACCES|private path/);
});
