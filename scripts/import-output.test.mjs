import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleImport, validImportPath } from "../src/lib/runtime/import.ts";

test("import paths are limited to known output layouts", () => {
  assert.equal(validImportPath("output/articles/2026-10-13_12-30/story.md"), true);
  for (const path of ["../secret", "output/articles/2026-99-99_12-30/a.md", "output/articles/2026-10-13_12-30/../secret.md", "output/jobs/invalid.json", "output/articles/2026-10-13_12-30/script.js"]) assert.equal(validImportPath(path), false);
});

test("imports authenticate, verify checksums, preserve Unicode bytes and never overwrite", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-import-"));
  const old = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "test-import-key";
  t.after(async () => { if (old === undefined) delete process.env.ACCESS_HASH; else process.env.ACCESS_HASH = old; await rm(root, { recursive: true, force: true }); });
  const path = "output/articles/2026-10-13_12-30/story.md";
  const text = "# café 📰\n";
  const make = (content = text, checksum = createHash("sha256").update(content).digest("hex")) => new Request(`http://localhost/api/import?path=${encodeURIComponent(path)}`, { method: "POST", body: content, headers: { authorization: "Bearer test-import-key", "x-folio-sha256": checksum } });
  assert.equal((await handleImport(new Request("http://localhost/api/import", { method: "POST" }), root)).status, 401);
  assert.equal((await handleImport(make(text, "0".repeat(64)), root)).status, 400);
  const first = await handleImport(make(), root);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).temporary, true);
  assert.equal(await readFile(join(root, path), "utf8"), text);
  assert.equal((await (await handleImport(make(), root)).json()).alreadyExists, true);
  assert.equal((await handleImport(make("different"), root)).status, 409);
  assert.equal(await readFile(join(root, path), "utf8"), text);
  await mkdir(join(root, "outside"));
  await symlink(join(root, "outside"), join(root, "output/articles/2026-10-13_13-30"));
  const unsafe = make();
  const unsafeUrl = new URL(unsafe.url);
  unsafeUrl.searchParams.set("path", "output/articles/2026-10-13_13-30/story.md");
  assert.equal((await handleImport(new Request(unsafeUrl, unsafe), root)).status, 400);
});

test("imported unfinished jobs become errors and repeat imports are idempotent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-import-job-"));
  const old = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "test-import-key";
  t.after(async () => { if (old === undefined) delete process.env.ACCESS_HASH; else process.env.ACCESS_HASH = old; await rm(root, { recursive: true, force: true }); });
  const callId = "01234567-89ab-4cde-8012-3456789abcde";
  const path = `output/jobs/${callId}.json`;
  const content = JSON.stringify({ callId, startedAt: "2026-10-13T12:30:00Z", status: "in progress", results: [] });
  const make = () => new Request(`http://localhost/api/import?path=${encodeURIComponent(path)}`, { method: "POST", body: content, headers: { authorization: "Bearer test-import-key", "x-folio-sha256": createHash("sha256").update(content).digest("hex") } });
  assert.equal((await handleImport(make(), root)).status, 200);
  assert.equal(JSON.parse(await readFile(join(root, path), "utf8")).status, "error");
  assert.equal((await (await handleImport(make(), root)).json()).alreadyExists, true);
});
