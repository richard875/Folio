import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import catalog from "../data/feeds.json" with { type: "json" };
import { METHODS, METHOD_DEFAULTS } from "../reader/methods.ts";
import { FALLBACK_METHODS } from "../reader/retrieval.config.ts";
import { validateFeedCatalog } from "../src/lib/rss/catalog.ts";

const root = new URL("../", import.meta.url);

test("WSJ catalog includes exactly the researched active article feeds, including Japan and legacy", () => {
  const feeds = validateFeedCatalog(catalog);
  assert.equal(feeds.length, 44);
  assert.equal(new Set(feeds.map(({ site }) => site)).size, 10);
  assert.equal(new Set(feeds.map(({ site, section }) => `${site}:${section}`)).size, 44);
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
    assert.ok(text.includes("44"), `${path}: catalog total`);
    assert.ok(text.includes("35"), `${path}: WSJ count`);
    assert.doesNotMatch(text, /at most ten (?:links|candidates)|one `Main feed` each|No extra Opinion feed is added|at most one link per publisher\s+is selected/);
  }
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
