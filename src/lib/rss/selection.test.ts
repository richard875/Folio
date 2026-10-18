import assert from "node:assert/strict";
import { test } from "node:test";
import { validateFeedCatalog, type Feed } from "./catalog.ts";
import { articleUrl, parseCandidates, rankCandidates } from "./selection.ts";
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
  `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>News</title>${items.map((item) => `<item><title>${escape(item.title)}</title><link>${escape(item.url)}</link>${item.hours === undefined ? "" : `<pubDate>${date(item.hours)}</pubDate>`}${item.creator ? `<dc:creator>${escape(item.creator)}</dc:creator>` : ""}${(item.categories || []).map((category) => `<category>${category}</category>`).join("")}${item.enclosure ? `<enclosure url="https://example.com/media" type="${item.enclosure}"/>` : ""}</item>`).join("")}</channel></rss>`;

test("catalog uses explicit ordering and numeric metadata instead of human descriptions", () => {
  const catalog = validateFeedCatalog([
    { site: "Example News", section: "Main feed", url: "https://example.com/feed/top/", ordering: "editorial", format: "rss", homepageScore: 10, edition: "US" },
  ]);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].url, "https://example.com/feed/top/");
  assert.equal(catalog[0].ordering, "editorial");
  assert.equal(catalog[0].homepageScore, 10);
  assert.equal(catalog[0].edition, "US");
  assert.equal(parseCandidates(rss([{ title: "Older lead", url: "/older", hours: 5 }, { title: "New story", url: "/new", hours: 1 }]), catalog[0], NOW)[0].ordering, "editorial");
  const newest = validateFeedCatalog([
    { site: "WSJ", section: "Main feed", url: "https://flipboard.com/@WSJ.rss", ordering: "newest", format: "rss" },
  ]);
  assert.equal(newest[0].ordering, "newest");
});

test("NYT's RSS and atom link elements do not collide after namespace parsing", () => {
  const xml = `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><item><title>Lead</title><link>https://www.nytimes.com/world/lead</link><atom:link href="https://www.nytimes.com/world/lead" rel="standout"/><pubDate>${date(1)}</pubDate></item></channel></rss>`;
  assert.equal(
    parseCandidates(xml, feed("NY Times"), NOW)[0].url,
    "https://www.nytimes.com/world/lead",
  );
});

