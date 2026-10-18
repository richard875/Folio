import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCandidates } from "./selection.ts";
import { collectFeeds, generateLinks, buildLinksReport, parseReutersJson } from "./links.ts";
import { parseLinksFile } from "../batch/jobs.ts";
import { createLinksHandler } from "./api.ts";
import { parseLinksReport } from "./report.ts";

const feed = { site: "Example", section: "Main feed", url: "https://example.com/feed" };
const summary = "The central bank announced new measures to support lending across the country.";
const rss = (body: string) => `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>${body}</channel></rss>`;
const item = (body: string, path = "story") => `<item><title>Headline</title><link>https://example.com/${path}</link>${body}</item>`;

test("link report schema rejects malformed versions, metadata, counts and article fields", () => {
  const report = buildLinksReport([{ ...feed, ok: true, urls: ["https://example.com/story"] }]);
  const parse = (value: unknown) => parseLinksReport(JSON.stringify(value));
  for (const changes of [
    { schemaVersion: 2 }, { generatedAt: "yesterday" }, { limit: 0 },
    { savedFile: "output/links/../../secret.json" }, { savedFile: "output/links/links_2026-10-11_12-34-56.md" },
    { linkCount: 2 }, { failedFeedCount: 2 }, { markdown: "legacy" }, { websites: null },
  ]) assert.throws(() => parse({ ...report, ...changes }));
  for (const article of [
    { url: "javascript:alert(1)" }, { url: "https://user:password@example.com/story" },
    { summary: "Missing URL" }, { url: "https://example.com/story", summary: null },
    { url: "https://example.com/story", summary: "x".repeat(1001) },
  ]) {
    const invalid = structuredClone(report);
    invalid.websites[0].sections[0].articles = [article as { url: string }];
    assert.throws(() => parse(invalid));
  }
  assert.throws(() => parseLinksFile("# Legacy Markdown\n## Feed\n- <https://example.com/story>"));
  assert.throws(() => parseLinksFile("{ invalid JSON"));
  assert.deepEqual(parse(report), report);
});

test("RSS summaries decode HTML/entities, remove active content and preserve word boundaries", () => {
  const [candidate] = parseCandidates(rss(item(`<description><![CDATA[<p>The central bank &amp; lenders</p><p>announced &ldquo;new measures&rdquo; for the country.</p><script>bad()</script><style>hidden</style>]]></description>`)), feed);
  assert.equal(candidate.summary, "The central bank & lenders announced “new measures” for the country.");
});

test("RSS description takes priority with content:encoded as an optional fallback (including RDF)", () => {
  assert.equal(parseCandidates(rss(item(`<description>${summary}</description><content:encoded>Another long description that should not replace the preferred feed summary.</content:encoded>`)), feed)[0].summary, summary);
  const body = item(`<description>Read more</description><content:encoded><![CDATA[<p>${summary}</p>]]></content:encoded>`);
  assert.equal(parseCandidates(rss(body), feed)[0].summary, summary);
  assert.equal(parseCandidates(`<rdf:RDF xmlns:rdf="urn:rdf" xmlns:content="urn:content">${body}</rdf:RDF>`, feed)[0].summary, summary);
});

test("Atom supports plain text, escaped HTML, XHTML summaries and inline content fallback", () => {
  for (const field of [
    `<summary>${summary}</summary>`,
    `<summary type="html">&lt;p&gt;${summary}&lt;/p&gt;</summary>`,
    `<summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>The central bank announced new measures</p><p>to support lending across the country.</p></div></summary>`,
    `<summary>Short</summary><content type="html">&lt;p&gt;${summary}&lt;/p&gt;</content>`,
  ]) {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Headline</title><link href="https://example.com/story"/>${field}</entry></feed>`;
    assert.equal(parseCandidates(xml, feed)[0].summary, summary);
  }
});

test("missing, short, image-only and headline-only descriptions do not invent summaries", () => {
  const title = "A long headline about central bank measures and lending across the country";
  for (const description of ["", "Read more", "<img src='https://example.com/image.jpg'>", title, `${title} Example`]) {
    const xml = rss(`<item><title>${title}</title><link>https://example.com/story</link><description><![CDATA[${description}]]></description></item>`);
    assert.equal(parseCandidates(xml, feed)[0].summary, undefined);
  }
  const sitemap = `<urlset><url><loc>https://example.com/story</loc></url></urlset>`;
  assert.equal(parseCandidates(sitemap, feed)[0].summary, undefined);
});

test("long feed content is truncated to a bounded excerpt", () => {
  const [candidate] = parseCandidates(rss(item(`<description>${summary.repeat(100)}</description>`)), feed);
  assert.ok(candidate.summary!.length <= 1000);
  assert.ok(candidate.summary!.endsWith("…"));
});

