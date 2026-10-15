import assert from "node:assert/strict";
import { test } from "node:test";
import { handleSaveBatchRequest, handleSaveBatchStatus } from "./save-batch.ts";
import { JobManager, validCallId, type Job, type SaveBatchJob } from "./jobs.ts";
import { randomUUID } from "node:crypto";

const TEST_HASH = "batch-test-key";

function createMockRequest(body: unknown, hash = TEST_HASH): Request {
  return new Request(`http://localhost/api/save-batch?hash=${hash}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("save-batch: unauthorized without hash", async () => {
  const req = new Request("http://localhost/api/save-batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls: [{ url: "https://example.com/article" }] }),
  });
  const res = await handleSaveBatchRequest(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, "Unauthorized");
});

test("save-batch: rejects empty urls array", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    const req = createMockRequest({ urls: [] });
    const res = await handleSaveBatchRequest(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, "urls array is required and must not be empty.");
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch: rejects too many urls", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    const urls = Array.from({ length: 101 }, (_, i) => ({ url: `https://example.com/${i}` }));
    const req = createMockRequest({ urls });
    const res = await handleSaveBatchRequest(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, "Maximum 100 URLs per request.");
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch: validates callId format", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    const req = createMockRequest({ urls: [{ url: "https://example.com/article", callId: "invalid" }] });
    const res = await handleSaveBatchRequest(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /Invalid callId/);
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch: validates callId exists", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    const req = createMockRequest({ urls: [{ url: "https://example.com/article", callId: randomUUID() }] });
    const res = await handleSaveBatchRequest(req);
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.match(json.error, /Call not found/);
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch: validates format parameter", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    const req = createMockRequest({ urls: [{ url: "https://example.com/article" }], format: "xml" });
    const res = await handleSaveBatchRequest(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, "Use format=markdown or format=json.");
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch: requires POST method", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    const req = new Request(`http://localhost/api/save-batch?hash=${TEST_HASH}`, { method: "GET" });
    const res = await handleSaveBatchRequest(req);
    assert.equal(res.status, 405);
    const json = await res.json();
    assert.equal(json.error, "Method not allowed. Use POST.");
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch: returns 202 with callId and statusEndpoint", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    const req = createMockRequest({ urls: [{ url: "https://example.com/article1" }, { url: "https://example.com/article2" }] });
    const res = await handleSaveBatchRequest(req);
    assert.equal(res.status, 202);
    const json = await res.json();
    assert.ok(json.callId);
    assert.ok(validCallId(json.callId));
    assert.equal(json.status, "in progress");
    assert.equal(json.phase, "saving articles");
    assert.equal(json.total, 2);
    assert.equal(json.processed, 0);
    assert.equal(json.saved, 0);
    assert.equal(json.failed, 0);
    assert.equal(json.active, 0);
    assert.ok(json.statusEndpoint);
    assert.match(json.statusEndpoint, /\/api\/save-batch\/status\?callId=/);
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch: rejects when another job is running", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    // Use a manager with a slow fetch that keeps the job running
    let resolveSlow: (value: Response) => void;
    const slowFetch = async () => new Promise<Response>((resolve) => { resolveSlow = resolve; });
    const manager = new JobManager({ fetchImpl: slowFetch });
    // Start a job that blocks
    await manager.startSaveBatch(
      [{ url: "https://example.com/block", website: "test", section: "test" }],
      TEST_HASH,
    );
    // Wait a bit for it to start
    await new Promise((r) => setTimeout(r, 50));

    const req = createMockRequest({ urls: [{ url: "https://example.com/article" }] });
    const res = await handleSaveBatchRequest(req, manager);
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.equal(json.error, "A collection or save-batch job is already running.");
    // Clean up
    resolveSlow!(new Response("ok", { status: 200 }));
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch/status: unauthorized without hash", async () => {
  const req = new Request("http://localhost/api/save-batch/status?callId=123e4567-e89b-12d3-a456-426614174000");
  const res = await handleSaveBatchStatus(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, "Unauthorized");
});

test("save-batch/status: requires callId", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    const req = new Request(`http://localhost/api/save-batch/status?hash=${TEST_HASH}`);
    const res = await handleSaveBatchStatus(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, "callId is required.");
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch/status: validates callId format", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    const req = new Request(`http://localhost/api/save-batch/status?callId=invalid&hash=${TEST_HASH}`);
    const res = await handleSaveBatchStatus(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, "Invalid callId.");
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch/status: returns 404 for unknown callId", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    const req = new Request(`http://localhost/api/save-batch/status?callId=${randomUUID()}&hash=${TEST_HASH}`);
    const res = await handleSaveBatchStatus(req);
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.status, "not found");
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});

test("save-batch/status: returns job status for valid callId", async () => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = TEST_HASH;
  try {
    // Use a manager with a mock fetch that responds to internal /api/save calls
    let saveCallCount = 0;
    const manager = new JobManager({
      timeoutMs: 1000,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/save") {
          saveCallCount++;
          return new Response("Test article content", {
            status: 200,
            headers: { "x-saved-file": `output/articles/test-${saveCallCount}.md` },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const job = await manager.startSaveBatch(
      [{ url: "https://example.com/article1", website: "Test", section: "Test" }],
      TEST_HASH,
    );
    assert.ok(job);

    // Give the job a moment to start
    await new Promise((r) => setTimeout(r, 50));

    const req = new Request(`http://localhost/api/save-batch/status?callId=${job!.callId}&hash=${TEST_HASH}`);
    const res = await handleSaveBatchStatus(req, manager);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.callId, job!.callId);
    assert.ok(["in progress", "error", "completed", "partial"].includes(json.status));
    assert.equal(json.phase, json.status === "in progress" ? "saving articles" : "finished");
    assert.equal(json.total, 1);
    assert.ok(Array.isArray(json.results));
  } finally {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  }
});
