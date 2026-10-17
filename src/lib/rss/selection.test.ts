import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFeedCatalog, type Feed } from "./catalog.ts";
import { articleUrl, orderingFor, parseCandidates, rankCandidates } from "./selection.ts";
import { collectFeeds } from "./links.ts";

const NOW = Date.parse("2026-10-12T15:00:00Z");
const date = (hours: number) => new Date(NOW - hours * 3600000).toISOString();
const feed = (site: string, url = "https://example.com/feed"): Feed => ({
  site,
  section: "Main feed",
  url,
});
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
type Item = {
  title: string;
  url: string;
  hours?: number;
  creator?: string;
  categories?: string[];
  enclosure?: string;
};
const rss = (items: Item[]) =>
  `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>News</title>${items.map((item) => `<item><title>${escape(item.title)}</title><link>${escape(item.url)}</link>${item.hours === undefined ? "" : `<pubDate>${date(item.hours)}</pubDate>`}${item.creator ? `<dc:creator>${escape(item.creator)}</dc:creator>` : ""}${(item.categories || []).map((category) => `<category>${escape(category)}</category>`).join("")}${item.enclosure ? `<enclosure url="https://example.com/media" type="${item.enclosure}"/>` : ""}</item>`).join("")}</channel></rss>`;

const publishers: Record<string, string> = {
  "NY Times": "nytimes.com",
  "Washington Post": "washingtonpost.com",
  Bloomberg: "bloomberg.com",
  "The Economist": "economist.com",
  "Financial Times": "ft.com",
  "Foreign Policy": "foreignpolicy.com",
  CNBC: "cnbc.com",
};

test("catalog reads reordered columns and metadata without treating notes as feed URLs", () => {
  const catalog = parseFeedCatalog(
    "| Site | Score (0–10) | Feed URL | Edition | What it actually is | How I know |\n| --- | --- | --- | --- | --- | --- |\n| Financial Times | 9 | `https://www.ft.com/?format=rss` | International | Exact homepage, in order | Saw it. Alternate `https://example.com/feed` |\n",
  );
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].url, "https://www.ft.com/?format=rss");
  assert.equal(catalog[0].ordering, "editorial");
  assert.equal(catalog[0].homepageScore, 9);
  assert.equal(catalog[0].edition, "International");
  assert.match(catalog[0].evidence || "", /Saw it/);
  const newest = parseFeedCatalog(
    "| Site | Feed URL | What it actually is |\n| --- | --- | --- |\n| Foreign Policy | `https://foreignpolicy.com/feed/` | **Newest first.** Not page order. |\n",
  );
  assert.equal(newest[0].ordering, "newest");
});

test("NYT's RSS and Atom link elements do not collide after namespace parsing", () => {
  const xml = `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><item><title>Lead</title><link>https://www.nytimes.com/world/lead</link><atom:link href="https://www.nytimes.com/world/lead" rel="standout"/><pubDate>${date(1)}</pubDate></item></channel></rss>`;
  assert.equal(parseCandidates(xml, feed("NY Times"), NOW)[0].url, "https://www.nytimes.com/world/lead");
});

test("all seven publishers filter media, sponsored entries, unsafe URLs and off-publisher links", () => {
  for (const [site, domain] of Object.entries(publishers)) {
    const source = feed(site);
    const base = `https://www.${domain}`;
    const candidates = parseCandidates(rss([
      { title: "Video: the latest", url: `${base}/news/video-story`, hours: 1 },
      { title: "Audio report", url: `${base}/audio/story`, hours: 1 },
      { title: "Podcast", url: `${base}/podcasts/story`, hours: 1 },
      { title: "Episode", url: `${base}/news/episode`, enclosure: "video/mp4", hours: 1 },
      { title: "Videos", url: `${base}/news/format`, categories: ["Video"], hours: 1 },
      { title: "Paid advertisement", url: `${base}/news/advert`, categories: ["Sponsored"], hours: 1 },
      { title: "Wrong publisher", url: "https://example.com/news/wrong", hours: 1 },
      { title: "Genuine article about video games", url: `${base}/news/games`, hours: 1 },
    ]), source, NOW);
    assert.deepEqual(candidates.map((candidate) => candidate.url), [`${base}/news/games`], site);
    for (const path of ["/", "/quote/EXAMPLE", "/section/world/", "/feed/rss.xml", "/puzzles/answers"])
      assert.equal(articleUrl(`${base}${path}`, source), null, `${site}: ${path}`);
    assert.equal(articleUrl(`https://user:pass@www.${domain}/news/private`, source), null);
  }
});

