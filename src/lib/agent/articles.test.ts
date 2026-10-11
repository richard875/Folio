import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test, type TestContext } from "node:test";
import { handleAgentLatest, handleAgentRead } from "./api.ts";
import { ArticleStore, validArticleFolder } from "./articles.ts";

const KEY = "agent-test-key";
const oldHash = process.env.ACCESS_HASH;
beforeEach(() => {
  process.env.ACCESS_HASH = KEY;
});
afterEach(() => {
  if (oldHash === undefined) delete process.env.ACCESS_HASH;
  else process.env.ACCESS_HASH = oldHash;
});

function request(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${KEY}` } });
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "folio-agent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: new ArticleStore(root) };
}

async function article(root: string, folder: string, name: string, content: string) {
  await mkdir(join(root, "output/articles", folder), { recursive: true });
  await writeFile(join(root, "output/articles", folder, name), content);
}

async function job(root: string, id: string, status: string, folder: string, failed = 0) {
  await mkdir(join(root, "output/jobs"), { recursive: true });
  await writeFile(
    join(root, "output/jobs", `${id}.json`),
    JSON.stringify({
      callId: id,
      status,
      startedAt: `${folder.slice(0, 10)}T${folder.slice(11).replace("-", ":")}:00.000Z`,
      finishedAt: status === "in progress" ? null : "2026-10-12T16:00:00Z",
      saved: 1,
      failed,
      results: [{ savedFile: `output/articles/${folder}/article.md` }],
    }),
  );
}

test("validates minute and legacy hourly folders without accepting traversal or invalid dates", () => {
  for (const folder of ["2026-10-11_14-12", "2026-10-11_14"])
    assert.equal(validArticleFolder(folder), true);
  for (const folder of [
    "../../private",
    "2026-02-30_14-12",
    "2026-10-11_24-00",
    "2026-10-11_14-60",
    "2026-1-1_14-12",
  ])
    assert.equal(validArticleFolder(folder), false);
});

test("manifest enumerates all Markdown/JSON/text files and excludes non-article files", async (t) => {
  const { root, store } = await fixture(t);
  const folder = "2026-10-11_14-12";
  await article(root, folder, "article.md", "# One\n\nBody\n");
  await article(
    root,
    folder,
    "second.json",
    JSON.stringify({ title: "Two", text: "Body", partial: true }),
  );
  await article(root, folder, "third.txt", "Three");
  await article(root, folder, ".DS_Store", "ignore");
  await article(root, folder, "unrelated.png", "ignore");
  await job(root, "finished", "error", folder, 2);
  const response = await handleAgentLatest(request("/api/agent/latest"), store);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.folder, folder);
  assert.equal(manifest.articleCount, 3);
  assert.equal(manifest.partialArticleCount, 1);
  assert.equal(manifest.collections[0].failed, 2);
  assert.equal(manifest.completionRule.requireEveryFile, true);
  assert.deepEqual(
    manifest.articles.map((entry: { filename: string }) => entry.filename),
    ["article.md", "second.json", "third.txt"],
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(JSON.stringify(manifest), /agent-test-key/);
});

test("prefers latest finished folder while a newer folder is still being written", async (t) => {
  const { root, store } = await fixture(t);
  const old = "2026-10-11_14-12";
  const newer = "2026-10-12_15-22";
  await article(root, old, "article.md", "Old complete article");
  await article(root, newer, "article.md", "New incomplete article");
  await job(root, "old", "completed", old);
  await job(root, "new", "in progress", newer);
  const snapshot = await store.latest();
  assert.equal(snapshot.folder, old);
  assert.equal(snapshot.pendingCollections, 1);
  await job(root, "new", "completed", newer);
  assert.equal((await store.latest()).folder, newer);
  // Completing a different folder cannot change an already pinned session.
  const response = await handleAgentRead(
    request(
      `/api/agent/read?${new URLSearchParams({ folder: old, snapshot: snapshot.snapshotId, file: "article.md" })}`,
    ),
    store,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, "Old complete article");
});

test("manifest pagination remains pinned when a newer folder appears", async (t) => {
  const { root, store } = await fixture(t);
  const folder = "2026-10-11_14-12";
  for (const name of ["a.md", "b.md", "c.md"]) await article(root, folder, name, name);
  const first = await (await handleAgentLatest(request("/api/agent/latest?limit=1"), store)).json();
  assert.equal(first.articleCount, 3);
  assert.equal(first.listedCount, 1);
  assert.equal(first.manifestComplete, false);
  assert.equal(first.articles[0].filename, "a.md");
  await article(root, "2026-10-12_15-22", "new.md", "New");
  const second = await (await handleAgentLatest(request(first.nextManifestUrl), store)).json();
  const third = await (await handleAgentLatest(request(second.nextManifestUrl), store)).json();
  assert.equal(second.folder, folder);
  assert.equal(third.snapshotId, first.snapshotId);
  assert.equal(third.manifestComplete, true);
  assert.equal(third.nextManifestUrl, null);
  assert.deepEqual(
    [first, second, third].flatMap((page) =>
      page.articles.map((entry: { filename: string }) => entry.filename),
    ),
    ["a.md", "b.md", "c.md"],
  );
});

test("an agent can reconstruct and verify every file through small Unicode-safe chunks", async (t) => {
  const { root, store } = await fixture(t);
  const folder = "2026-10-11_14-12";
  const files: Record<string, string> = {
    "article.md": "\uFEFF# Article\r\nEmoji 🦧 and café\r\n".repeat(4),
    "article.json": JSON.stringify({ title: "中文", text: "🦧\nFull article", partial: false }),
    "empty.txt": "",
  };
  for (const [name, content] of Object.entries(files)) await article(root, folder, name, content);
  const manifest = await (await handleAgentLatest(request("/api/agent/latest"), store)).json();
  let verified = 0;
  for (const entry of manifest.articles) {
    let url: string | null = `${entry.readUrl}&limit=3`;
    let content = "";
    let previousOffset = 0;
    let ended = false;
    while (url) {
      const response = await handleAgentRead(request(url), store);
      assert.equal(response.status, 200);
      const chunk = await response.json();
      assert.equal(chunk.offset, previousOffset);
      assert.equal(Array.from(chunk.text).length, chunk.chunkCharacters);
      assert.equal(chunk.snapshotId, manifest.snapshotId);
      content += chunk.text;
      previousOffset = chunk.nextOffset;
      ended = chunk.endOfArticle;
      url = chunk.nextUrl;
    }
    assert.equal(ended, true);
    assert.equal(content, files[entry.filename]);
    assert.equal(Array.from(content).length, entry.characters);
    assert.equal(Buffer.byteLength(content), entry.bytes);
    assert.equal(createHash("sha256").update(content).digest("hex"), entry.sha256);
    verified++;
  }
  assert.equal(verified, manifest.articleCount);
});

test("changed, added or removed files invalidate the snapshot rather than mixing content", async (t) => {
  const { root, store } = await fixture(t);
  const folder = "2026-10-11_14-12";
  await article(root, folder, "article.md", "Original");
  const first = await store.latest();
  await article(root, folder, "article.md", "Changed");
  await assert.rejects(store.snapshot(folder, first.snapshotId), /Snapshot changed/);
  const second = await store.latest();
  await article(root, folder, "added.md", "Added");
  await assert.rejects(store.snapshot(folder, second.snapshotId), /Snapshot changed/);
  const third = await store.latest();
  await rm(join(root, "output/articles", folder, "added.md"));
  await assert.rejects(store.snapshot(folder, third.snapshotId), /Snapshot changed/);
});

test("authentication is required on discovery and every chunk; query hashes also work", async (t) => {
  const { root, store } = await fixture(t);
  await article(root, "2026-10-11_14-12", "article.md", "Body");
  assert.equal(
    (await handleAgentLatest(new Request("http://localhost/api/agent/latest"), store)).status,
    401,
  );
  const manifest = await (
    await handleAgentLatest(new Request(`http://localhost/api/agent/latest?hash=${KEY}`), store)
  ).json();
  assert.equal(
    (await handleAgentRead(new Request(`http://localhost${manifest.articles[0].readUrl}`), store))
      .status,
    401,
  );
  assert.equal(
    (
      await handleAgentRead(
        new Request(`http://localhost${manifest.articles[0].readUrl}&hash=${KEY}`),
        store,
      )
    ).status,
    200,
  );
});

