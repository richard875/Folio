// Built-server integration test. All writable data and credentials are disposable;
// never starts background article collection, contacts publishers, or changes real output/.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { mainFeeds as feedCatalog, feedInventory } from "../src/lib/rss/sources.ts";

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
  const env = { ...process.env, ACCESS_HASH: hash, HOST: "0.0.0.0", PORT: port, READ_CONCURRENCY: "1", SAVE_CONCURRENCY: "1", FEED_CONCURRENCY: "2", FETCH_RETRY_LIMIT: "2", NITRO_SHUTDOWN_TIMEOUT: "20000" };
  for (const key of ["NODE_OPTIONS", "DATABASE_URL", "NITRO_HOST", "NITRO_PORT", "NITRO_UNIX_SOCKET", "NITRO_SSL_CERT", "NITRO_SSL_KEY"]) delete env[key];
  // Test-only publisher transport, never deployed: exercise real HTTP extraction
  // and DOM parsing without issuing third-party article requests or saving real data.
  const fixtureHtml = `<html><head><title>Memory fixture</title></head><body><article><h1>Memory fixture</h1>${("<p>Folio reports on the changing economic situation and explains the evidence in detail for its readers. This is a synthetic memory-test paragraph.</p>").repeat(1200)}</article></body></html>`;
  const publisherDomains = {
    WSJ: "www.wsj.com", "NY Times": "www.nytimes.com", "Washington Post": "www.washingtonpost.com",
    Bloomberg: "www.bloomberg.com", "The Economist": "www.economist.com", "Financial Times": "www.ft.com",
    "Foreign Policy": "foreignpolicy.com", CNBC: "www.cnbc.com", Reuters: "www.reuters.com", "Business Insider": "www.businessinsider.com",
  };
  const feedFixtures = Object.fromEntries(feedCatalog.map((feed) => {
    const url = `https://${publisherDomains[feed.site]}/world/fixture-story`;
    const date = new Date().toISOString();
    const xml = feed.format === "news-sitemap"
      ? `<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>${url}</loc><news:news><news:title>Fixture article</news:title><news:publication_date>${date}</news:publication_date></news:news></url></urlset>`
      : `<rss><channel><item><title>Fixture article</title><link>${url}</link><pubDate>${date}</pubDate></item></channel></rss>`;
    return [feed.url, xml];
  }));
  const preload = join(root, "fixture-transport.mjs");
  const selectiveSource = feedInventory.find(({ site, section }) => site === "Financial Times" && section === "Canada");
  assert.ok(selectiveSource);
  const selectiveXml = `<rss><channel>${Array.from({ length: 4 }, (_, index) => `<item><title>Canadian economy fixture ${index}</title><link>https://www.ft.com/content/fixture-canada-${index}</link><description>A detailed synthetic feed description for Canadian economic reporting.</description></item>`).join("")}</channel></rss>`;
  const inactiveFeeds = feedInventory.filter(({ section }) => section !== "Main feed").map(({ url }) => url);
  await writeFile(preload, `const original = globalThis.fetch; const html = ${JSON.stringify(fixtureHtml)}; const feeds = ${JSON.stringify(feedFixtures)}; const inactive = new Set(${JSON.stringify(inactiveFeeds)}); globalThis.fetch = (input, init) => { if (String(input) === ${JSON.stringify(selectiveSource.url)}) { console.info("SELECTIVE_REFERENCE_FETCH"); return Promise.resolve(new Response(${JSON.stringify(selectiveXml)}, {headers:{"content-type":"application/xml"}})); } if (inactive.has(String(input))) throw Error("Inactive reference feed reached transport"); return Object.hasOwn(feeds, String(input)) ? Promise.resolve(new Response(feeds[String(input)], {headers:{"content-type":"application/xml"}})) : String(input).includes("fixture.folio.example") ? Promise.resolve(new Response(html, {headers:{"content-type":"text/html"}})) : original(input, init); };`);
  child = spawn(process.execPath, ["--max-old-space-size=256", "--max-semi-space-size=16", "--import", preload, join(project, "scripts/start-production.mjs")], {
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
  assert.equal((await get("/healthz", false)).status, 200);
  const idleMemory = (await (await get("/api/health")).json()).memoryBytes.rss;
  peakRss = idleMemory;
  assert.equal((await get("/api/import", false, { method: "POST" })).status, 401);
  assert.equal(JSON.parse(await readFile(join(root, "output/jobs", `${callId}.json`), "utf8")).status, "error");

  for (const path of ["/api/read", "/api/save", "/api/links", "/api/feed-catalog", "/api/collect", "/api/collect/status", "/api/agent/latest", "/api/agent/read", "/api/health", "/api/docs", "/api/openapi", "/api/docs/assets", "/api/purge"]) {
    assert.equal((await get(path, false)).status, 401, path);
  }
  assert.equal((await get("/api/feed-fetch", false, { method: "POST" })).status, 401);
  const invalid = await get(`/api/read?${new URLSearchParams({ hash, url: "http://169.254.169.254/opc/v2/instance/", format: "json" })}`, false);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  const docs = await get(`/api/docs?${new URLSearchParams({ hash })}`, false);
  assert.equal(docs.status, 200);
  const html = await docs.text();
  assert.match(html, /data:image\/png;base64/);
  assert.doesNotMatch(html, /history\.replaceState/);
  assert.equal((await get("/api/openapi")).status, 200);

  // Exercise the JSON catalog bundled into the built route, never real feeds.
  const linkResponse = await get(`/api/links?${new URLSearchParams({ hash, format: "json" })}`, false, { method: "POST" });
  assert.equal(linkResponse.status, 200);
  const linkReport = await linkResponse.json();
  assert.equal(feedCatalog.length, 10);
  assert.equal(linkReport.feedCount, feedCatalog.length);
  assert.equal(linkReport.failedFeedCount, 0);
  assert.equal(linkReport.linkCount, new Set(feedCatalog.map(({ site, section }) => JSON.stringify([site, section]))).size);
  assert.deepEqual(linkReport.websites.map((site) => site.name), [...new Set(feedCatalog.map((feed) => feed.site))]);
  for (const site of linkReport.websites) {
    assert.deepEqual(site.sections.map(({ name }) => name), [...new Set(feedCatalog.filter((feed) => feed.site === site.name).map(({ section }) => section))]);
    assert.ok(site.sections.every(({ articles }) => articles.length === 1));
  }
  assert.match(linkReport.savedFile, /\.json$/);
  assert.deepEqual(JSON.parse(await readFile(join(root, linkReport.savedFile), "utf8")), linkReport);
  assert.equal(linkReport.schemaVersion, 1);
  assert.equal("markdown" in linkReport, false);
  const getLinks = await get(`/api/links?${new URLSearchParams({ hash, section: "all" })}`, false);
  assert.equal(getLinks.status, 200);
  const getReport = await getLinks.json();
  assert.equal(getReport.feedCount, 10);
  assert.ok(getReport.websites.every(({ sections }) => sections.length === 1 && sections[0].name === "Main feed"));
  assert.ok(!logs.includes("Inactive reference feed reached transport"));
  assert.ok(!logs.includes("SELECTIVE_REFERENCE_FETCH"), "Daily endpoints fetched a reference feed");

  // New opt-in workflow, with one synthetic reference feed and no real publisher calls.
  const discoveryQuery = new URLSearchParams({ hash, publisher: "Financial Times", limit: "100" });
  discoveryQuery.append("q", "canada");
  discoveryQuery.append("q", "economy");
  const discoveryResponse = await get(`/api/feed-catalog?${discoveryQuery}`, false);
  assert.equal(discoveryResponse.status, 200);
  const discovery = await discoveryResponse.json();
  assert.equal(discovery.inventoryCount, feedInventory.length);
  assert.equal(discovery.matchMode, "OR");
  const chosen = discovery.items.find(({ section }) => section === "Canada");
  assert.ok(chosen && !chosen.isMain);
  const beforeReports = (await readdir(join(root, "output/links"))).sort();
  const selectiveResponse = await get(`/api/feed-fetch?${new URLSearchParams({ hash })}`, false, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ catalogVersion: discovery.catalogVersion, selections: [{ feedId: chosen.feedId, candidateLimit: 3 }] }),
  });
  assert.equal(selectiveResponse.status, 200);
  const selective = await selectiveResponse.json();
  assert.equal(selective.feedCount, 1);
  assert.equal(selective.candidateCount, 3);
  assert.equal(selective.failedFeedCount, 0);
  assert.equal(selective.feeds[0].section, "Canada");
  assert.ok(selective.feeds[0].candidates.every(({ title, url }) => title && url.startsWith("https://www.ft.com/content/")));
  assert.deepEqual((await readdir(join(root, "output/links"))).sort(), beforeReports, "Selective fetching created a report");
  const specification = await (await get("/api/openapi")).json();
  assert.ok(specification.paths["/api/feed-catalog"] && specification.paths["/api/feed-fetch"]);
  assert.ok(specification.paths["/api/save-batch"].post.responses["202"]);

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
  assert.ok(peakRss < 512 * 1024 ** 2, "Sampled memory exceeded Render's free service ceiling.");
  let extracted = 0;
  for (let round = 0; round < 4; round++) {
    await Promise.all(Array.from({ length: 3 }, async (_, index) => {
      const response = await get(`/api/read?${new URLSearchParams({ hash, format: "json", url: `https://fixture.folio.example/article-${round}-${index}` })}`, false);
      assert.ok([200, 429].includes(response.status));
      const result = await response.json();
      if (response.ok) { assert.ok(result.text.length > 100000); extracted++; }
    }));
    peakRss = Math.max(peakRss, (await (await get("/api/health")).json()).memoryBytes.rss);
  }
  assert.ok(extracted >= 4, "Synthetic extraction load did not exercise the parser.");
  assert.ok(peakRss < 512 * 1024 ** 2, "Extraction RSS exceeded Render's free limit.");
  const archive = join(root, "archive");
  await mkdir(join(archive, "articles", "2000-01-01_00-00"), { recursive: true });
  await writeFile(join(archive, "articles/2000-01-01_00-00/fixture.md"), "# Imported fixture\n");
  await mkdir(join(archive, "links"));
  await writeFile(join(archive, "links", linkReport.savedFile.split("/").pop()), JSON.stringify(linkReport, null, 2) + "\n");
  await writeFile(join(archive, "links/links_2000-01-01_00-00-00.md"), "# Historical link report; keep unchanged\n");
  const importer = spawn(process.execPath, [join(project, "scripts/import-output.mjs"), archive, origin], { env, stdio: "ignore" });
  assert.equal(await new Promise((resolve) => importer.once("exit", resolve)), 0);
  assert.equal(await readFile(join(root, "output/articles/2000-01-01_00-00/fixture.md"), "utf8"), "# Imported fixture\n");
  const query = new URLSearchParams({ hash });
  assert.equal((await get(`/api/purge?${query}`, false)).status, 405);
  await writeFile(join(root, "output/jobs", `${callId}.json`), JSON.stringify({ callId, status: "in progress" }));
  assert.equal((await get(`/api/purge?${query}`, false, { method: "POST" })).status, 409);
  assert.deepEqual((await readdir(join(root, "output/articles", folder))).sort(), [...articles.keys()].sort());
  const duplicate = spawn(process.execPath, ["--max-old-space-size=256", "--max-semi-space-size=16", join(project, "scripts/start-production.mjs")], { cwd: root, env, stdio: "ignore" });
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
    ...(compareDev ? [["render-dev", "http://127.0.0.1:8080/", null]] : []),
    ["render-production", `${origin}/`, compareDev ? join(project, "docs/qa/screenshots/render-dev.json") : null],
  ];
  for (const [name, url, baseline] of renders) {
    const args = [join(project, "scripts/browser-smoke.mjs"), url, join(project, `docs/qa/screenshots/${name}.png`)];
    if (baseline) args.push("--baseline", baseline);
    const smoke = spawn(process.execPath, args, { cwd: project, stdio: "inherit" });
    const code = await new Promise((resolve) => smoke.once("exit", resolve));
    assert.equal(code, 0, `${name} render check failed`);
  }
  console.info(JSON.stringify({ productionSmoke: "passed", verifiedFiles: manifest.length, verifiedChunks: chunks, syntheticExtractions: extracted, idleRssMiB: Math.round(idleMemory / 1024 ** 2), sampledPeakRssMiB: Math.round(peakRss / 1024 ** 2), storage: "disposable fixtures only" }));
} catch (error) {
  console.error(logs.replaceAll(hash, "[redacted]"));
  throw error;
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 29000);
    const exit = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    clearTimeout(timeout);
    assert.equal(exit.signal, null, "Server required forced termination instead of graceful SIGTERM shutdown.");
    assert.equal(exit.code, 0);
  }
  assert.ok(!logs.includes(hash), "Production logs exposed the access hash.");
  await rm(root, { recursive: true, force: true });
}
