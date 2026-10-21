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
  assert.equal(catalog.length - mainFeeds.length, 1724);
  assert.equal(createHash("sha256").update(JSON.stringify(mainFeeds)).digest("hex"),
    "c9324c2345866d77d19b5e73a0b8b29acbba11830a8bc558a8b5886d3f0a52b0",
    "All ten original Main feeds and their metadata must remain unchanged");
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
  assert.equal(feeds.length, 1734);
  assert.equal(new Set(feeds.map(({ site }) => site)).size, 10);
  assert.equal(new Set(feeds.map(({ site, url }) => `${site}:${url}`)).size, 1734);
  const wsj = feeds.filter(({ site }) => site === "WSJ");
  assert.equal(wsj.length, 36);
  const current = wsj.filter(({ url }) => new URL(url).hostname === "feeds.content.dowjones.io");
  assert.deepEqual(current.map(({ url }) => new URL(url).pathname.split("/").at(-1)), [
    "RSSWorldNews", "RSSUSnews", "socialpoliticsfeed", "socialeconomyfeed", "WSJcomUSBusiness",
    "RSSWSJD", "RSSMarketsMain", "RSSPersonalFinance", "latestnewsrealestate", "socialhealth",
    "RSSOpinion", "RSSArtsCulture", "RSSLifestyle", "RSSStyle", "rsssportsfeed", "rssmarkets",
    "socialmarketsfeed", "socialtechfeed", "socialcentralbankingfeed", "wsj_lifestyle",
    "wsj_food_drink", "wsj_homepage", "wsj_world_news", "RSSJapanNewsWorld", "RSSJapanMarket",
    "RSSJapanBusiness", "RSSJapanTechnology", "RSSJapanOpinion", "RSSJapanLife", "RSSJapanHeardonTheStreet", "RSSJapanPersonalTechnology",
  ]);
  assert.deepEqual(wsj.filter(({ url }) => new URL(url).hostname === "feeds.a.dj.com")
    .map(({ url }) => new URL(url).pathname), [
    "/rss/LatestNewsOpinion.xml", "/rss/LatestNewsRealEstate.xml", "/rss/LatestNewsSports.xml", "/rss/RSSWhatsNews.xml",
  ]);
  assert.equal(wsj[0].url, "https://flipboard.com/@WSJ.rss");
  assert.ok(wsj.every(({ ordering, format, homepageScore }) => ordering === "newest" && format === "rss" && homepageScore === 8));
  assert.equal(wsj.filter(({ edition }) => edition === "Japan").length, 8);
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
    assert.ok(text.includes("36"), `${path}: WSJ count`);
    assert.ok(text.includes("714"), `${path}: NY Times count`);
    assert.doesNotMatch(text, /at most ten (?:links|candidates)|one `Main feed` each|No extra Opinion feed is added|at most one link per publisher\s+is selected/);
  }
});