test("Reuters JSON descriptions use the shared summary cleanup and omission rules", () => {
  const source = { ...feed, site: "Reuters", url: "https://www.reuters.com/pf/api/v3/content/fetch/articles" };
  const title = "A long headline about central bank measures and lending across the country";
  for (const description of [undefined, "", "Read more", title, `${title} Reuters`, "<script>bad()</script>"]) {
    const articles = parseReutersJson({ result: { articles: [{ canonical_url: "/world/story/", title, description }] } }, source, 5, Date.now);
    assert.deepEqual(articles, [{ url: "https://www.reuters.com/world/story/" }]);
  }
  const articles = parseReutersJson({ result: { articles: [{ canonical_url: "/world/story/", title, description: `<p>${summary}</p><script>bad()</script>` }] } }, source, 5, Date.now);
  assert.deepEqual(articles, [{ url: "https://www.reuters.com/world/story/", summary }]);
});

test("oversized Reuters descriptions cannot fail JSON report generation or lose other feeds", async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), "folio-reuters-summary-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const source = { site: "Reuters", section: "Main feed", url: "https://www.reuters.com/pf/api/v3/content/fetch/articles", ordering: "newest", format: "rss" };
  for (const length of [1000, 1001, 5000]) {
    const description = "x".repeat(length);
    const report = await generateLinks([source, { ...feed, ordering: "feed", format: "rss" }], {
      outputDir: join(outputDir, String(length)), retryLimit: 0,
      fetchImpl: async (input) => String(input) === source.url
        ? Response.json({ result: { articles: [{ canonical_url: "/world/central-bank-measures/", title: "Central bank measures", description }] } })
        : new Response(rss(item(`<description>${summary}</description>`))),
    });
    assert.equal(report.failedFeedCount, 0);
    assert.equal(report.linkCount, 2);
    const excerpt = report.websites[0].sections[0].articles[0].summary!;
    assert.equal(excerpt.length, 1000);
    assert.equal(excerpt, length === 1000 ? description : `${"x".repeat(999)}…`);
    assert.equal(report.websites[1].sections[0].articles[0].summary, summary);
    assert.deepEqual(parseLinksReport(await readFile(join(outputDir, String(length), report.savedFile.split("/").pop()!), "utf8")), report);
  }
});

test("summary follows a Google News URL through publisher resolution", async () => {
  const source = { ...feed, url: "https://news.google.com/rss/search?q=Example" };
  const results = await collectFeeds([source], {
    retryLimit: 0,
    fetchImpl: async (input) => String(input) === source.url
      ? new Response(rss(`<item><title>Headline</title><link>https://news.google.com/rss/articles/CBMiExample</link><description>${summary}</description></item>`))
      : new Response(null, { status: 302, headers: { location: "https://example.com/resolved" } }),
  });
  assert.deepEqual(results[0].articles, [{ url: "https://example.com/resolved", summary }]);
  assert.deepEqual(results[0].urls, ["https://example.com/resolved"]);
});

test("JSON preserves summaries as data and never interprets them as collection tasks", () => {
  const text = `${summary}\n# Fake\n- <https://example.com/injected> [click](javascript:bad) ![image](bad)`;
  const report = buildLinksReport([{ ...feed, ok: true, urls: ["https://example.com/story"], articles: [{ url: "https://example.com/story", summary: text }] }]);
  assert.equal(report.websites[0].sections[0].articles[0].summary, text);
  assert.deepEqual(parseLinksFile(JSON.stringify(report)), [{ website: feed.site, section: feed.section, url: "https://example.com/story" }]);
});

test("saved JSON and API agree while caps and missing-summary entries remain intact", async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), "folio-summary-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const catalog = [{ ...feed, ordering: "feed", format: "rss" }];
  const report = await generateLinks(catalog, {
    outputDir,
    limit: 2,
    retryLimit: 0,
    fetchImpl: async () => new Response(rss(item(`<description>${summary}</description>`) + item("", "missing") + item(`<description>${summary}</description>`, "capped"))),
  });
  const section = report.websites[0].sections[0];
  assert.deepEqual(section.articles, [{ url: "https://example.com/story", summary }, { url: "https://example.com/missing" }]);
  assert.equal(report.linkCount, 2);
  const content = await readFile(join(outputDir, report.savedFile.split("/").pop()!), "utf8");
  assert.deepEqual(JSON.parse(content), report);
  assert.equal(parseLinksFile(content).length, 2);

  const originalHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "summary-test-key";
  t.after(() => {
    if (originalHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = originalHash;
  });
  const handle = createLinksHandler(catalog, async () => report);
  const jsonResponse = await handle(new Request("https://folio.example/api/links?hash=summary-test-key&format=json"));
  assert.equal(jsonResponse.status, 200);
  assert.deepEqual((await jsonResponse.json()).websites[0].sections[0].articles, section.articles);
  const defaultResponse = await handle(new Request("https://folio.example/api/links?hash=summary-test-key"));
  assert.equal(defaultResponse.status, 200);
  assert.deepEqual(await defaultResponse.json(), report);
});