test("each publisher excludes standalone media and non-article links", () => {
  const sources = {
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
  for (const [site, domain] of Object.entries(sources)) {
    const source = feed(site);
    const base = `https://www.${domain}`;
    const candidates = parseCandidates(
      rss([
        { title: "Video: the latest", url: `${base}/news/video-story`, hours: 1 },
        { title: "Audio report", url: `${base}/audio/story`, hours: 1 },
        { title: "Podcast", url: `${base}/podcasts/story`, hours: 1 },
        { title: "A media episode", url: `${base}/news/episode`, enclosure: "video/mp4", hours: 1 },
        { title: "Videos", url: `${base}/news/format`, categories: ["Video"], hours: 1 },
        {
          title: "Paid advertisement",
          url: `${base}/news/advert`,
          categories: ["Sponsored"],
          hours: 1,
        },
        { title: "Genuine article about video games", url: `${base}/news/games`, hours: 1 },
      ]),
      source,
      NOW,
    );
    assert.deepEqual(
      candidates.map((item) => item.url),
      [`${base}/news/games`],
      site,
    );
    assert.equal(articleUrl(`${base}/quote/AAPL`, source), null);
    assert.equal(articleUrl(`${base}/`, source), null);
    assert.equal(articleUrl(`${base}/section/world/`, source), null);
  }
});

test("WSJ cleans tracking before deduplication and drops shopping content", () => {
  const candidates = parseCandidates(
    rss([
      { title: "Lead", url: "https://www.wsj.com/articles/lead?mod=Flipboard", hours: 1 },
      { title: "Duplicate", url: "https://www.wsj.com/articles/lead", hours: 1 },
      { title: "Shop", url: "https://www.wsj.com/buyside/deals", hours: 1 },
    ]),
    feed("WSJ"),
    NOW,
  );
  assert.deepEqual(
    candidates.map((item) => item.url),
    ["https://www.wsj.com/articles/lead"],
  );
});

test("Washington Post drops AP bylines including thin spaces and sports", () => {
  const candidates = parseCandidates(
    rss([
      {
        title: "Wire",
        url: "https://www.washingtonpost.com/world/wire",
        creator: "Associated Press",
        hours: 1,
      },
      {
        title: "Wire thin spaces",
        url: "https://www.washingtonpost.com/world/wire2",
        creator: "Reporter\u2009|\u2009AP",
        hours: 1,
      },
      { title: "Sports", url: "https://www.washingtonpost.com/sports/story", hours: 1 },
      {
        title: "Post reporting",
        url: "https://www.washingtonpost.com/politics/story",
        creator: "Post reporter",
        hours: 2,
      },
    ]),
    feed("Washington Post"),
    NOW,
  );
  assert.deepEqual(
    candidates.map((item) => item.url),
    ["https://www.washingtonpost.com/politics/story"],
  );
});

test("Bloomberg and BI sitemaps use news publication dates instead of last update order", () => {
  for (const [site, domain] of [
    ["Bloomberg", "bloomberg.com"],
    ["Business Insider", "businessinsider.com"],
  ]) {
    const source = feed(site);
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${[
      ["old", 30],
      ["fresh", 1],
      ["video/episode", 0],
    ]
      .map(
        ([path, hours]) =>
          `<url><loc>https://www.${domain}/${path}</loc><lastmod>${date(0)}</lastmod><news:news><news:publication_date>${date(Number(hours))}</news:publication_date><news:title>Distinct ${path}</news:title></news:news></url>`,
      )
      .join("")}</urlset>`;
    const candidates = rankCandidates(parseCandidates(xml, source, NOW), undefined, NOW);
    assert.equal(candidates[0].url, `https://www.${domain}/fresh`);
    assert.equal(candidates.length, 2);
  }
});

test("curated NYT, FT and CNBC feeds retain editor order instead of a timestamp sort", () => {
  for (const [site, domain] of [
    ["NY Times", "nytimes.com"],
    ["Financial Times", "ft.com"],
    ["CNBC", "cnbc.com"],
  ]) {
    const candidates = parseCandidates(
      rss([
        { title: "Lead explainer", url: `https://www.${domain}/news/lead`, hours: 48 },
        { title: "New secondary report", url: `https://www.${domain}/news/secondary`, hours: 1 },
      ]),
      feed(site),
      NOW,
    );
    assert.equal(
      rankCandidates(candidates, candidates, NOW)[0].url,
      `https://www.${domain}/news/lead`,
    );
  }
});

test("Economist removes podcasts and old backlog; CNBC Club articles remain eligible", () => {
  const economist = parseCandidates(
    rss([
      { title: "Podcast", url: "https://www.economist.com/podcasts/episode", hours: 1 },
      { title: "Old", url: "https://www.economist.com/world/old", hours: 200 },
      { title: "Fresh", url: "https://www.economist.com/world/fresh", hours: 3 },
    ]),
    feed("The Economist"),
    NOW,
  );
  assert.equal(economist.length, 1);
  assert.equal(
    parseCandidates(
      rss([
        {
          title: "Club reporting",
          url: "https://www.cnbc.com/investingclub/reporting",
          categories: ["Investing Club"],
          hours: 1,
        },
      ]),
      feed("CNBC"),
      NOW,
    ).length,
    1,
  );
});

test("fresh major stories with cross-publisher coverage can beat a low Google position", () => {
  const reuters = parseCandidates(
    rss([
      {
        title: "Routine isolated company statement",
        url: "https://www.reuters.com/business/routine",
        hours: 20,
      },
      {
        title: "Stock Price Today",
        url: "https://news.google.com/rss/articles/CBMiQuote",
        hours: 1,
      },
      { title: "Reuters", url: "https://news.google.com/rss/articles/CBMiHome", hours: 1 },
      {
        title: "Indonesia wildfire threatens endangered orangutans",
        url: "https://www.reuters.com/world/major",
        hours: 1,
      },
    ]),
    feed("Reuters"),
    NOW,
  );
  const nyt = parseCandidates(
    rss([
      {
        title: "Indonesia wildfire threatens endangered orangutans",
        url: "https://www.nytimes.com/world/major",
        hours: 1,
      },
    ]),
    feed("NY Times"),
    NOW,
  );
  const ranked = rankCandidates(reuters, [...reuters, ...nyt], NOW);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].url, "https://www.reuters.com/world/major");
});

