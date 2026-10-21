import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeedCatalog, discoverFeeds, SELECTIVE_LIMITS } from "../src/lib/rss/discovery.ts";
import { fetchSelectedFeeds, validateSelections } from "../src/lib/rss/selective.ts";
import { createFeedHandlers } from "../src/lib/rss/selective-api.ts";
import { parseFeedDocument } from "../src/lib/rss/selection.ts";
import { feedInventory, mainFeeds } from "../src/lib/rss/sources.ts";
import { createLinksHandler } from "../src/lib/rss/api.ts";
import { JobManager } from "../src/lib/batch/jobs.ts";
import { handleSaveBatchRequest, handleSaveBatchStatus } from "../src/lib/batch/save-batch.ts";
import { handleSaveRequest } from "../reader/save-api.ts";
import { saveArticle } from "../reader/save.ts";
import { ArticleStore } from "../src/lib/agent/articles.ts";
import { handleAgentLatest, handleAgentRead } from "../src/lib/agent/api.ts";

const source = (section, host = "example.com") => ({ site: "Example News", section, url: `https://${host}/${encodeURIComponent(section)}/feed`, ordering: "newest", format: "rss" });
const entries = [source("Main feed"), source("Canada"), source("Economy", "other.example.com"), source("Économie")];
const catalog = createFeedCatalog(entries);
const plan = (counts = [3, 1]) => ({ catalogVersion: catalog.catalogVersion, selections: counts.map((candidateLimit, index) => ({ feedId: catalog.byId.get(catalog.records.find((item) => item.section === ["Canada", "Economy"][index]).feedId).feedId, candidateLimit })) });
const rss = (host = "example.com", count = 5) => `<rss><channel>${Array.from({ length: count }, (_, i) => `<item><title>Story ${i}</title><link>https://${host}/stories/${i}?utm_source=feed</link><description>A sufficiently detailed feed summary for assessing the importance of this story.</description></item>`).join("")}</channel></rss>`;
const url = (query = "") => new URL(`https://folio.example/api/feed-catalog?${query}`);

test("catalog enumerates every record with stable identity and honest metadata without changing Main selection", () => {
  const real = createFeedCatalog(feedInventory);
  assert.equal(real.records.length, 1734);
  assert.equal(real.records.filter((feed) => feed.isMain).length, 10);
  assert.equal(mainFeeds.length, 10);
  const reversed = createFeedCatalog([...entries].reverse());
  assert.deepEqual(reversed, catalog);
  const modified = createFeedCatalog(entries.map((feed) => ({ ...feed, homepageScore: 3 })));
  assert.notEqual(modified.catalogVersion, catalog.catalogVersion);
  assert.deepEqual(modified.records.map((feed) => feed.feedId), catalog.records.map((feed) => feed.feedId));
  assert.ok(real.records.every((record) => record.descriptionSource === "catalog-label" && record.compatibility === "unverified"));
});

test("catalog OR keywords, accent/case normalization, publisher filter and scoped pagination", () => {
  const first = discoverFeeds(url("q=CANADA&q=economie&q=canada&limit=1&hash=private"), catalog);
  assert.equal(first.matchMode, "OR");
  assert.equal(first.totalMatched, 2);
  assert.equal(first.items.length, 1);
  assert.ok(first.nextUrl && !first.nextUrl.includes("private") && !first.nextUrl.includes("hash="));
  const second = discoverFeeds(new URL(first.nextUrl, "https://folio.example"), catalog);
  assert.equal(second.nextUrl, null);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.feedId)).size, 2);
  assert.throws(() => discoverFeeds(new URL(`${first.nextUrl}&q=other`, "https://folio.example"), catalog), { status: 400 });
  assert.throws(() => discoverFeeds(new URL(first.nextUrl, "https://folio.example"), createFeedCatalog([...entries, source("Extra")])), { status: 409 });
  const filtered = discoverFeeds(url("q=canada&q=economy&publisher=example%20news"), catalog);
  assert.equal(filtered.totalMatched, 2);
  assert.ok(filtered.items.every((item) => item.matchedKeywords.length && item.matchedFields.includes("section")));
  assert.equal(discoverFeeds(url("q=no-such-topic"), catalog).totalMatched, 0);
  assert.equal(discoverFeeds(url(), catalog).totalMatched, entries.length);
  for (const query of ["q=", "limit=0", "limit=101", "limit=2.5", "publisher=unknown", "allFeeds=true", "cursor=garbage", "limit=1&limit=2", Array(13).fill("q=a").join("&")])
    assert.throws(() => discoverFeeds(url(query), catalog), { status: 400 });
});

