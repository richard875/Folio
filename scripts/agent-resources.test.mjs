import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = ".claude";
// Historical inventory/checksums retain evidence of the original .grok migration.
const manifest = JSON.parse(readFileSync("scripts/agent-resource-inventory.json", "utf8"));
const EXPECTED_SKILLS = [
  "auth", "building-games", "controls", "design-ui", "game-animation-frames",
  "game-asset-core", "game-character-consistency", "game-tilesets", "game-ui-icons",
  "generate2dmap", "generate2dsprite", "imagine-grok-build", "multiplayer-p2p",
  "neon", "og", "threejs", "video2dsprite", "xai-api",
];

function filesUnder(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = join(prefix, entry.name);
      if (entry.isDirectory()) return filesUnder(root, relative);
      assert.equal(entry.isFile(), true, `${relative} is a real resource file`);
      return [relative];
    })
    .sort();
}

function normalizedSourceBytes(path) {
  const content = readFileSync(path);
  if (content.includes(0)) return content;
  return Buffer.from(content.toString("utf8")
    .replaceAll(".claude/skills/", ".grok/skills/")
    .replaceAll(".claude/references/", ".grok/references/")
    .replaceAll(".claude/app-env.defaults.json", ".grok/app-env.defaults.json")
    .replaceAll(".claude/app-env.json", ".grok/app-env.json")
    .replaceAll(".claude/dev.log", ".grok/dev.log")
    .replaceAll(".claude/og-pending", ".grok/og-pending")
    .replaceAll("/workspace/.claude/", "/workspace/.grok/")
    .replaceAll("mkdir -p .claude", "mkdir -p .grok"));
}

test("shared agent resources retain the complete original inventory and content", () => {
  const expected = [...new Set([
    ...manifest.trackedSourceFiles,
    ...manifest.addedResourceFiles,
  ])].sort();

  // Only resource subtrees have a fixed inventory. Local logs, overrides and
  // future tool settings may coexist at the root without breaking this check.
  for (const directory of ["skills", "references"]) {
    assert.equal(lstatSync(join(ROOT, directory)).isDirectory(), true);
    assert.deepEqual(
      filesUnder(join(ROOT, directory)).map((path) => `${directory}/${path}`).sort(),
      expected.filter((path) => path.startsWith(`${directory}/`)),
      `${directory} has the complete expected inventory`,
    );
  }
  for (const path of expected) {
    assert.equal(lstatSync(join(ROOT, path)).isFile(), true, `${path} is retained`);
  }
  for (const sourcePath of manifest.trackedSourceFiles) {
    if (sourcePath === "README.md") continue; // Discovery documentation evolves.
    const digest = createHash("sha256")
      .update(normalizedSourceBytes(join(ROOT, sourcePath))).digest("hex");
    assert.equal(digest, manifest.sourceSha256[sourcePath],
      `${sourcePath} preserves original content apart from path relocation`);
  }
});

test("the shared skills have unique matching discovery metadata", () => {
  const skillNames = readdirSync(join(ROOT, "skills"))
    .filter((entry) => !entry.startsWith("_")).sort();
  assert.deepEqual(skillNames, EXPECTED_SKILLS);
  const frontmatterNames = [];
  for (const directory of skillNames) {
    const skill = readFileSync(join(ROOT, "skills", directory, "SKILL.md"), "utf8");
    const frontmatter = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(skill);
    assert.ok(frontmatter, `${directory} has YAML frontmatter`);
    const name = /^name:\s*([a-z0-9-]+)\s*$/m.exec(frontmatter[1])?.[1];
    const description = /^description:\s*(.+)$/m.exec(frontmatter[1])?.[1]?.trim();
    assert.equal(name, directory, `${directory} has a matching skill name`);
    assert.ok(description, `${directory} has a description for discovery`);
    frontmatterNames.push(name);
  }
  assert.equal(new Set(frontmatterNames).size, frontmatterNames.length);
});

test("Claude Code and OpenCode use the same resources and project instructions", () => {
  assert.equal(readFileSync("CLAUDE.md", "utf8").trim(), "@AGENTS.md");
  const opencode = JSON.parse(readFileSync("opencode.json", "utf8"));
  assert.ok(opencode.instructions.includes(".claude/references/*.md"));
  assert.equal(JSON.stringify(opencode).includes(".agents/"), false);
  for (const path of [".agents/skill-copies", ".agents/skills", ".agents/references",
    ".agents/app-env.defaults.json"]) {
    assert.equal(lstatSync(path, { throwIfNoEntry: false }), undefined,
      `${path} must not duplicate the shared resources`);
  }
  const defaults = JSON.parse(readFileSync(join(ROOT, "app-env.defaults.json"), "utf8"));
  assert.equal(defaults.VITE_AUTH_ENABLED, "false");
});

test("resource documentation points to existing shared files without mirror instructions", () => {
  for (const path of ["AGENTS.md", "README.md", ".claude/README.md",
    ".claude/skills/_INDEX.md", ".claude/references/_INDEX.md"]) {
    const text = readFileSync(path, "utf8");
    assert.doesNotMatch(text, /\.agents\/(?:skill-copies|skills|references)/);
    assert.doesNotMatch(text, /keep (?:corresponding|both|the two).*synchronized/i);
    for (const match of text.matchAll(/`(\.claude\/[^`\s]+)`/g)) {
      const target = match[1];
      // Examples, optional overrides and local runtime artifacts are not tracked resources.
      if (/[<*>]/.test(target) || /\/(?:app-env\.json|dev\.log|og-pending)$/.test(target)) continue;
      assert.ok(lstatSync(target, { throwIfNoEntry: false }), `${path}: ${target} exists`);
    }
  }
});
