import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseLinksReport } from "../src/lib/rss/report.ts";

const root = new URL("../", import.meta.url);
const guides = [
  "README.md", "AGENTS.md", "CLAUDE.md", "deployment.md", ".claude/README.md",
  "data/README.md", "docs/README.md", "reader/README.md", "reader/AI-GUIDE.md",
  "scripts/fetch-links.md", "scripts/feed-selection.md", "scripts/collect-articles.md",
  "scripts/save-articles.md", "scripts/agent-reader.md", "scripts/swagger.md",
  "docs/skills/universal-article-reader/SKILL.md",
  "docs/prompts/daily-news-brief.md",
];
const readGuide = (path) => readFile(new URL(path, root), "utf8");

test("current implementation guides have resolvable local Markdown links", async () => {
  // Historical handovers, research and private output are not
  // current guidance and must not be rewritten to satisfy this contract.
  for (const path of guides) {
    const document = new URL(path, root);
    for (const match of (await readGuide(path)).matchAll(/\]\(([^)]+)\)/g)) {
      const target = new URL(match[1], document);
      if (target.protocol !== "file:") continue;
      target.hash = "";
      await access(target);
    }
  }
});

test("documented link-report JSON example validates against the real storage schema", async () => {
  const guide = await readGuide("scripts/fetch-links.md");
  const example = /```json\s*\n([\s\S]*?)\n```/.exec(guide)?.[1];
  assert.ok(example, "Missing report example");
  const report = parseLinksReport(example);
  assert.equal(report.schemaVersion, 1);
  assert.match(report.savedFile, /\.json$/);
  assert.deepEqual(report.websites[0].sections[0].articles, [
    { url: "https://example.com/story", summary: "Optional feed-provided excerpt." },
  ]);
  assert.equal("markdown" in report, false);
});

test("daily briefing prompt covers selective saving and job-bound verified reading", async () => {
  const prompt = await readGuide("docs/prompts/daily-news-brief.md");
  for (const fact of [
    "/api/links", "/api/save-batch?hash=", "/api/save-batch/status?callId=",
    "/api/agent/latest", "nextManifestUrl", "snapshotId", "collections[]",
    "savedFile", "endOfArticle=true", "UTF-8 byte count", "SHA-256",
    "save times", "untrusted data", "Retry-After",
  ]) assert.ok(prompt.includes(fact), `Prompt missing ${fact}`);
  const example = /```json\s*\n([\s\S]*?)\n```/.exec(prompt)?.[1];
  assert.ok(example, "Missing save-batch request example");
  const body = JSON.parse(example);
  assert.equal(body.format, "markdown");
  assert.ok(body.urls.length >= 1 && body.urls.length <= 100);
  assert.ok(body.urls.every((item) => new URL(item.url).protocol === "https:" && !item.callId));
});

test("current guides do not reinstate obsolete Markdown link-report contracts", async () => {
  for (const path of guides) {
    const text = (await readGuide(path)).replace(/\s+/g, " ");
    assert.doesNotMatch(text, /link-report storage has not|this migration changes only the feed catalog|original website\/section headings/i, path);
    assert.doesNotMatch(text, /links_YYYY-MM-DD_HH-mm-ss\.md|Reports remain Markdown even with/i, path);
  }
  const catalogGuide = await readGuide("data/README.md");
  assert.match(catalogGuide, /versioned JSON/);
  for (const path of ["scripts/fetch-links.md", "deployment.md"]) {
    const text = (await readGuide(path)).replace(/\s+/g, " ");
    assert.match(text, /warns and skips/);
    assert.match(text, /savedFile/);
  }
});

test("summary policy is documented consistently for all three publisher exceptions", async () => {
  for (const path of ["README.md", "scripts/fetch-links.md", "scripts/feed-selection.md", "docs/skills/universal-article-reader/SKILL.md"]) {
    const text = await readGuide(path);
    for (const fact of ["Bloomberg", "Business Insider", "Reuters", "news:title", "description", "1,000"]) {
      assert.ok(text.includes(fact), `${path}: missing ${fact}`);
    }
  }
});
