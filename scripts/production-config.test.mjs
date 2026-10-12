import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionConfig, prepareProduction } from "./production-config.mjs";

test("production fails closed on weak credentials, unsupported binding, database and invalid budgets", () => {
  const valid = { ACCESS_HASH: "a".repeat(64) };
  assert.deepEqual(productionConfig(valid), { host: "0.0.0.0", port: "3000" });
  for (const change of [
    { ACCESS_HASH: "weak" }, { HOST: "example.com" },
    { PORT: "80" }, { PORT: "65536" }, { DATABASE_URL: "postgres://example" },
    { NODE_OPTIONS: "--max-old-space-size=999999" }, { SAVE_CONCURRENCY: "50" },
    { READ_CONCURRENCY: "11" }, { FETCH_RETRY_LIMIT: "999" }, { RSS_LINKS_PER_SECTION: "101" },
  ]) assert.throws(() => productionConfig({ ...valid, ...change }));
  assert.equal(productionConfig({ ...valid, FETCH_RETRY_LIMIT: "0" }).port, "3000");
  assert.equal(productionConfig({ ...valid, HOST: "0.0.0.0", PORT: "8765", NITRO_PORT: "9999", NODE_OPTIONS: "--max-old-space-size=256 --max-semi-space-size=16" }).port, "8765");
});

test("production recovers all interrupted jobs before serving, without changing finished jobs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-preflight-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".output/server"), { recursive: true });
  await writeFile(join(root, ".output/server/index.mjs"), "export {};");
  await mkdir(join(root, "output/jobs"), { recursive: true });
  const pending = "01234567-89ab-4cde-8012-3456789abcde.json";
  const complete = "01234567-89ab-4cde-8012-3456789abcdf.json";
  await writeFile(join(root, "output/jobs", pending), JSON.stringify({ status: "in progress", active: 5, saved: 3, results: [] }));
  await writeFile(join(root, "output/jobs", complete), JSON.stringify({ status: "completed" }));
  assert.equal(await prepareProduction(root), 1);
  const recovered = JSON.parse(await readFile(join(root, "output/jobs", pending), "utf8"));
  assert.equal(recovered.status, "error");
  assert.equal(recovered.saved, 3);
  assert.equal(recovered.active, 0);
  assert.ok(recovered.finishedAt);
  assert.equal(JSON.parse(await readFile(join(root, "output/jobs", complete), "utf8")).status, "completed");
  assert.equal(await prepareProduction(root), 0);
});
