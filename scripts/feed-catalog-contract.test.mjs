import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import catalog from "../data/feeds.json" with { type: "json" };
import { METHODS, METHOD_DEFAULTS } from "../reader/methods.ts";
import { FALLBACK_METHODS } from "../reader/retrieval.config.ts";

const root = new URL("../", import.meta.url);

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
  const skill = await readFile(new URL("attachments/SKILL.md", root), "utf8");
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
  const skill = await readFile(new URL("attachments/SKILL.md", root), "utf8");
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