test("all selected IDs/versions/limits are validated before transport; arbitrary URL overrides rejected", async () => {
  const valid = plan();
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(rss()); };
  const cases = [
    { ...valid, url: "http://127.0.0.1" },
    { ...valid, catalogVersion: "0".repeat(64) },
    { ...valid, selections: [] },
    { ...valid, selections: Array(9).fill(valid.selections[0]) },
    { ...valid, selections: [valid.selections[0], valid.selections[0]] },
    { ...valid, selections: [{ ...valid.selections[0], feedId: `feed_${"0".repeat(64)}` }] },
    { ...valid, selections: [{ ...valid.selections[0], candidateLimit: 0 }] },
    { ...valid, selections: [{ ...valid.selections[0], candidateLimit: 21 }] },
    { ...valid, selections: [{ ...valid.selections[0], headers: {} }] },
  ];
  for (const input of cases) await assert.rejects(fetchSelectedFeeds(input, catalog, { fetchImpl }));
  const large = createFeedCatalog(Array.from({ length: 8 }, (_, i) => source(`Section${i}`)));
  assert.throws(() => validateSelections({ catalogVersion: large.catalogVersion, selections: large.records.map((record) => ({ feedId: record.feedId, candidateLimit: 20 })) }, large), { status: 400 });
  assert.equal(calls, 0);
});

test("selective fetch honors independent counts, provenance and deduped canonical URLs without requiring Main feeds", async () => {
  const requests = [];
  const report = await fetchSelectedFeeds(plan(), catalog, { fetchImpl: async (input) => { requests.push(String(input)); return new Response(rss()); } });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => !url.includes("Main")));
  assert.deepEqual(report.feeds.map((feed) => feed.candidates.length), [3, 1]);
  assert.equal(report.candidateCount, 4);
  assert.equal(report.uniqueCandidateCount, 3);
  assert.ok(report.feeds.every((feed) => feed.status === "ok" && feed.truncated));
  assert.ok(report.feeds[0].candidates.every((candidate) => candidate.title && candidate.summary && candidate.publishedAt === null && !candidate.url.includes("utm_")));
  assert.equal("savedFile" in report, false);
});

test("feed content detection covers RSS, Atom, RDF, news/plain sitemap, JSON Feed and Reuters JSON", () => {
  const feed = source("Formats");
  const formats = [
    [rss(), "rss"],
    [`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title><link href="https://example.com/story/atom"/><summary>A detailed Atom description giving enough context to select this article.</summary></entry></feed>`, "atom"],
    [`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"><item><title>RDF</title><link>https://example.com/story/rdf</link></item></rdf:RDF>`, "rdf"],
    [`<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>https://example.com/story/news</loc><news:news><news:title>News</news:title></news:news></url></urlset>`, "news-sitemap"],
    [`<urlset><url><loc>https://example.com/story/plain</loc></url></urlset>`, "sitemap"],
    [JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ url: "https://example.com/story/json", title: "JSON", content_text: "A detailed JSON feed summary with sufficient context for candidate selection.", date_published: new Date().toISOString() }] }), "json-feed"],
  ];
  for (const [body, expected] of formats) {
    const parsed = parseFeedDocument(body, feed);
    assert.equal(parsed.format, expected);
    assert.ok(parsed.candidates.length > 0, expected);
  }
  const reuters = parseFeedDocument(JSON.stringify({ result: { articles: [{ canonical_url: "/world/story", title: "Reuters story", description: "Detailed Reuters context to help decide whether to read this article in full.", published_time: new Date().toISOString() }] } }), { ...feed, site: "Reuters" });
  assert.equal(reuters.format, "reuters-json");
  assert.equal(reuters.candidates[0].url, "https://www.reuters.com/world/story");
  for (const body of ["<html><body>Access denied</body></html>", "<rss>", '{"items":[]}', '<!DOCTYPE rss [<!ENTITY x "evil">]><rss/>'])
    assert.throws(() => parseFeedDocument(body, feed));
  assert.deepEqual(parseFeedDocument("<urlset/>", feed).candidates, []);
  assert.deepEqual(parseFeedDocument("<feed/>", feed).candidates, []);
  assert.throws(() => parseFeedDocument(`<rss><channel>${"<item/>".repeat(2001)}</channel></rss>`, feed));
});

