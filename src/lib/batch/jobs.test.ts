import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { handleCollectRequest, handleCollectStatus } from "./api.ts";
import { JobManager, parseLinksFile, saveConcurrency, type Job, type SaveBatchJob } from "./jobs.ts";
import { handleSaveRequest } from "../../../reader/save-api.ts";
import { saveArticle } from "../../../reader/save.ts";

const CALL_ID = "01234567-89ab-4cde-8012-3456789abcde";

test("resolves only Google News wrappers before save and never saves an unresolved wrapper", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-batch-google-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const linksFile = "output/links/links_2026-10-11_12-34-56.md";
  await mkdir(join(root, "output/links"), { recursive: true });
  await writeFile(
    join(root, linksFile),
    "# Example News\n## Main feed\n- <https://news.google.com/rss/articles/CBMiWorking>\n- <https://news.google.com/rss/articles/CBMiBroken>\n# NY Times\n## Main feed\n- <https://www.nytimes.com/story>\n",
  );
  const saves: URL[] = [];
  const manager = new JobManager({
    root,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "news.google.com") {
        assert.equal(url.searchParams.has("hash"), false);
        if (url.pathname.endsWith("CBMiWorking"))
          return new Response(null, {
            status: 302,
            headers: { location: "https://example.com/world/real-article/" },
          });
        return new Response("No destination", { status: 503 });
      }
      if (url.pathname === "/api/links") return Response.json({ savedFile: linksFile });
      assert.equal(url.pathname, "/api/save");
      saves.push(url);
      return new Response("article", { headers: { "x-saved-file": "output/articles/example.md" } });
    },
  });
  const job = await manager.start("test-key");
  assert.ok(job);
  const result = await finished(manager, job.callId);
  assert.equal(result.status, "partial");
  assert.equal(result.saved, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(saves.map((url) => url.searchParams.get("url")).sort(), [
    "https://example.com/world/real-article/",
    "https://www.nytimes.com/story",
  ]);
  const publisher = saves.find((url) => url.searchParams.get("website") === "Example News")!;
  assert.equal(publisher.searchParams.get("section"), "Main feed");
  assert.equal(publisher.searchParams.get("callId"), job.callId);
  assert.equal(publisher.searchParams.get("hash"), "test-key");
  assert.equal(
    result.results.find((entry: Job["results"][0]) => entry.website === "Example News" && entry.status === "saved")?.url,
    "https://example.com/world/real-article/",
  );
  const failedEntry = result.results.find((entry: Job["results"][0]) => entry.status === "failed");
  assert.ok(failedEntry, "Expected a failed entry for the unresolved Google News wrapper");
});

async function finished(manager: JobManager, callId: string): Promise<Job | SaveBatchJob> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const job = await manager.get(callId);
    if (job?.status !== "in progress" && job) return job;
    await delay(5);
  }
  throw new Error("Job did not finish");
}

test("parses file headings, deduplicates within sections and keeps different sections", () => {
  const tasks = parseLinksFile(
    "# News \\& More\n## World\n- <https://example.com/story>\n- <https://example.com/story>\n## Tech\n- <https://example.com/story>\n# Other\n## World\n- <https://example.com/other>\n",
  );
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].website, "News & More");
  assert.equal(tasks[1].section, "Tech");
});

test("concurrency defaults to five and validates the environment setting", () => {
  for (const value of [undefined, "", "0", "-1", "1.5", "51", "invalid"])
    assert.equal(saveConcurrency(value), 5);
  assert.equal(saveConcurrency("3"), 3);
});

