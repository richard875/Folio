import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { JobManager } from "./jobs.ts";

test("a stalled collection hits its deadline and releases the running lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-deadline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manager = new JobManager({ root, timeoutMs: 25, fetchImpl: async (_input, init) => {
    await new Promise((_resolve, reject) => {
      const signal = init!.signal!;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return new Response();
  } });
  const initial = await manager.start("test-key");
  assert.ok(initial);
  for (let attempt = 0; manager.isRunning && attempt < 100; attempt++) await sleep(10);
  assert.equal(manager.isRunning, false);
  const finished = await manager.get(initial.callId);
  assert.equal(finished?.status, "error");
  assert.ok(finished?.finishedAt);
  assert.equal(finished?.active, 0);
});