test("sitemap index traversal is same-origin, shallow, bounded and explicit about omissions", async () => {
  const calls = [];
  const body = `<sitemapindex>${["https://evil.example/secret", ...Array.from({ length: 5 }, (_, i) => `https://example.com/child${i}.xml`)].map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join("")}</sitemapindex>`;
  const input = { ...plan(), selections: [plan().selections[0]] };
  const report = await fetchSelectedFeeds(input, catalog, { fetchImpl: async (input) => {
    const raw = String(input); calls.push(raw);
    return new Response(raw.includes("child") ? `<urlset><url><loc>https://example.com/articles/${calls.length}</loc></url></urlset>` : body);
  } });
  assert.equal(calls.length, 4);
  assert.ok(calls.every((url) => new URL(url).origin === "https://example.com"));
  assert.equal(report.feeds[0].documentFormat, "sitemap-index");
  assert.equal(report.feeds[0].candidates.length, 3);
  assert.equal(report.partial, true);
  assert.ok(report.feeds[0].warnings.length > 0);
});

test("partial failures, HTML rejection and filtered partner-domain articles are reported instead of silently promoted", async () => {
  const report = await fetchSelectedFeeds(plan(), catalog, { fetchImpl: async (input) => String(input).includes("Canada") ? new Response(rss()) : new Response("unavailable", { status: 503 }) });
  assert.equal(report.failedFeedCount, 1);
  assert.equal(report.partial, true);
  assert.equal(report.feeds[1].httpStatus, 503);
  const malformed = await fetchSelectedFeeds(plan(), catalog, { fetchImpl: async () => new Response("<html>Not a feed</html>") });
  assert.ok(malformed.feeds.every((feed) => feed.status === "parse_failed"));
  const partner = createFeedCatalog([{ ...source("Partner"), site: "Bloomberg" }]);
  const filtered = await fetchSelectedFeeds({ catalogVersion: partner.catalogVersion, selections: [{ feedId: partner.records[0].feedId, candidateLimit: 2 }] }, partner, { fetchImpl: async () => new Response(rss("bnnbloomberg.ca")) });
  assert.equal(filtered.feeds[0].status, "empty");
  assert.ok(filtered.feeds[0].warnings.some((warning) => warning.includes("publisher-domain")));
});

test("request deadline aborts body reads; no retries or hidden fallbacks", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    let calls = 0;
    const started = Date.now();
    const result = await fetchSelectedFeeds(plan(), catalog, { timeoutMs: 25, feedTimeoutMs: 20, fetchImpl: async () => {
      calls++;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("<rss>")); } }));
    } });
    assert.equal(calls, 2);
    assert.ok(Date.now() - started < 500);
    assert.ok(result.feeds.every((feed) => feed.status === "deadline_exceeded"));
  } finally { clearTimeout(keepAlive); }
});

test("selected transport enforces bytes, private-network exclusion and bounded per-origin concurrency", async () => {
  const oversized = await fetchSelectedFeeds(plan(), catalog, { fetchImpl: async () => new Response("x".repeat(2_000_001)) });
  assert.ok(oversized.feeds.every((feed) => feed.status === "fetch_failed"));
  const privateCatalog = createFeedCatalog([{ ...source("Private"), url: "http://169.254.169.254/metadata" }]);
  let privateCalls = 0;
  const denied = await fetchSelectedFeeds({ catalogVersion: privateCatalog.catalogVersion, selections: [{ feedId: privateCatalog.records[0].feedId, candidateLimit: 1 }] }, privateCatalog, {
    fetchImpl: async () => { privateCalls++; return new Response(rss()); },
  });
  assert.equal(privateCalls, 0);
  assert.equal(denied.feeds[0].status, "fetch_failed");
  const many = createFeedCatalog([source("One"), source("Two"), source("Three", "different.example.com"), source("Four", "different.example.com")]);
  let active = 0, peak = 0;
  const origins = new Set();
  const report = await fetchSelectedFeeds({ catalogVersion: many.catalogVersion, selections: many.records.map(({ feedId }) => ({ feedId, candidateLimit: 1 })) }, many, {
    fetchImpl: async (raw) => {
      const origin = new URL(raw).origin;
      assert.ok(!origins.has(origin));
      origins.add(origin); active++; peak = Math.max(peak, active);
      await sleep(5);
      active--; origins.delete(origin);
      return new Response(rss());
    },
  });
  assert.equal(report.feedCount, 4);
  assert.equal(peak, 2);
});

