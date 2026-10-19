import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import catalog from "../data/feeds.json" with { type: "json" };
import { METHODS, METHOD_DEFAULTS } from "../reader/methods.ts";
import { FALLBACK_METHODS } from "../reader/retrieval.config.ts";
import { validateFeedCatalog } from "../src/lib/rss/catalog.ts";

const root = new URL("../", import.meta.url);

test("WSJ catalog includes exactly the researched active article feeds, including Japan and legacy", () => {
  const feeds = validateFeedCatalog(catalog);
  assert.equal(feeds.length, 599);
  assert.equal(new Set(feeds.map(({ site }) => site)).size, 10);
  assert.equal(new Set(feeds.map(({ site, section }) => `${site}:${section}`)).size, 599);
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
    assert.ok(text.includes("599"), `${path}: catalog total`);
    assert.ok(text.includes("35"), `${path}: WSJ count`);
    assert.ok(text.includes("556"), `${path}: NY Times count`);
    assert.doesNotMatch(text, /at most ten (?:links|candidates)|one `Main feed` each|No extra Opinion feed is added|at most one link per publisher\s+is selected/);
  }
});

test("NY Times catalog matches the offline workbook's selected live text-feed URL inventory", () => {
  const nyt = validateFeedCatalog(catalog).filter(({ site }) => site === "NY Times");
  assert.equal(nyt.length, 556);
  // SHA-256 of sorted, newline-joined exact selected URL cells from All feeds.
  // Pins the complete reviewed source inventory without depending on Downloads.
  assert.equal(createHash("sha256").update(nyt.map(({ url }) => url).sort().join("\n")).digest("hex"),
    "6abd81583ef6d48d7abbccb4ae320052284b6d8df95a320c0d9d7882bf2b13a8");
  assert.equal(nyt.filter(({ url }) => new URL(url).hostname === "rss.nytimes.com").length, 66);
  assert.equal(nyt.filter(({ url }) => url.includes("/svc/collections/")).length, 349);
  assert.equal(nyt.filter(({ url }) => url.includes("/athletic/rss/")).length, 137);
  for (const [prefix, expected] of Object.entries({
    "Section — ": 26, "Column — ": 40, "Writer — ": 50, "Newsletter — ": 2,
    "Spotlight — ": 7, "News event — ": 2, "Topic (subject) — ": 103,
    "Topic (place) — ": 87, "Topic (company) — ": 15, "Topic (organization) — ": 15,
    "Topic (person) — ": 2,
  })) assert.equal(nyt.filter(({ section }) => section.startsWith(prefix)).length, expected, prefix);
  assert.equal(new Set(nyt.map(({ section }) => section)).size, 556);
  assert.ok(nyt.every(({ url, homepageScore, format }) => new URL(url).protocol === "https:" && homepageScore === 8 && format === "rss"));
  assert.ok(nyt.every(({ section, ordering }) => ordering === (section === "Main feed" ? "editorial" : "newest")));
  assert.equal(nyt.filter(({ edition }) => edition !== "US").length, 3);
  for (const [url, section, edition] of [
    ["https://rss.nytimes.com/services/xml/rss/nyt/Style.xml", "Fashion", "US"],
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
  assert.match(route, /import catalog from "\.\.\/\.\.\/\.\.\/data\/feeds\.json"/);
  assert.doesNotMatch(route, /attachments|\?raw/);
});

test("Folio skill names the actual data/configuration files and all configured publishers", async () => {
  const skill = await readFile(new URL("docs/skills/universal-article-reader/SKILL.md", root), "utf8");
  assert.match(skill, /^---\nname: universal-article-reader\n/m);
  assert.match(skill, /version: 2\.0\.0/);
  for (const path of ["data/feeds.json", "reader/retrieval.config.ts", "reader/methods.ts", "reader/AI-GUIDE.md", "src/lib/agent/api.ts"]) {
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