test("cross-publisher editorial support changes selection, rather than merely sorting newest", () => {
  const reuters = parseCandidates(
    rss([
      {
        title: "Isolated fresh local statement",
        url: "https://www.reuters.com/world/fresh",
        hours: 1,
      },
      {
        title: "Indonesia wildfire threatens endangered orangutans",
        url: "https://www.reuters.com/world/major",
        hours: 6,
      },
    ]),
    feed("Reuters"),
    NOW,
  );
  const lead = parseCandidates(
    rss([
      {
        title: "Indonesia wildfire threatens endangered orangutans",
        url: "https://www.nytimes.com/world/major",
        hours: 1,
      },
    ]),
    feed("NY Times"),
    NOW,
  );
  assert.equal(rankCandidates(reuters, reuters, NOW)[0].url, "https://www.reuters.com/world/fresh");
  assert.equal(
    rankCandidates(reuters, [...reuters, ...lead], NOW)[0].url,
    "https://www.reuters.com/world/major",
  );
});

test("filtering happens before the limit and refills from subsequent eligible entries", async () => {
  const source = feed("Foreign Policy");
  const result = await collectFeeds([source], {
    limit: 1,
    now: () => NOW,
    fetchImpl: async () =>
      new Response(
        rss([
          { title: "Watch: panel", url: "https://foreignpolicy.com/video/panel", hours: 1 },
          { title: "Article", url: "https://foreignpolicy.com/news/article", hours: 2 },
        ]),
      ),
  });
  assert.deepEqual(result[0].urls, ["https://foreignpolicy.com/news/article"]);
});

test("freshness windows are enforced without inventing dates or excluding article images", () => {
  const source = feed("Business Insider");
  const candidates = parseCandidates(
    rss([
      { title: "Old backlog", url: "https://www.businessinsider.com/old", hours: 100 },
      { title: "Invalid future clock", url: "https://www.businessinsider.com/future", hours: -48 },
      { title: "Undated article", url: "https://www.businessinsider.com/undated" },
      {
        title: "Text article with image",
        url: "https://www.businessinsider.com/image-story",
        hours: 1,
        enclosure: "image/jpeg",
      },
    ]),
    source,
    NOW,
  );
  assert.equal(candidates.length, 2);
  assert.equal(
    candidates.find((candidate) => candidate.url.endsWith("undated"))?.publishedAt,
    null,
  );
  assert.equal(
    rankCandidates(candidates, candidates, NOW)[0].url,
    "https://www.businessinsider.com/image-story",
  );
});

test("Google candidates are resolved before final media/quote filtering, then the next article refills the limit", async () => {
  const source = feed("Reuters", "https://news.google.com/rss/search?q=site:reuters.com");
  const result = await collectFeeds([source], {
    limit: 1,
    now: () => NOW,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/rss/search")
        return new Response(
          rss([
            {
              title: "An ambiguous headline",
              url: "https://news.google.com/rss/articles/CBMiMedia",
              hours: 1,
            },
            {
              title: "Genuine reporting",
              url: "https://news.google.com/rss/articles/CBMiArticle",
              hours: 2,
            },
          ]),
        );
      return new Response(null, {
        status: 302,
        headers: {
          location: url.pathname.endsWith("CBMiMedia")
            ? "https://www.reuters.com/video/story"
            : "https://www.reuters.com/world/article",
        },
      });
    },
  });
  assert.deepEqual(result[0].urls, ["https://www.reuters.com/world/article"]);
});