test("tracking parameters and fragments are cleaned before deduplication", () => {
  const candidates = parseCandidates(rss([
    { title: "Lead", url: "https://foreignpolicy.com/news/lead?utm_source=feed&fbclid=123#top", hours: 1 },
    { title: "Duplicate", url: "https://foreignpolicy.com/news/lead", hours: 1 },
  ]), feed("Foreign Policy"), NOW);
  assert.deepEqual(candidates.map((candidate) => candidate.url), ["https://foreignpolicy.com/news/lead"]);
});

test("Washington Post filters AP bylines including thin spaces and sports", () => {
  const candidates = parseCandidates(rss([
    { title: "Wire", url: "https://www.washingtonpost.com/world/wire", creator: "Associated Press", hours: 1 },
    { title: "Wire thin spaces", url: "https://www.washingtonpost.com/world/wire2", creator: "Reporter\u2009|\u2009AP", hours: 1 },
    { title: "Sports", url: "https://www.washingtonpost.com/sports/story", hours: 1 },
    { title: "Post reporting", url: "https://www.washingtonpost.com/politics/story", creator: "Post reporter", hours: 2 },
  ]), feed("Washington Post"), NOW);
  assert.deepEqual(candidates.map((candidate) => candidate.url), ["https://www.washingtonpost.com/politics/story"]);
});

test("Bloomberg sitemap ranking uses publication dates, not last update order", () => {
  const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${[
    ["old", 30], ["fresh", 1], ["video/episode", 0],
  ].map(([path, hours]) => `<url><loc>https://www.bloomberg.com/${path}</loc><lastmod>${date(0)}</lastmod><news:news><news:publication_date>${date(Number(hours))}</news:publication_date><news:title>Distinct ${path}</news:title></news:news></url>`).join("")}</urlset>`;
  const candidates = rankCandidates(parseCandidates(xml, feed("Bloomberg"), NOW), undefined, NOW);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].url, "https://www.bloomberg.com/fresh");
});

test("curated NYT, FT and CNBC feeds retain editorial order rather than timestamp order", () => {
  for (const site of ["NY Times", "Financial Times", "CNBC"]) {
    const base = `https://www.${publishers[site]}`;
    const candidates = parseCandidates(rss([
      { title: "Lead explainer", url: `${base}/news/lead`, hours: 48 },
      { title: "New secondary report", url: `${base}/news/secondary`, hours: 1 },
    ]), feed(site), NOW);
    assert.equal(orderingFor(feed(site)), "editorial");
    assert.equal(rankCandidates(candidates, candidates, NOW)[0].url, `${base}/news/lead`);
  }
});

test("Economist drops podcasts and stale backlog; CNBC retains paid text but excludes Select and AP", () => {
  const economist = parseCandidates(rss([
    { title: "Podcast", url: "https://www.economist.com/podcasts/episode", hours: 1 },
    { title: "Old", url: "https://www.economist.com/world/old", hours: 200 },
    { title: "Fresh", url: "https://www.economist.com/world/fresh", hours: 3 },
  ]), feed("The Economist"), NOW);
  assert.equal(economist.length, 1);
  const cnbc = parseCandidates(rss([
    { title: "Club reporting", url: "https://www.cnbc.com/investingclub/reporting", categories: ["Investing Club"], hours: 1 },
    { title: "Shopping", url: "https://www.cnbc.com/select/shopping", hours: 1 },
    { title: "Wire", url: "https://www.cnbc.com/news/wire", creator: "Associated Press", hours: 1 },
  ]), feed("CNBC"), NOW);
  assert.deepEqual(cnbc.map((candidate) => candidate.url), ["https://www.cnbc.com/investingclub/reporting"]);
});