test("feed redirects remain bounded and private redirects never reach transport", async () => {
  const input = { ...plan(), selections: [plan().selections[0]] };
  let calls = 0;
  const loop = await fetchSelectedFeeds(input, catalog, { fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: "/redirect" } }); } });
  assert.equal(calls, 6);
  assert.equal(loop.feeds[0].status, "fetch_failed");
  calls = 0;
  const privateRedirect = await fetchSelectedFeeds(input, catalog, { fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }); } });
  assert.equal(calls, 1);
  assert.equal(privateRedirect.feeds[0].status, "fetch_failed");
});

test("index children and redirect hops share the request-wide transport count budget", async () => {
  const large = createFeedCatalog(Array.from({ length: 8 }, (_, i) => source(`Group${i}`, `site${i}.example.com`)));
  let calls = 0;
  const response = await fetchSelectedFeeds({ catalogVersion: large.catalogVersion, selections: large.records.map(({ feedId }) => ({ feedId, candidateLimit: 1 })) }, large, {
    fetchImpl: async (raw) => {
      calls++;
      const url = new URL(raw);
      if (url.pathname.endsWith("/feed"))
        return new Response(`<sitemapindex>${[0, 1, 2].map((i) => `<sitemap><loc>${url.origin}/child${i}?hop=0</loc></sitemap>`).join("")}</sitemapindex>`);
      const hop = Number(url.searchParams.get("hop"));
      if (hop < 5) {
        url.searchParams.set("hop", String(hop + 1));
        return new Response(null, { status: 302, headers: { location: url.href } });
      }
      return new Response(`<urlset><url><loc>${url.origin}/articles/${url.pathname.slice(1)}</loc></url></urlset>`);
    },
  });
  assert.equal(calls, SELECTIVE_LIMITS.maxOutboundRequests);
  assert.equal(response.partial, true);
  assert.ok(response.failedFeedCount > 0);
});

