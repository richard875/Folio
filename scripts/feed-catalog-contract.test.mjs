import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { feedInventory as catalog, mainFeeds, publisherCatalogs } from "../src/lib/rss/sources.ts";
import { METHODS, METHOD_DEFAULTS } from "../reader/methods.ts";
import { FALLBACK_METHODS } from "../reader/retrieval.config.ts";
import { selectMainFeeds, validateFeedCatalog } from "../src/lib/rss/catalog.ts";

const root = new URL("../", import.meta.url);

test("ten publisher files preserve the complete inventory but expose only one main feed each", async () => {
  assert.deepEqual((await readdir(new URL("data/", root))).filter((name) => name.endsWith(".json")).sort(),
    publisherCatalogs.map(({ file }) => file).sort());
  assert.equal(mainFeeds.length, 10);
  assert.deepEqual(mainFeeds.map(({ site }) => site), publisherCatalogs.map(({ site }) => site));
  assert.ok(mainFeeds.every(({ section }) => section === "Main feed"));
  for (const { site, file, entries } of publisherCatalogs) {
    assert.deepEqual(JSON.parse(await readFile(new URL(`data/${file}`, root), "utf8")), entries);
    assert.ok(entries.every((feed) => feed.site === site));
    assert.equal(entries.filter(({ section }) => section === "Main feed").length, 1);
  }
  assert.equal(catalog.length - mainFeeds.length, 1415);
});

test("main selection fails closed on missing or duplicate mains, including identical duplicates", () => {
  const main = mainFeeds[0];
  const reference = { ...main, section: "World", url: "https://example.com/reference" };
  assert.deepEqual(selectMainFeeds([reference, main]), [main]);
  for (const entries of [[], [reference], [main, main], [main, { ...main, url: reference.url }],
    [main, { ...reference, site: "Missing main publisher" }]])
    assert.throws(() => selectMainFeeds(entries));
  assert.throws(() => selectMainFeeds([main, { ...reference, url: "not-a-url" }]));
});

