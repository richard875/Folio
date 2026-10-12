import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BoundedCache, WorkLimit, boundedInteger } from "./limits.ts";
import { boundedBytes, publicAddress, publicFetch, publicLookup, publicUrl } from "./network.ts";
import { writeNewFile } from "./storage.ts";
import { handleHealth } from "./health.ts";
import { fetchHtml } from "../reader/fetch.ts";

test("work admission rejects overload without queueing and releases after failures", async () => {
  const limit = new WorkLimit(() => 1);
  let release!: () => void;
  const first = limit.run(() => new Promise<void>((resolve) => { release = resolve; }));
  await assert.rejects(limit.run(async () => {}), { status: 429 });
  release();
  await first;
  await assert.rejects(limit.run(async () => { throw new Error("failed"); }), /failed/);
  assert.equal(await limit.run(async () => 7), 7);
});

test("cache is bounded by both entry count and retained size", () => {
  const cache = new BoundedCache<string>(2, 10, 60000);
  cache.set("one", "one", 5);
  cache.set("two", "two", 6);
  assert.equal(cache.get("one"), undefined);
  cache.set("large", "large", 11);
  assert.equal(cache.get("large"), undefined);
  assert.equal(cache.get("two"), "two");
  cache.set("two", "replacement", 4);
  cache.set("three", "three", 4);
  cache.set("four", "four", 1);
  assert.equal(cache.get("two"), undefined);
  const expired = new BoundedCache<string>(1, 10, -1);
  expired.set("expired", "x", 1);
  assert.equal(expired.get("expired"), undefined);
  assert.equal(boundedInteger("999999", 5, 10), 5);
});

test("blocks private, metadata, encoded and IPv4-mapped IPv6 destinations", () => {
  for (const host of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1"]) {
    assert.equal(publicAddress(host), false, host);
  }
  for (const url of ["http://2130706433", "http://127.1", "http://[::ffff:127.0.0.1]", "http://localhost.", "http://user:password@example.com", "file:///etc/passwd"]) {
    assert.throws(() => publicUrl(url), Error, url);
  }
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  assert.equal(publicUrl("https://fcnews.example.com/article").hostname, "fcnews.example.com");
});

test("socket lookup rejects hostnames resolving to private addresses", async () => {
  await new Promise<void>((resolve) => {
    publicLookup("localhost", { family: 0, hints: 0 }, (error) => {
      assert.ok(error);
      resolve();
    });
  });
});

test("streaming size limit cancels chunked responses before buffering the full payload", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(boundedBytes(response, 10), /Response too large/);
  assert.equal(cancelled, true);
  await assert.rejects(boundedBytes(new Response("x", { headers: { "content-length": "100" } }), 10), /Response too large/);
  assert.equal(new TextDecoder().decode(await boundedBytes(new Response("hello"), 10)), "hello");
});

test("streaming deadline cancels a stalled body", async () => {
  const controller = new AbortController();
  const response = new Response(new ReadableStream({ pull() {} }));
  const reading = boundedBytes(response, 10, controller.signal);
  controller.abort();
  await assert.rejects(reading, { name: "AbortError" });
});

test("public fetch rejects literal metadata destinations before any request", async () => {
  await assert.rejects(publicFetch("http://169.254.169.254/opc/v2/instance/"), /Private network/);
});

test("article redirects cannot reach metadata even from an initially public URL", async (t) => {
  const original = globalThis.fetch;
  const retry = process.env.FETCH_RETRY_LIMIT;
  t.after(() => { globalThis.fetch = original; if (retry === undefined) delete process.env.FETCH_RETRY_LIMIT; else process.env.FETCH_RETRY_LIMIT = retry; });
  process.env.FETCH_RETRY_LIMIT = "0";
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/opc/v2/instance/" } }); };
  await assert.rejects(fetchHtml("https://example.com", "direct", Date.now() + 1000), /Private network/);
  assert.equal(requests, 1);
});

test("atomic publication cannot overwrite files and cleans temporary files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "folio-storage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "article.md");
  await writeNewFile(path, "complete article");
  await assert.rejects(writeNewFile(path, "replacement"), { code: "EEXIST" });
  assert.equal(await readFile(path, "utf8"), "complete article");
  assert.deepEqual(await readdir(directory), ["article.md"]);
});

test("health is authenticated, non-cacheable and checks writable persistent storage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-health-"));
  const old = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "health-test";
  t.after(async () => { if (old === undefined) delete process.env.ACCESS_HASH; else process.env.ACCESS_HASH = old; await rm(root, { recursive: true, force: true }); });
  assert.equal((await handleHealth(new Request("http://localhost/api/health"), root)).status, 401);
  const request = new Request("http://localhost/api/health", { headers: { authorization: "Bearer health-test" } });
  assert.equal((await handleHealth(request, root)).status, 503);
  await mkdir(join(root, "output/jobs"), { recursive: true });
  const response = await handleHealth(request, root);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).status, "ready");
  assert.deepEqual(await readdir(join(root, "output/jobs")), []);
});