test("returns immediately, calls links then parallel saves, tracks progress and persists completed jobs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-batch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const oldConcurrency = process.env.SAVE_CONCURRENCY;
  process.env.SAVE_CONCURRENCY = "3";
  t.after(() => {
    if (oldConcurrency === undefined) delete process.env.SAVE_CONCURRENCY;
    else process.env.SAVE_CONCURRENCY = oldConcurrency;
  });
  const linksFile = "output/links/links_2026-10-11_12-34-56.md";
  await mkdir(join(root, "output/links"), { recursive: true });
  await writeFile(
    join(root, linksFile),
    `# News Site\n## World News\n${Array.from({ length: 8 }, (_, index) => `- <https://example.com/story-${index}>`).join("\n")}\n`,
  );
  let releaseLinks!: () => void;
  const gate = new Promise<void>((done) => {
    releaseLinks = done;
  });
  let active = 0;
  let maximum = 0;
  const received: URL[] = [];
  let releaseSaves!: () => void;
  const savesReady = new Promise<void>((done) => { releaseSaves = done; });
  const manager = new JobManager({
    root,
    internalBase: () => "http://127.0.0.1:3000",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("hash"), "never-store-this-secret");
      if (url.pathname === "/api/links") {
        await gate;
        return Response.json({ savedFile: linksFile, failedFeedCount: 1, websites: [] });
      }
      assert.equal(url.pathname, "/api/save");
      received.push(url);
      active++;
      maximum = Math.max(maximum, active);
      // Wait for all three workers: fsync speed must not make this a timing test.
      if (received.length === 3) releaseSaves();
      await savesReady;
      await delay(20);
      active--;
      return new Response("article", {
        headers: { "x-saved-file": `output/articles/test-${received.length}.md` },
      });
    },
  });
  const initial = await manager.start("never-store-this-secret");
  assert.ok(initial);
  assert.equal(initial.status, "in progress");
  assert.equal(initial.phase, "collecting links");
  assert.equal(await manager.start("never-store-this-secret"), null);
  assert.equal((await manager.get(initial.callId))?.status, "in progress");
  releaseLinks();
  const result = await finished(manager, initial.callId);
  assert.equal(result.status, "partial");
  assert.equal(result.total, 8);
  assert.equal(result.saved, 8);
  assert.equal(result.processed, 8);
  assert.equal(result.active, 0);
  assert.equal((result as Job).failedFeeds, 1);
  assert.equal(maximum, 3);
  for (const url of received) {
    assert.equal(url.searchParams.get("website"), "News Site");
    assert.equal(url.searchParams.get("section"), "World News");
    assert.equal(url.searchParams.get("callId"), initial.callId);
  }
  const disk = await readFile(join(root, "output/jobs", `${initial.callId}.json`), "utf8");
  assert.doesNotMatch(disk, /never-store-this-secret|methodUrl|bypass/);
  assert.equal((await new JobManager({ root }).get(initial.callId))?.status, "partial");
});

test("retries rate limits, retains partial successes and continues past article errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-batch-errors-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const linksFile = "output/links/links_2026-10-11_12-34-56.md";
  await mkdir(join(root, "output/links"), { recursive: true });
  await writeFile(
    join(root, linksFile),
    "# Example\n## World\n- <https://example.com/limited>\n- <https://example.com/failed>\n",
  );
  let limited = 0;
  const waits: number[] = [];
  const manager = new JobManager({
    root,
    wait: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/links") return Response.json({ savedFile: linksFile });
      if (url.searchParams.get("url")?.endsWith("limited")) {
        if (!limited++)
          return new Response("wait", { status: 429, headers: { "retry-after": "2" } });
        return new Response("partial", {
          status: 206,
          headers: { "x-saved-file": "output/articles/partial.md" },
        });
      }
      return new Response("internal service details", { status: 422 });
    },
  });
  const job = await manager.start("test");
  assert.ok(job);
  const result = await finished(manager, job.callId);
  assert.equal(result.status, "partial");
  assert.equal(result.saved, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.processed, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(result.results.find((entry: Job["results"][0]) => entry.status === "saved")?.partial, true);
  assert.ok(result.results.find((entry: Job["results"][0]) => entry.status === "failed"));
  assert.doesNotMatch(JSON.stringify(result), /internal service details/);
});

test("restart marks interrupted records as error and validates call IDs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-batch-restart-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "output/jobs"), { recursive: true });
  await writeFile(
    join(root, "output/jobs", `${CALL_ID}.json`),
    JSON.stringify({ callId: CALL_ID, status: "in progress", active: 2 }),
  );
  const manager = new JobManager({ root });
  const job = await manager.get(CALL_ID);
  assert.equal(job?.status, "error");
  assert.equal(job?.active, 0);
  assert.match(job?.error || "", /server restarted/);
  assert.equal(await manager.get("../../private"), null);
  assert.equal(await manager.get("00000000-0000-0000-0000-000000000000"), null);
});