test("WSJ catalog includes exactly the researched active article feeds, including Japan and legacy", () => {
  const feeds = validateFeedCatalog(catalog);
  assert.equal(feeds.length, 1425);
  assert.equal(new Set(feeds.map(({ site }) => site)).size, 10);
  assert.equal(new Set(feeds.map(({ site, url }) => `${site}:${url}`)).size, 1425);
  const wsj = feeds.filter(({ site }) => site === "WSJ");
  assert.equal(wsj.length, 35);
  const current = wsj.filter(({ url }) => new URL(url).hostname === "feeds.content.dowjones.io");
  assert.deepEqual(current.map(({ url }) => new URL(url).pathname.split("/").at(-1)), [
    "RSSWorldNews", "RSSUSnews", "socialpoliticsfeed", "socialeconomyfeed", "WSJcomUSBusiness",
    "RSSWSJD", "RSSMarketsMain", "RSSPersonalFinance", "latestnewsrealestate", "socialhealth",
    "RSSOpinion", "RSSArtsCulture", "RSSLifestyle", "RSSStyle", "rsssportsfeed", "rssmarkets",
    "socialmarketsfeed", "socialtechfeed", "socialcentralbankingfeed", "wsj_lifestyle",
    "wsj_food_drink", "wsj_homepage", "wsj_world_news", "RSSJapanNewsWorld", "RSSJapanMarket",
    "RSSJapanBusiness", "RSSJapanTechnology", "RSSJapanOpinion", "RSSJapanLife", "RSSJapanHeardonTheStreet",
  ]);
  assert.deepEqual(wsj.filter(({ url }) => new URL(url).hostname === "feeds.a.dj.com")
    .map(({ url }) => new URL(url).pathname), [
    "/rss/LatestNewsOpinion.xml", "/rss/LatestNewsRealEstate.xml", "/rss/LatestNewsSports.xml", "/rss/RSSWhatsNews.xml",
  ]);
  assert.equal(wsj[0].url, "https://flipboard.com/@WSJ.rss");
  assert.ok(wsj.every(({ ordering, format, homepageScore }) => ordering === "newest" && format === "rss" && homepageScore === 8));
  assert.equal(wsj.filter(({ edition }) => edition === "Japan").length, 7);
  assert.ok(wsj.every(({ section, edition }) => section.startsWith("Japan — ") === (edition === "Japan")));
  assert.ok(current.every(({ url }) => !/\\|\.xml$|\/json\//.test(url)));
  assert.ok(wsj.every(({ url }) => !/podcast|simplecast|megaphone|youtube|RSSJapanBarrons|RSSJapanCapitalJournal|\/cfo$|\/cio$|socialoffduty/.test(url)));
});

test("feed README inventories every added WSJ section and documents the new catalog size", async () => {
  const readme = await readFile(new URL("data/README.md", root), "utf8");
  for (const { section, url } of catalog.filter(({ site, section }) => site === "WSJ" && section !== "Main feed")) {
    const name = new URL(url).pathname.split("/").at(-1);
    assert.ok(readme.includes(`| ${section} | \`${name}\` |`), section);
  }
  for (const path of ["README.md", "data/README.md", "scripts/fetch-links.md", "docs/prompts/daily-news-brief.md", "docs/skills/universal-article-reader/SKILL.md"]) {
    const text = await readFile(new URL(path, root), "utf8");
    assert.ok(text.includes(String(catalog.length)), `${path}: catalog total`);
    assert.ok(text.includes("35"), `${path}: WSJ count`);
    assert.ok(text.includes("543"), `${path}: NY Times count`);
    assert.doesNotMatch(text, /at most ten (?:links|candidates)|one `Main feed` each|No extra Opinion feed is added|at most one link per publisher\s+is selected/);
  }
});

test("NY Times catalog matches the offline workbook's selected live text-feed URL inventory", () => {
  const nyt = validateFeedCatalog(catalog).filter(({ site }) => site === "NY Times");
  assert.equal(nyt.length, 543);
  // SHA-256 of sorted, newline-joined exact selected URL cells from All feeds.
  // Pins the complete reviewed source inventory without depending on Downloads.
  assert.equal(createHash("sha256").update(nyt.map(({ url }) => url).sort().join("\n")).digest("hex"),
    "f7dcb1f0ca04184f63848162614768c9c02b488862ff7c8a88f1005230ef6056");
  assert.equal(nyt.filter(({ url }) => new URL(url).hostname === "rss.nytimes.com").length, 66);
  assert.equal(nyt.filter(({ url }) => url.includes("/svc/collections/")).length, 337);
  assert.equal(nyt.filter(({ url }) => url.includes("/athletic/rss/")).length, 136);
  for (const [prefix, expected] of Object.entries({
    "Section — ": 26, "Column — ": 37, "Writer — ": 49, "Newsletter — ": 2,
    "Spotlight — ": 6, "News event — ": 2, "Topic (subject) — ": 99,
    "Topic (place) — ": 85, "Topic (company) — ": 14, "Topic (organization) — ": 15,
    "Topic (person) — ": 2,
  })) assert.equal(nyt.filter(({ section }) => section.startsWith(prefix)).length, expected, prefix);
  assert.equal(new Set(nyt.map(({ section }) => section)).size, 543);
  assert.ok(nyt.every(({ url, homepageScore, format }) => new URL(url).protocol === "https:" && homepageScore === 8 && format === "rss"));
  assert.ok(nyt.every(({ section, ordering }) => ordering === (section === "Main feed" ? "editorial" : "newest")));
  assert.equal(nyt.filter(({ edition }) => edition !== "US").length, 3);
  for (const [url, section, edition] of [
    ["https://rss.nytimes.com/services/xml/rss/nyt/Fashion.xml", "Fashion", "US"],
    ["https://rss.nytimes.com/services/xml/rss/nyt/FashionandStyle.xml", "Style", "US"],
    ["https://rss.nytimes.com/services/xml/rss/nyt/es.xml", "The New York Times en Español", "Spanish"],
    ["https://cn.nytimes.com/rss/", "NYT Chinese (Simplified)", "Chinese (Simplified)"],
    ["https://cn.nytimes.com/rss/zh-hant/", "NYT Chinese (Traditional)", "Chinese (Traditional)"],
  ]) assert.ok(nyt.some((feed) => feed.url === url && feed.section === section && feed.edition === edition));
});

test("NY Times catalog excludes known aliases, inactive feeds, non-text collections and legacy templates", () => {
  const nyt = catalog.filter(({ site }) => site === "NY Times");
  for (const name of ["Books.xml", "InternationalBusiness.xml", "Environment.xml", "Circuits.xml",
    "InternationalHome.xml", "GlobalHome.xml", "Washington.xml", "Sports.xml", "Video.xml", "Multimedia.xml"])
    assert.ok(!nyt.some(({ url }) => url.endsWith(`/nyt/${name}`)), name);
  assert.ok(nyt.every(({ url }) => !/podcasts?\/|\/column\/(?:the-daily|op-docs|wordplay)\/|nytco\.com|theathletic\.com|simplecast|acast\.com|[<>]|\.\.\./.test(url)));
  assert.ok(nyt.every(({ url }) => !url.includes("/blogs/") && !url.includes("blogs.nytimes.com")));
  assert.ok(nyt.some(({ url }) => url === "https://cooking.nytimes.com/next/api/v1/rss/recipes"));
  assert.ok(nyt.some(({ url }) => url === "https://www.nytimes.com/wirecutter/feed/"));
});

test("Washington Post reference inventory matches the workbook's 50 live text-feed URL cells", () => {
  const wapo = validateFeedCatalog(catalog).filter(({ site }) => site === "Washington Post");
  assert.equal(wapo.length, 50);
  // Reviewed offline against all 499 workbook rows; no Downloads dependency in QA.
  assert.equal(createHash("sha256").update(wapo.map(({ url }) => url).sort().join("\n")).digest("hex"),
    "3b0d6833da2d315429cf606fe580a9e7603fcc69d97d7708be1acaf08d1f0a18");
  assert.equal(wapo.filter(({ url }) => url.includes("/arcio/rss/category/")).length, 13);
  assert.equal(wapo.filter(({ section }) => section.startsWith("Writer — ")).length, 33);
  assert.equal(wapo.filter(({ section }) => section.startsWith("Writer (legacy page) — ")).length, 2);
  assert.equal(wapo.filter(({ section }) => section.startsWith("Writer (legacy XML) — ")).length, 1);
  assert.equal(new Set(wapo.map(({ section }) => section)).size, 50);
  assert.ok(wapo.every(({ site, url, ordering, format, homepageScore, edition }) =>
    site === "Washington Post" && new URL(url).hostname === "www.washingtonpost.com" &&
    new URL(url).protocol === "https:" && ordering === "newest" && format === "rss" && homepageScore === 6 && edition === "US"));
  assert.deepEqual(mainFeeds.filter(({ site }) => site === "Washington Post"), [{
    site: "Washington Post", section: "Main feed", url: "https://www.washingtonpost.com/arcio/rss/",
    ordering: "newest", format: "rss", homepageScore: 6, edition: "US",
  }]);
  assert.ok(wapo.some(({ url }) => url.endsWith("/author/R%20%20Eric%20-Thomas/")));
  assert.ok(wapo.some(({ url }) => url.endsWith("/author/Ashley-Fetters%20Maloy/")));
  assert.ok(wapo.every(({ url }) => !/feeds\.washingtonpost\.com|posttv\.com|acast\.com|[<>]/.test(url)));
  assert.ok(!wapo.some(({ url }) => /\/category\/(?:editorials|world\/africa|politics\/courts-law)\/$/.test(url)));
  assert.ok(!wapo.some(({ url }) => /\/category\/(?:world|business)\/$/.test(url)));
});

test("Washington Post guide records exclusions, source discrepancies and inactive-reference status", async () => {
  const text = (await readFile(new URL("data/README.md", root), "utf8")).replace(/\s+/g, " ");
  for (const fact of ["wapo_rss_feeds.xlsx", "wapo_rss.md", "499", "449", "unknown",
    "70 cached", "third-party", "legacy reference", "502"])
    assert.ok(text.includes(fact), fact);
  assert.match(text, /Washington Post.*50/);
  assert.match(text, /none of these additions is enabled for API collection/);
  assert.match(text, /No live fetch or extraction audit/);
});

test("Bloomberg references match the reviewed workbook without replacing the sitemap Main feed", () => {
  const bloomberg = validateFeedCatalog(catalog).filter(({ site }) => site === "Bloomberg");
  assert.equal(bloomberg.length, 61);
  assert.equal(createHash("sha256").update(bloomberg.map(({ url }) => url).sort().join("\n")).digest("hex"),
    "ee83ea9d68eb2002e2fc5d4b2442ad4545fa3a0e7f92080ec2d7e1af359d49e3");
  assert.equal(bloomberg.filter(({ section }) => section.startsWith("Writer — ")).length, 37);
  assert.equal(bloomberg.filter(({ section }) => section.startsWith("Partner — ")).length, 9);
  assert.equal(bloomberg.filter(({ url }) => url.startsWith("https://www.bloomberg.com/feeds/")).length, 10);
  assert.equal(bloomberg.filter(({ format }) => format === "rss").length, 59);
  assert.equal(bloomberg.filter(({ format }) => format === "news-sitemap").length, 2);
  assert.equal(new Set(bloomberg.map(({ section }) => section)).size, 61);
  assert.ok(bloomberg.every(({ ordering, homepageScore }) => ordering === "newest" && homepageScore === 4));
  assert.deepEqual(mainFeeds.filter(({ site }) => site === "Bloomberg"), [{
    site: "Bloomberg", section: "Main feed", url: "https://www.bloomberg.com/sitemaps/news/latest.xml",
    ordering: "newest", format: "news-sitemap", homepageScore: 4, edition: "Only one",
  }]);
  assert.ok(bloomberg.some(({ section, url, format }) => section === "All Bloomberg news (RSS)" &&
    url === "https://www.bloomberg.com/feeds/news.rss" && format === "rss"));
  assert.ok(bloomberg.some(({ url, edition }) => url === "http://www.bloomberg.com.br/feed/" && edition === "Brazil (Portuguese)"));
  assert.ok(bloomberg.every(({ url }) => !/podcasts?|omnycontent|megaphone|\/index\.xml$|sectionfronts|feeds\.bloomberg\.com|[<>]/.test(url)));
  for (const name of ["gadfly", "wealth", "citylab", "green"])
    assert.ok(!bloomberg.some(({ url }) => url.endsWith(`/feeds/${name}/news.rss`)), name);
});

test("Bloomberg guide documents inactive RSS/sitemap references and reconciled research exclusions", async () => {
  const text = (await readFile(new URL("data/README.md", root), "utf8")).replace(/\s+/g, " ");
  for (const fact of ["bloomberg_rss_feeds.xlsx", "bloomberg_rss.md", "217 records", "60 cached",
    "61", "156", "128", "news:title", "fixed October archive", "HTTP", "not fresh verification by Folio"])
    assert.ok(text.includes(fact), fact);
  assert.match(text, /RSS is not the same as a news sitemap/);
  assert.match(text, /does not replace the sitemap Main feed or become its fallback/);
  assert.match(text, /All 60 additions remain inactive/);
});

test("Economist inventory matches the reviewed workbook's 64 selected text-feed URLs", () => {
  const economist = validateFeedCatalog(catalog).filter(({ site }) => site === "The Economist");
  assert.equal(economist.length, 64);
  assert.equal(createHash("sha256").update(economist.map(({ url }) => url).sort().join("\n")).digest("hex"),
    "1b2681ee43a822f0bbffafcf18d7a71bee7243841f63124cf028fa131ac8b6a4");
  assert.equal(economist.filter(({ section }) => section.startsWith("Legacy RSS — ")).length, 17);
  assert.equal(economist.filter(({ section }) => section.startsWith("Legacy print — ")).length, 15);
  assert.equal(economist.filter(({ section }) => section.startsWith("EIU:")).length, 6);
  assert.equal(economist.filter(({ section }) => section === "Weekly edition" || !section.startsWith("Legacy") && !section.startsWith("EIU") && !section.startsWith("Writer") && !section.startsWith("Partner")).length, 23);
  assert.ok(economist.some(({ section, url }) => section === "Main feed" && url.endsWith("/latest/rss.xml")));
  assert.ok(!economist.some(({ url }) => url.includes("bloomberg.com")));
  assert.ok(economist.every(({ ordering, homepageScore }) => ordering === "newest" && homepageScore === 5));
});

test("corrected NYT and WaPo research provenance is documented", async () => {
  const readme = (await readFile(new URL("data/README.md", root), "utf8")).replace(/\s+/g, " ");
  for (const fact of ["corrected 20 october", "624", "23 of 858", "corrected workbooks", "wapo is unchanged at 56"]) {
    assert.ok(readme.toLowerCase().includes(fact), fact);
  }
  assert.match(readme, /actual article|true dates|Feedly feed-level dates/i);
});

test("executable source has no dependency on the historical Markdown catalog or its parser", async () => {
  const obsolete = ["News site RSS feeds", "by section.md"].join(" ");
  async function visit(directory) {
    for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory()) { await visit(`${path}/`); continue; }
      if (!/\.(?:ts|tsx|mjs|js)$/.test(path)) continue;
      const text = await readFile(new URL(path, root), "utf8");
      assert.ok(!text.includes(obsolete), path);
      assert.ok(!text.includes(["parse", "FeedCatalog"].join("")), path);
    }
  }
  for (const directory of ["src/", "reader/", "scripts/", "server/"]) await visit(directory);
  const route = await readFile(new URL("src/routes/api/links.ts", root), "utf8");
  assert.match(route, /import \{ mainFeeds \} from "@\/lib\/rss\/sources"/);
  assert.match(route, /createLinksHandler\(mainFeeds\)/);
  assert.doesNotMatch(route, /attachments|\?raw/);
});