test("NY Times catalog matches the offline workbook's selected text-feed URL inventory", () => {
  const nyt = validateFeedCatalog(catalog).filter(({ site }) => site === "NY Times");
  assert.equal(nyt.length, 714);
  // SHA-256 of sorted, newline-joined exact selected URL cells from All feeds.
  // Pins the complete reviewed source inventory without depending on Downloads.
  assert.equal(createHash("sha256").update(nyt.map(({ url }) => url).sort().join("\n")).digest("hex"),
    "6ce46d1e6cca407812ee0ab82cae5825b5abd1311dd8588cf9f1318073afe00c");
  assert.equal(nyt.filter(({ url }) => new URL(url).hostname === "rss.nytimes.com").length, 66);
  assert.equal(nyt.filter(({ url }) => url.includes("/svc/collections/")).length, 337);
  assert.equal(nyt.filter(({ url }) => url.includes("/athletic/rss/")).length, 307);
  for (const [prefix, expected] of Object.entries({
    "Section — ": 26, "Column — ": 37, "Writer — ": 49, "Newsletter — ": 2,
    "Spotlight — ": 6, "News event — ": 2, "Topic (subject) — ": 99,
    "Topic (place) — ": 85, "Topic (company) — ": 14, "Topic (organization) — ": 15,
    "Topic (person) — ": 2,
  })) assert.equal(nyt.filter(({ section }) => section.startsWith(prefix)).length, expected, prefix);
  assert.equal(new Set(nyt.map(({ section }) => section)).size, 659);
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

test("Washington Post reference inventory matches 51 live and two official-page exception URLs", () => {
  const wapo = validateFeedCatalog(catalog).filter(({ site }) => site === "Washington Post");
  assert.equal(wapo.length, 53);
  // Reviewed offline against all 503 workbook rows; no Downloads dependency in QA.
  assert.equal(createHash("sha256").update(wapo.map(({ url }) => url).sort().join("\n")).digest("hex"),
    "4fcba8a73a164bac67bf37679068e7abf1bc57047fad95860dc52d5127eb7c73");
  assert.equal(wapo.filter(({ url }) => url.includes("/arcio/rss/category/")).length, 15);
  assert.equal(wapo.filter(({ section }) => section.startsWith("Writer — ")).length, 34);
  assert.equal(wapo.filter(({ section }) => section.startsWith("Writer (legacy page) — ")).length, 2);
  assert.equal(wapo.filter(({ section }) => section.startsWith("Writer (legacy XML) — ")).length, 1);
  assert.equal(new Set(wapo.map(({ section }) => section)).size, 53);
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
  for (const fact of ["washington_post_rss_feeds_2.xlsx", "new-research-2.md", "503", "450", "unknown",
    "75 cached", "third-party", "legacy reference", "502"])
    assert.ok(text.includes(fact), fact);
  assert.match(text, /Washington Post.*53/);
  assert.match(text, /none of these additions is enabled for daily API collection/);
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
  for (const fact of ["corrected 20 october", "624", "23 of 858", "corrected workbooks", "56 was the workbook's live-row count"]) {
    assert.ok(readme.toLowerCase().includes(fact), fact);
  }
  assert.match(readme, /actual article|true dates|Feedly feed-level dates/i);
});

test("Reuters locale editions retain publisher weight and cannot masquerade as country-topic feeds", () => {
  const reuters = catalog.filter(({ site }) => site === "Reuters");
  assert.equal(reuters.length, 81);
  assert.ok(reuters.every(({ homepageScore }) => homepageScore === 4));
  for (const [edition, country, language] of [
    ["Australia", "AU", "en-AU"], ["Canada", "CA", "en-CA"], ["India", "IN", "en-IN"],
    ["Singapore", "SG", "en-SG"], ["United Kingdom", "GB", "en-GB"],
  ]) {
    const record = reuters.find(({ section }) => section === `All Reuters stories — ${edition} edition`);
    assert.ok(record, edition);
    const query = new URL(record.url).searchParams;
    assert.equal(record.edition, edition);
    assert.equal(record.ordering, "google-ranked");
    assert.equal(query.get("q"), "when:24h site:reuters.com");
    assert.equal(query.get("ceid"), `${country}:en`);
    assert.equal(query.get("gl"), country);
    assert.equal(query.get("hl"), language);
  }
});

test("remaining publisher inventories preserve offline-reviewed exact URLs", () => {
  // Reviewed against every sheet of the latest supplied workbooks. FT additionally
  // retains its pre-existing Main URL, which is not a primary workbook URL cell.
  for (const [site, count, digest] of [
    ["Financial Times", 427, "55214178e064d7e43da1e8d324b9cb6d0ccce7f2f5613abf9dc227b740e205ab"],
    ["Foreign Policy", 65, "6320e9e42d69386e4283987ba6158d10c6c47079956029c9b1cee16129ae82a1"],
    ["Business Insider", 129, "48eb4c3cfcd86f3d8dbd6ebef04b8e5e439698678bcc23eb88cf11054441a104"],
    ["Reuters", 81, "93e8bcdc752f0bb3f1b270de530444ed4daa9967882c136e71f9cc4ae93a0d43"],
  ]) {
    const feeds = catalog.filter((feed) => feed.site === site);
    assert.equal(feeds.length, count, site);
    assert.equal(createHash("sha256").update(feeds.map(({ url }) => url).sort().join("\n")).digest("hex"), digest, site);
  }
});

test("current inventory guide tables reconcile with stored publisher groups and exclusions", async () => {
  const text = await readFile(new URL("data/README.md", root), "utf8");
  const table = (heading, end) => text.split(heading)[1].split(end)[0];
  const sum = (body) => [...body.matchAll(/^\| (?!\*\*Total)[^|]+\| (\d+) \|/gm)]
    .reduce((total, match) => total + Number(match[1]), 0);
  assert.equal(sum(table("| Included group | Feeds |", "Every exact NY Times")), 714);
  assert.equal(sum(table("| Stored group | Feeds | Operational feeds |", "Section URLs use")), 53);
  assert.equal(sum(table("#### Washington Post exclusions", "All podcast categories")), 450);
  assert.match(text, /The other 1724 entries/);
  assert.match(text, /not all 1734 stored/);
  assert.match(text, /\*\*713 of the 714 stored URLs live\*\*/);
  assert.match(text, /Tressie McMillan Cottom column \*\*slowing\*\*/);
  assert.doesNotMatch(text, /wapo_rss_feeds_2\.xlsx|715\s+text-feed|172 new live Athletic|old.*host.*stopped in 2023/);
});

test("CNBC updated workbook adds only Cybersecurity and preserves its sole editorial Main feed", () => {
  const cnbc = validateFeedCatalog(catalog).filter(({ site }) => site === "CNBC");
  assert.equal(cnbc.length, 104);
  assert.equal(new Set(cnbc.map(({ url }) => url)).size, 104);
  // All selected exact URL cells from the reviewed 201-row updated workbook.
  // CI intentionally does not depend on the private Downloads workbook.
  assert.equal(createHash("sha256").update(cnbc.map(({ url }) => url).sort().join("\n")).digest("hex"),
    "044f4972b3219cd917852f730fc0b87b1d60324983a41fddf760265d34e421bc");
  const raw = publisherCatalogs.find(({ site }) => site === "CNBC").entries;
  assert.equal(createHash("sha256").update(JSON.stringify(raw.filter(({ section }) => section !== "Cybersecurity"))).digest("hex"),
    "ed8e70f8a51bf3c2a76ffb4db9b30a25398e2a161aade4be3a8e48cd2fc10daa");
  assert.deepEqual(cnbc.filter(({ section }) => section === "Cybersecurity"), [{
    site: "CNBC", section: "Cybersecurity", url: "https://www.cnbc.com/id/100807029/device/rss/rss.html",
    ordering: "newest", format: "rss", homepageScore: 9, edition: "US",
  }]);
  assert.deepEqual(mainFeeds.filter(({ site }) => site === "CNBC"), [{
    site: "CNBC", section: "Main feed", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    ordering: "editorial", format: "rss", homepageScore: 9, edition: "US",
  }]);
  assert.ok(cnbc.every(({ ordering, section, homepageScore, edition, format }) =>
    ordering === (section === "Main feed" ? "editorial" : "newest") && homepageScore === 9 && edition === "US" && format === "rss"));
  assert.ok(!mainFeeds.some(({ section }) => section === "Cybersecurity"));
  assert.ok(!cnbc.some(({ url }) => /simplecast|art19|youtube|podcast\.cnbc|cnbcnewsfeed|<ID>/.test(url)));
});

test("CNBC guide records updated research, exact counts, exclusions and daily main-only behavior", async () => {
  const text = (await readFile(new URL("data/README.md", root), "utf8")).replace(/[*`]/g, "").replace(/\s+/g, " ");
  for (const fact of ["cnbc_rss_feeds_new.xlsx", "cnbc_rss_new.md", "201 records", "90 cached", "134 live",
    "16 slowing", "48 stale", "3 empty", "54 listed feeds", "147", "97 are excluded", "Cybersecurity", "search.cnbc.com",
    "one CNBC Main feed", "ten Main feeds overall", "selective workflow remains opt-in and unchanged"])
    assert.ok(text.includes(fact), fact);
  assert.match(text, /not a new live availability or extraction audit by Folio/);
  assert.match(text, /All 103 existing entries are retained unchanged/);
  assert.match(text, /No fallback, proxy policy, retrieval order or extraction-domain rule changes/);
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
  assert.match(skill, /version: 2\.0\.1/);
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