test("API returns 202 and checks authenticated statuses without waiting for background work", async (t) => {
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "batch-test-key";
  t.after(() => {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
  });
  const stub = {
    start: async () =>
      ({
        callId: CALL_ID,
        status: "in progress",
        phase: "collecting links",
        concurrency: 5,
      }) as Job,
  };
  assert.equal(
    (await handleCollectRequest(new Request("http://localhost/api/collect"), stub)).status,
    401,
  );
  const started = await handleCollectRequest(
    new Request("http://untrusted.example/api/collect?hash=batch-test-key"),
    stub,
  );
  assert.equal(started.status, 202);
  assert.equal((await started.json()).callId, CALL_ID);
  const unknown = await handleCollectStatus(
    new Request(`http://localhost/api/collect/status?hash=batch-test-key&callId=${CALL_ID}`),
    { get: async () => null },
  );
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).status, "not found");
  assert.equal(
    (
      await handleCollectStatus(
        new Request("http://localhost/api/collect/status?hash=batch-test-key"),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleCollectRequest(new Request("http://localhost/api/collect?hash=batch-test-key"), {
        start: async () => null,
      })
    ).status,
    409,
  );
});

test("batch save passes callId through the real save handler and writes the article", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-batch-save-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const linksFile = "output/links/links_2026-10-11_12-34-56.md";
  await mkdir(join(root, "output/links"), { recursive: true });
  await writeFile(
    join(root, linksFile),
    "# Example News\n## World News\n- <https://example.com/story>\n",
  );
  const manager = new JobManager({
    root,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/links") return Response.json({ savedFile: linksFile });
      const response = await handleSaveRequest(new Request(url), {
        getJob: (callId) => manager.get(callId),
        read: async () => ({
          title: "An example article",
          author: "",
          published: "",
          originalUrl: "https://example.com/story",
          text: "Text",
          markdown: "# Article\nText",
          images: [],
          partial: false,
        }),
        save: (article, options) =>
          saveArticle(article, {
            ...options,
            outputDir: join(root, "output/articles"),
            now: () => new Date("2099-12-31T23:59:59Z"),
          }),
      });
      assert.equal(response.headers.get("x-call-id"), url.searchParams.get("callId"));
      return response;
    },
  });
  const job = await manager.start("test-key");
  assert.ok(job);
  const result = await finished(manager, job.callId);
  assert.equal(result.status, "completed");
  assert.match(result.results[0].savedFile || "", /example_news_world_news_an_example_article/);
  const dirs = await readdir(join(root, "output/articles"));
  assert.equal(dirs.length, 1);
  assert.equal(
    dirs[0],
    `${job.startedAt.slice(0, 10)}_${job.startedAt.slice(11, 16).replace(":", "-")}`,
  );
});

test("real start/status handlers return while links are pending and expose collection errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "folio-batch-api-"));
  const oldHash = process.env.ACCESS_HASH;
  process.env.ACCESS_HASH = "pending-test-key";
  t.after(async () => {
    if (oldHash === undefined) delete process.env.ACCESS_HASH;
    else process.env.ACCESS_HASH = oldHash;
    await rm(root, { recursive: true, force: true });
  });
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  const manager = new JobManager({
    root,
    fetchImpl: async (input) => {
      assert.equal(new URL(String(input)).hostname, "127.0.0.1");
      await pending;
      return Response.json({ error: "private internal details" }, { status: 500 });
    },
  });
  const start = await handleCollectRequest(
    new Request("http://host-injection.example/api/collect?hash=pending-test-key"),
    manager,
  );
  assert.equal(start.status, 202);
  const { callId } = await start.json();
  const statusRequest = new Request(
    `http://localhost/api/collect/status?hash=pending-test-key&callId=${callId}`,
  );
  const inProgress = await handleCollectStatus(statusRequest, manager);
  assert.equal((await inProgress.json()).status, "in progress");
  release();
  await finished(manager, callId);
  const terminal = await handleCollectStatus(statusRequest, manager);
  assert.equal(terminal.status, 200);
  const job = await terminal.json();
  assert.equal(job.status, "error");
  assert.equal(job.queued, 0);
  assert.doesNotMatch(JSON.stringify(job), /private internal details|pending-test-key/);
});