test("Folio skill names the actual data/configuration files and all configured publishers", async () => {
  const skill = await readFile(new URL("docs/skills/universal-article-reader/SKILL.md", root), "utf8");
  assert.match(skill, /^---\nname: universal-article-reader\n/m);
  assert.match(skill, /version: 2\.0\.0/);
  for (const path of ["data/README.md", "src/lib/rss/sources.ts", "reader/retrieval.config.ts", "reader/methods.ts", "reader/AI-GUIDE.md", "src/lib/agent/api.ts"]) {
    assert.ok(skill.includes(path), path);
    await readFile(new URL(path, root));
  }
  for (const { site } of catalog) assert.ok(skill.includes(site), site);
  const fallbackSection = skill.split("Shared fallback method IDs, in order:")[1].split("WallHop uses")[0];
  assert.deepEqual([...fallbackSection.matchAll(/^\d+\. `([^`]+)`/gm)].map((match) => match[1]), [...FALLBACK_METHODS]);
  for (const method of ["wallhop", "direct", "freedium-mirror"]) assert.ok(skill.includes(`\`${method}\``));
});

test("Folio skill records real limits, headers and saved-file reading safeguards", async () => {
  const skill = await readFile(new URL("docs/skills/universal-article-reader/SKILL.md", root), "utf8");
  assert.equal(METHODS.wallhop.totalBudgetMs, 25000);
  assert.equal(METHOD_DEFAULTS.proxyBudgetMs, 6000);
  for (const fact of [
    "X-Wallhop-Load: 1", "OUTBOUND_PROXY_BYPASS_HOSTS=freedium-mirror.cfd,wallhop.io",
    "48 seconds", "25 seconds", "six seconds", "1,400 characters", "280 characters",
    "8,000,000", "16,000,000", "Undated entries can be eligible", "endOfArticle=true",
    "nextManifestUrl", "SHA-256", "snapshotId", "Render Free", "No structured embedded",
  ]) assert.ok(skill.includes(fact), fact);
  assert.doesNotMatch(skill, /There are no domain-specific branches|Collect every meaningful content image|Works on any domain/);
});