test("rejects path traversal, invalid ranges, missing files and unsafe symlinks", async (t) => {
  const { root, store } = await fixture(t);
  const folder = "2026-10-11_14-12";
  await article(root, folder, "article.md", "Body");
  const snapshot = await store.latest();
  const query = new URLSearchParams({ folder, snapshot: snapshot.snapshotId, file: "article.md" });
  assert.equal(
    (await handleAgentRead(request(`/api/agent/read?${query}&offset=100`), store)).status,
    416,
  );
  assert.equal(
    (await handleAgentRead(request(`/api/agent/read?${query}&limit=0`), store)).status,
    400,
  );
  query.set("file", "../../private");
  assert.equal((await handleAgentRead(request(`/api/agent/read?${query}`), store)).status, 400);
  query.set("file", "missing.md");
  assert.equal((await handleAgentRead(request(`/api/agent/read?${query}`), store)).status, 404);
  const outside = join(root, "secret.md");
  await writeFile(outside, "Private content");
  await symlink(outside, join(root, "output/articles", folder, "unsafe.md"));
  const response = await handleAgentLatest(request("/api/agent/latest"), store);
  assert.equal(response.status, 409);
  assert.doesNotMatch(await response.text(), /Private content/);
});

test("no ready folder and malformed article JSON are explicit errors", async (t) => {
  const { root, store } = await fixture(t);
  assert.equal((await handleAgentLatest(request("/api/agent/latest"), store)).status, 404);
  const folder = "2026-10-11_14-12";
  await article(root, folder, "article.md", "Writing");
  await job(root, "pending", "in progress", folder);
  assert.equal((await handleAgentLatest(request("/api/agent/latest"), store)).status, 409);
  await job(root, "pending", "completed", folder);
  await article(root, folder, "broken.json", "{invalid");
  assert.equal((await handleAgentLatest(request("/api/agent/latest"), store)).status, 409);
});