test("Google wrappers resolve without publishing wrappers, with original candidate metadata preserved", async () => {
  const google = createFeedCatalog([{ ...source("Google"), site: "Reuters", url: "https://news.google.com/rss/search?q=test" }]);
  const input = { catalogVersion: google.catalogVersion, selections: [{ feedId: google.records[0].feedId, candidateLimit: 1 }] };
  const report = await fetchSelectedFeeds(input, google, { fetchImpl: async (raw, init) => {
    const url = String(raw);
    assert.ok(init?.signal);
    if (url.includes("rss/search")) return new Response('<rss><channel><item><title>Canada economy news</title><link>https://news.google.com/rss/articles/CBMiFixture</link><description>Some useful Reuters context.</description></item></channel></rss>');
    assert.equal(init.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://www.reuters.com/world/canada-story" } });
  } });
  assert.equal(report.feeds[0].candidates[0].url, "https://www.reuters.com/world/canada-story");
  assert.equal(report.feeds[0].candidates[0].title, "Canada economy news");
});

test("HTTP handlers require query hash, bound/validate bodies and share admission with daily links", async (t) => {
  const old = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "selective-test-key";
  t.after(() => { if (old === undefined) delete process.env.ACCESS_HASH; else process.env.ACCESS_HASH = old; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const notified = new Promise((resolve) => { started = resolve; });
  const handlers = createFeedHandlers(catalog, { fetchImpl: async () => { started(); await gate; return new Response(rss()); } });
  const request = (body = plan(), authenticated = true) => new Request(`https://folio.example/api/feed-fetch${authenticated ? "?hash=selective-test-key" : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await handlers.fetch(request(plan(), false))).status, 401);
  assert.equal((await handlers.catalog(new Request("https://folio.example/api/feed-catalog", { headers: { authorization: "Bearer selective-test-key" } }))).status, 401);
  const discovery = await handlers.catalog(new Request("https://folio.example/api/feed-catalog?hash=selective-test-key&q=canada&q=economy"));
  assert.equal(discovery.status, 200);
  assert.equal(discovery.headers.get("cache-control"), "no-store");
  assert.equal((await discovery.json()).totalMatched, 2);
  assert.equal((await handlers.fetch(request({ ...plan(), unexpected: true }))).status, 400);
  assert.equal((await handlers.fetch(new Request("https://folio.example/api/feed-fetch?hash=selective-test-key", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).status, 400);
  assert.equal((await handlers.fetch(new Request("https://folio.example/api/feed-fetch?hash=selective-test-key", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(17000) }))).status, 413);
  const running = handlers.fetch(request());
  await notified;
  const busy = await handlers.fetch(request());
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get("retry-after"), "5");
  const daily = createLinksHandler(entries, async () => { throw Error("Must not run while selective fetch active"); });
  assert.equal((await daily(new Request("https://folio.example/api/links?hash=selective-test-key"))).status, 429);
  release();
  assert.equal((await running).status, 200);
  assert.equal(SELECTIVE_LIMITS.maxCandidates, 100);
});

test("topic discovery → candidates → selective save → latest manifest → verified chunks works end to end", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-topic-flow-"));
  const old = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "topic-flow-test-key";
  t.after(async () => {
    if (old === undefined) delete process.env.ACCESS_HASH; else process.env.ACCESS_HASH = old;
    await rm(root, { recursive: true, force: true });
  });
  const key = "topic-flow-test-key";
  const handlers = createFeedHandlers(catalog, { fetchImpl: async () => new Response(rss()) });
  const discovery = await (await handlers.catalog(new Request(`https://folio.example/api/feed-catalog?hash=${key}&q=canada&q=economy`))).json();
  const selectedFeed = discovery.items.find((feed) => feed.section === "Canada");
  const candidates = await (await handlers.fetch(new Request(`https://folio.example/api/feed-fetch?hash=${key}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ catalogVersion: discovery.catalogVersion, selections: [{ feedId: selectedFeed.feedId, candidateLimit: 3 }] }),
  }))).json();
  // External editorial selection: deliberately save only one of the three candidates.
  const selectedArticle = candidates.feeds[0].candidates[1];
  const articleText = "# Canadian economy fixture\n\n" + "Exact Unicode café 📰 economic evidence.\n".repeat(50);
  const manager = new JobManager({ root, fetchImpl: async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/save");
    assert.equal(url.searchParams.get("url"), selectedArticle.url);
    return handleSaveRequest(new Request(url), {
      getJob: (id) => manager.get(id),
      read: async () => ({ title: "Canadian economy fixture", author: "Fixture", published: "", originalUrl: selectedArticle.url, text: articleText, markdown: articleText, images: [], partial: false }),
      save: (article, options) => saveArticle(article, { ...options, outputDir: join(root, "output/articles") }),
    });
  } });
  const accepted = await handleSaveBatchRequest(new Request(`https://folio.example/api/save-batch?hash=${key}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ urls: [{ url: selectedArticle.url, website: selectedFeed.publisher, section: selectedFeed.section }], format: "markdown" }),
  }), manager);
  assert.equal(accepted.status, 202);
  const { callId, statusEndpoint } = await accepted.json();
  let status;
  for (let attempt = 0; attempt < 200; attempt++) {
    const query = new URL(statusEndpoint, "https://folio.example"); query.searchParams.set("hash", key);
    status = await (await handleSaveBatchStatus(new Request(query), manager)).json();
    if (status.status !== "in progress") break;
    await sleep(5);
  }
  assert.equal(status.status, "completed");
  assert.equal(status.saved, 1);
  const store = new ArticleStore(root);
  const manifest = await (await handleAgentLatest(new Request(`https://folio.example/api/agent/latest?hash=${key}`), store)).json();
  assert.ok(manifest.collections.some((job) => job.callId === callId));
  assert.equal(manifest.articleCount, 1);
  const article = manifest.articles[0];
  assert.ok(status.results[0].savedFile.endsWith(`/${manifest.folder}/${article.filename}`));
  let navigation = article.readUrl + "&limit=37";
  let reconstructed = "";
  while (navigation) {
    const url = new URL(navigation, "https://folio.example"); url.searchParams.set("hash", key);
    const chunk = await (await handleAgentRead(new Request(url), store)).json();
    reconstructed += chunk.text;
    assert.equal(chunk.snapshotId, manifest.snapshotId);
    navigation = chunk.nextUrl;
  }
  assert.equal(reconstructed, articleText);
  assert.equal(Buffer.byteLength(reconstructed), article.bytes);
  assert.equal(Array.from(reconstructed).length, article.characters);
  assert.equal(createHash("sha256").update(reconstructed).digest("hex"), article.sha256);
  assert.equal(await readFile(join(root, status.results[0].savedFile), "utf8"), reconstructed);
});