test("cross-publisher editorial support changes selection rather than merely sorting newest", () => {
  const economist = parseCandidates(rss([
    { title: "Isolated fresh local statement", url: "https://www.economist.com/world/fresh", hours: 1 },
    { title: "Indonesia wildfire threatens endangered orangutans", url: "https://www.economist.com/world/major", hours: 6 },
  ]), feed("The Economist"), NOW);
  const lead = parseCandidates(rss([
    { title: "Indonesia wildfire threatens endangered orangutans", url: "https://www.nytimes.com/world/major", hours: 1 },
  ]), feed("NY Times"), NOW);
  assert.equal(rankCandidates(economist, economist, NOW)[0].url, "https://www.economist.com/world/fresh");
  assert.equal(rankCandidates(economist, [...economist, ...lead], NOW)[0].url, "https://www.economist.com/world/major");
});

test("filtering happens before the limit and refills from subsequent eligible entries", async () => {
  const result = await collectFeeds([feed("Foreign Policy")], {
    limit: 1, now: () => NOW,
    fetchImpl: async () => new Response(rss([
      { title: "Watch: panel", url: "https://foreignpolicy.com/video/panel", hours: 1 },
      { title: "Article", url: "https://foreignpolicy.com/news/article", hours: 2 },
    ])),
  });
  assert.deepEqual(result[0].urls, ["https://foreignpolicy.com/news/article"]);
});

test("freshness excludes undated non-editorial entries, old backlog and future dates, but not article images", () => {
  const candidates = parseCandidates(rss([
    { title: "Old backlog", url: "https://www.bloomberg.com/old", hours: 100 },
    { title: "Invalid future clock", url: "https://www.bloomberg.com/future", hours: -48 },
    { title: "Undated article", url: "https://www.bloomberg.com/undated" },
    { title: "Text article with image", url: "https://www.bloomberg.com/image-story", hours: 1, enclosure: "image/jpeg" },
  ]), feed("Bloomberg"), NOW);
  assert.deepEqual(candidates.map((candidate) => candidate.url), ["https://www.bloomberg.com/image-story"]);
});

test("editorial sources retain undated and older curated pieces within their seven-day window", () => {
  const candidates = parseCandidates(rss([
    { title: "Undated explainer", url: "https://www.nytimes.com/world/undated" },
    { title: "Weekend explainer", url: "https://www.nytimes.com/world/weekend", hours: 120 },
    { title: "Stale backlog", url: "https://www.nytimes.com/world/stale", hours: 200 },
  ]), feed("NY Times"), NOW);
  assert.deepEqual(candidates.map((candidate) => candidate.url), [
    "https://www.nytimes.com/world/undated", "https://www.nytimes.com/world/weekend",
  ]);
});

test("generic Google wrappers still resolve and filter before the final limit", async () => {
  const source = feed("Example News", "https://news.google.com/rss/search?q=example");
  const result = await collectFeeds([source], {
    limit: 1, now: () => NOW,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/rss/search") return new Response(rss([
        { title: "Ambiguous headline", url: "https://news.google.com/rss/articles/CBMiMedia", hours: 1 },
        { title: "Genuine reporting", url: "https://news.google.com/rss/articles/CBMiArticle", hours: 2 },
      ]));
      return new Response(null, {
        status: 302,
        headers: { location: url.pathname.endsWith("CBMiMedia") ? "https://example.com/video/story" : "https://example.com/world/article" },
      });
    },
  });
  assert.deepEqual(result[0].urls, ["https://example.com/world/article"]);
});
