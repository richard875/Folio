import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("supporting documents are consolidated under docs instead of the four legacy folders", async () => {
  for (const path of [
    "docs/README.md",
    "docs/skills/universal-article-reader/SKILL.md",
    "docs/handovers/2026-10-18.md",
    "docs/research/proxy-options/overview.md",
    "docs/research/proxy-options/managed.md",
    "docs/research/proxy-options/public-and-hosted.md",
    "docs/research/proxy-options/scraping-apis.md",
    "docs/qa/screenshots/.gitkeep",
  ]) await access(new URL(path, root));
  for (const directory of ["attachments/", "reports/", "research_notes/", "screenshots/"]) {
    await assert.rejects(access(new URL(directory, root)), { code: "ENOENT" });
  }
});

test("documentation index links resolve and private/generated material stays excluded", async () => {
  const indexUrl = new URL("docs/README.md", root);
  const index = await readFile(indexUrl, "utf8");
  for (const match of index.matchAll(/\]\(([^)]+)\)/g)) {
    const target = new URL(match[1], indexUrl);
    assert.equal(target.protocol, "file:");
    await access(target);
  }
  const ignore = await readFile(new URL(".gitignore", root), "utf8");
  for (const pattern of ["/docs/private/", "/docs/qa/*", "/docs/qa/screenshots/*", "!/docs/qa/screenshots/.gitkeep"]) {
    assert.ok(ignore.split(/\r?\n/).includes(pattern), pattern);
  }
  assert.ok(index.includes("retain their original text/paths as historical"));
});
