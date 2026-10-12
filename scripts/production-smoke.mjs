// Built-server integration test. All writable data and credentials are disposable;
// never starts collection, fetches publisher articles, or changes real output/.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const project = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "folio-production-smoke-"));
const hash = randomBytes(32).toString("hex");
const port = process.env.PRODUCTION_SMOKE_PORT || "8081";
const origin = `http://127.0.0.1:${port}`;
const folder = new Date().toISOString().slice(0, 16).replace("T", "_").replace(/:(\d\d)$/, "-$1");
const callId = "01234567-89ab-4cde-8012-3456789abcde";
const articles = new Map();
let child;
let logs = "";
let peakRss = 0;

async function get(path, bearer = true, options = {}) {
  return fetch(`${origin}${path}`, {
    ...options, signal: AbortSignal.timeout(15000), redirect: "error",
    headers: { ...(bearer ? { authorization: `Bearer ${hash}` } : {}), ...options.headers },
  });
}

try {
  await mkdir(join(root, "output/articles", folder), { recursive: true });
  await mkdir(join(root, "output/jobs"), { recursive: true });
  await symlink(resolve(project, ".output"), join(root, ".output"), "dir");
  for (let index = 0; index < 12; index++) {
    const filename = `article-${index}.md`;
    const content = `# Fixture ${index}\n\n${"Unicode café 📰 reporting.\n".repeat(180)}`;
    articles.set(filename, content);
    await writeFile(join(root, "output/articles", folder, filename), content);
  }
  await writeFile(join(root, "output/jobs", `${callId}.json`), JSON.stringify({
    callId, status: "in progress", startedAt: new Date().toISOString(), finishedAt: null,
    active: 2, saved: 12, failed: 0, results: [],
  }));
  const env = { ...process.env, ACCESS_HASH: hash, HOST: "127.0.0.1", PORT: port };
  for (const key of ["NODE_OPTIONS", "DATABASE_URL", "NITRO_HOST", "NITRO_PORT", "NITRO_UNIX_SOCKET", "NITRO_SSL_CERT", "NITRO_SSL_KEY"]) delete env[key];
  child = spawn(process.execPath, ["--max-old-space-size=2048", join(project, "scripts/start-production.mjs")], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => { logs += data.toString(); });
  child.stderr.on("data", (data) => { logs += data.toString(); });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error("Production server exited before readiness.");
    try { if ((await get("/api/health")).ok) { ready = true; break; } } catch { /* Starting. */ }
    await sleep(100);
  }
  assert.ok(ready, "Production server did not become ready.");
  assert.equal(JSON.parse(await readFile(join(root, "output/jobs", `${callId}.json`), "utf8")).status, "error");

  for (const path of ["/api/read", "/api/save", "/api/links", "/api/collect", "/api/collect/status", "/api/agent/latest", "/api/agent/read", "/api/health", "/api/docs", "/api/openapi", "/api/docs/assets", "/api/purge"]) {
    assert.equal((await get(path, false)).status, 401, path);
  }
  const invalid = await get(`/api/read?${new URLSearchParams({ hash, url: "http://169.254.169.254/opc/v2/instance/", format: "json" })}`, false);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  const docs = await get(`/api/docs?${new URLSearchParams({ hash })}`, false);
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(html, /data:image\/png;base64/);
  assert.doesNotMatch(html, /history\.replaceState/);
  assert.equal((await get("/api/openapi")).status, 200);

  const manifest = [];
  let manifestUrl = "/api/agent/latest?limit=3";
  let snapshotId;
  while (manifestUrl) {
    const response = await get(manifestUrl);
    assert.equal(response.status, 200);
    const data = await response.json();
    snapshotId ??= data.snapshotId;
    assert.equal(data.snapshotId, snapshotId);
    assert.equal(data.articleCount, articles.size);
    manifest.push(...data.articles);
    manifestUrl = data.nextManifestUrl;
  }
  assert.equal(manifest.length, articles.size);
  let chunks = 0;
  for (const article of manifest) {
    let url = `${article.readUrl}&limit=1000`;
    let reconstructed = "";
    while (url) {
      const response = await get(url);
      assert.equal(response.status, 200);
      const data = await response.json();
      reconstructed += data.text;
      url = data.nextUrl;
      chunks++;
    }
    assert.equal(reconstructed, articles.get(article.filename));
    assert.equal(createHash("sha256").update(reconstructed).digest("hex"), article.sha256);
    assert.equal(Array.from(reconstructed).length, article.characters);
  }
  for (let round = 0; round < 10; round++) {
    await Promise.all(Array.from({ length: 10 }, async () => {
      const response = await get(`/api/agent/latest?folder=${folder}&snapshot=${snapshotId}`);
      assert.ok([200, 429].includes(response.status));
      await response.arrayBuffer();
    }));
    const data = await (await get("/api/health")).json();
    peakRss = Math.max(peakRss, data.memoryBytes.rss);
  }
  assert.ok(peakRss < 4 * 1024 ** 3, "Sampled memory exceeded the production service ceiling.");
  const query = new URLSearchParams({ hash });
  assert.equal((await get(`/api/purge?${query}`, false)).status, 405);
  await writeFile(join(root, "output/jobs", `${callId}.json`), JSON.stringify({ callId, status: "in progress" }));
  assert.equal((await get(`/api/purge?${query}`, false, { method: "POST" })).status, 409);
  assert.deepEqual((await readdir(join(root, "output/articles", folder))).sort(), [...articles.keys()].sort());
  const duplicate = spawn(process.execPath, ["--max-old-space-size=2048", join(project, "scripts/start-production.mjs")], { cwd: root, env, stdio: "ignore" });
  assert.equal(await new Promise((resolve) => duplicate.once("exit", resolve)), 1);
  assert.equal(JSON.parse(await readFile(join(root, "output/jobs", `${callId}.json`), "utf8")).status, "in progress", "A duplicate startup modified active job records.");

  // Interactive fallback: agent-browser is not installed in this macOS workspace.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Article URL").fill("http://169.254.169.254/opc/v2/instance/");
    await page.getByLabel("Access key").fill(hash);
    await page.getByRole("button", { name: "Read article", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Private network" }).waitFor();
    await page.getByRole("button", { name: "API documentation", exact: true }).click();
    assert.ok(await page.getByRole("link", { name: "Open Swagger UI" }).isVisible());
    await page.goto(`${origin}/api/docs?${new URLSearchParams({ hash })}`, { waitUntil: "domcontentloaded" });
    await page.locator(".swagger-ui .opblock").first().waitFor();
    assert.ok(new URL(page.url()).searchParams.get("hash") === hash, "Swagger lost its query authentication.");
    const refreshed = await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(refreshed.status(), 200);
    await page.locator(".swagger-ui .opblock").first().waitFor();
    assert.ok(new URL(page.url()).searchParams.get("hash") === hash, "Swagger refresh lost authentication.");
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }

  // Render checks use the same real standalone process and disposable data.
  const compareDev = process.env.PRODUCTION_SMOKE_COMPARE_DEV === "1";
  const renders = [
    ...(compareDev ? [["oracle-dev", "http://127.0.0.1:8080/", null]] : []),
    ["oracle-production", `${origin}/`, compareDev ? join(project, "screenshots/oracle-dev.json") : null],
  ];
  for (const [name, url, baseline] of renders) {
    const args = [join(project, "scripts/browser-smoke.mjs"), url, join(project, `screenshots/${name}.png`)];
    if (baseline) args.push("--baseline", baseline);
    const smoke = spawn(process.execPath, args, { cwd: project, stdio: "inherit" });
    const code = await new Promise((resolve) => smoke.once("exit", resolve));
    assert.equal(code, 0, `${name} render check failed`);
  }
  console.info(JSON.stringify({ productionSmoke: "passed", verifiedFiles: manifest.length, verifiedChunks: chunks, sampledPeakRssMiB: Math.round(peakRss / 1024 ** 2), storage: "disposable fixtures only" }));
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
    await new Promise((resolve) => child.once("exit", resolve));
    clearTimeout(timeout);
  }
  assert.ok(!logs.includes(hash), "Production logs exposed the access hash.");
  await rm(root, { recursive: true, force: true });
}
