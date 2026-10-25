import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseLinksReport } from "../src/lib/rss/report.ts";
import { feedInventory, mainFeeds, publisherCatalogs } from "../src/lib/rss/sources.ts";

const root = new URL("../", import.meta.url);
const guides = [
  "README.md", "REFERENCE.md", "AGENTS.md", "CLAUDE.md", "deployment.md", ".claude/README.md",
  "data/README.md", "docs/README.md", "reader/README.md", "reader/AI-GUIDE.md",
  "scripts/fetch-links.md", "scripts/feed-selection.md", "scripts/collect-articles.md",
  "scripts/save-articles.md", "scripts/agent-reader.md", "scripts/swagger.md",
  "docs/skills/universal-article-reader/SKILL.md",
  "docs/prompts/daily-news-brief.md",
  "scripts/selective-feeds.md", "docs/skills/folio-news/SKILL.md",
  "docs/skills/folio-news/README.md", "docs/skills/folio-news/references/api.md",
  "docs/skills/folio-news/references/workflows.md",
  ".claude/skills/_INDEX.md", ".claude/references/_INDEX.md",
  ".claude/references/browser-qa.md", ".claude/references/deploy-target.md",
  ".claude/references/hibernate-revive.md", ".claude/references/data-and-auth.md",
  ".claude/references/generated-art.md", ".claude/references/scaffold.md",
];
const readGuide = (path) => readFile(new URL(path, root), "utf8");

test("current implementation guides have resolvable local Markdown links", async () => {
  // Historical handovers, research and private output are not
  // current guidance and must not be rewritten to satisfy this contract.
  for (const path of guides) {
    const document = new URL(path, root);
    for (const match of (await readGuide(path)).matchAll(/\]\(([^)]+)\)/g)) {
      const target = new URL(match[1], document);
      if (target.protocol !== "file:") continue;
      target.hash = "";
      await access(target);
    }
  }
});

test("current documentation distinguishes publisher inventories from ten active main feeds", async () => {
  for (const path of guides) {
    const text = (await readGuide(path)).replace(/\s+/g, " ");
    assert.doesNotMatch(text, /data\/feeds\.json|All 599 feeds are requested|All 599 feeds are fetched|up to 599 entries|at most 599 entries/i, path);
    for (const match of text.replace(/[*`]/g, "").matchAll(/other (\d+) (?:stored )?(?:feed )?(?:entries|reference feeds|are reference-only)/g)) {
      assert.equal(Number(match[1]), feedInventory.length - mainFeeds.length, `${path}: reference-only count`);
    }
  }
  for (const path of ["README.md", "REFERENCE.md", "data/README.md", "scripts/fetch-links.md", "scripts/collect-articles.md",
    "scripts/swagger.md", "deployment.md", "docs/prompts/daily-news-brief.md", "docs/skills/universal-article-reader/SKILL.md"]) {
    const text = (await readGuide(path)).replace(/[*`]/g, "").replace(/\s+/g, " ");
    assert.match(text, /ten (?:publisher )?Main feeds?/i, path);
    assert.match(text, /reference/i, path);
  }
  const catalogGuide = await readGuide("data/README.md");
  for (const { site, file, entries } of publisherCatalogs)
    assert.ok(catalogGuide.includes(`| ${site} | [${file}](${file}) | ${entries.length} | 1 |`), file);
  assert.equal(mainFeeds.length, 10);
  assert.match(catalogGuide, /duplicate Main feeds are always rejected/i);
});

test("documented link-report JSON example validates against the real storage schema", async () => {
  const guide = await readGuide("scripts/fetch-links.md");
  const example = /```json\s*\n([\s\S]*?)\n```/.exec(guide)?.[1];
  assert.ok(example, "Missing report example");
  const report = parseLinksReport(example);
  assert.equal(report.schemaVersion, 1);
  assert.match(report.savedFile, /\.json$/);
  assert.deepEqual(report.websites[0].sections[0].articles, [
    { url: "https://example.com/story", summary: "Optional feed-provided excerpt." },
  ]);
  assert.equal("markdown" in report, false);
});

test("daily briefing prompt covers selective saving and job-bound verified reading", async () => {
  const prompt = await readGuide("docs/prompts/daily-news-brief.md");
  for (const fact of [
    "/api/links", "/api/save-batch?hash=", "/api/save-batch/status?callId=",
    "/api/agent/latest", "nextManifestUrl", "snapshotId", "collections[]",
    "savedFile", "endOfArticle=true", "UTF-8 byte count", "SHA-256",
    "save times", "untrusted data", "Retry-After", "FOLIO_ACCESS_HASH",
    "72-hour", "168 hours", "at most 24 polls", "selected job's saved files",
  ]) assert.ok(prompt.replace(/\s+/g, " ").includes(fact), `Prompt missing ${fact}`);
  const example = /```json\s*\n([\s\S]*?)\n```/.exec(prompt)?.[1];
  assert.ok(example, "Missing save-batch request example");
  const body = JSON.parse(example);
  assert.equal(body.format, "markdown");
  assert.ok(body.urls.length >= 1 && body.urls.length <= 100);
  assert.ok(body.urls.every((item) => new URL(item.url).protocol === "https:" && !item.callId));
  assert.match(prompt, /Reject redirects/);
  assert.match(prompt, /key in chat/);
});

test("scheduled briefing prompt specifies two Sydney cloud tasks and a self-contained bounded run", async () => {
  const prompt = await readGuide("docs/prompts/daily-news-brief.md");
  const [setup, run] = prompt.split("## Part B — Self-contained recurring execution prompt");
  assert.ok(setup && run, "Separate setup instructions from recurring execution");
  const normalizedSetup = setup.replace(/[*`]/g, "").replace(/\s+/g, " ");
  const normalizedRun = run.replace(/[*`]/g, "").replace(/\s+/g, " ");
  for (const fact of ["Folio — Morning Brief", "04:00 (4am)", "Folio — Afternoon Brief", "14:00 (2pm)", "Australia/Sydney", "including weekends", "no end date", "powered off", "approved secure credential mechanism", "native confirmation", "next run times"])
    assert.ok(normalizedSetup.includes(fact), `Setup missing ${fact}`);
  assert.match(normalizedSetup, /do not use a fixed UTC offset/);
  assert.match(normalizedSetup, /do not create|instead of creating duplicates/i);
  assert.match(normalizedSetup, /Part A is setup-only/);
  assert.match(normalizedSetup, /Editing this file alone creates no tasks/);
  assert.match(normalizedRun, /do not create, edit, duplicate or reschedule tasks/);
  for (const fact of ["Australia/Sydney", "RSS_LINKS_PER_SECTION=10", "SAVE_CONCURRENCY=1", "READ_CONCURRENCY=1", "up to 100 candidates per run", "at most 5 hours", "5-hour total run cap", "240 polls", "15 seconds", "60 minutes elapsed since batch submission", "previous successful briefing", "prior cloud history was unavailable"])
    assert.ok(normalizedRun.toLowerCase().includes(fact.toLowerCase()), `Run missing ${fact}`);
  assert.match(normalizedRun, /not a fixed daily total/);
  assert.match(normalizedRun, /These are server settings, not API query options/);
  assert.match(normalizedRun, /never create another schedule/);
  assert.match(normalizedRun, /No local|no local/i);
  const ranking = /### Editorial priorities[^\n]*\n([\s\S]*?)\nTreat overlapping categories/.exec(run)?.[1];
  assert.ok(ranking, "Missing fixed editorial ranking");
  const items = [...ranking.matchAll(/^(\d+)\. (.+)$/gm)];
  assert.deepEqual(items.map(match => Number(match[1])), Array.from({ length: 13 }, (_, index) => index + 1));
  assert.deepEqual(items.map(match => match[2]), [
    "US News", "US Business News", "US Politics", "US Economy", "US Markets and Finance",
    "World News", "Economy for the following countries: UK, Canada, Australia, Western Europe",
    "Economy for the rest of the world", "General Opinion Sections", "Tech", "US Sports",
    "World Sports", "Anything else (like lifestyle, personal finance, misc...)",
  ]);
  assert.match(normalizedRun, /Do not impose category quotas/);
  assert.match(normalizedRun, /does not change that server setting/);
  assert.match(normalizedRun, /Save every distinct eligible candidate URL, up to 100 articles in one batch/);
  assert.match(normalizedRun, /93 distinct eligible URLs means submit all 93 for saving/);
  assert.match(normalizedRun, /that story count does not limit articles saved or read/);
  assert.match(normalizedRun, /order the batch, so higher-priority reporting is attempted first/);
  assert.match(normalizedRun, /keep different publishers' articles about the same event/);
  assert.match(normalizedRun, /Do not shrink the save set merely to fit a short briefing/);
  assert.doesNotMatch(normalizedRun, /10[–-]15 distinct article|maximum 15|at most 15|capped at 15|at most (?:30|90) minutes|90-minute total|at most 60 polls/);
});

test("scheduled briefing prompt uploads one correctly named Markdown document to Telegram", async () => {
  const prompt = await readGuide("docs/prompts/daily-news-brief.md");
  const [setup, run] = prompt.split("## Part B — Self-contained recurring execution prompt");
  const delivery = run.split("### 7. Create and send the Markdown file to Telegram")[1]
    ?.split("### Begin this scheduled invocation")[0];
  assert.ok(delivery, "Missing self-contained file creation and delivery instructions");
  const normalized = delivery.replace(/[*`]/g, "").replace(/\s+/g, " ");
  for (const fact of [
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "multipart/form-data", "text/markdown; charset=utf-8",
    "Folio Brief <YYYY> <MMM> <DD> <Morning|Afternoon>.md",
    "Folio Brief 2026 Oct 25 Morning.md", "Folio Brief 2026 Oct 25 Afternoon.md",
    "Australia/Sydney calendar date", "actual run-start date in Sydney", "English three-letter month",
    "two-digit day", "intended scheduled slot", "never the completion clock",
    "result.message_id", "result.chat.id", "result.document.file_name", "result.document.file_size",
    "delivery uncertain", "delivery failed", "delivery blocked", "do not retry automatically",
  ]) assert.ok(normalized.includes(fact), `Delivery missing ${fact}`);
  assert.match(normalized, /POST https:\/\/api\.telegram\.org\/bot<TELEGRAM_BOT_TOKEN>\/sendDocument/);
  assert.match(normalized, /only one \.md document per run, with no caption/);
  assert.match(normalized, /Omit caption, parse_mode/);
  assert.match(normalized, /Do not call sendMessage/);
  assert.match(normalized, /Upload the finalized file's exact bytes/);
  assert.match(normalized, /Reject redirects/);
  assert.match(normalized, /successful delivery receipt.*do not upload it again/);
  assert.match(normalized, /never fall back to a Telegram text message/);
  assert.match(normalized, /same file format with an honest status report/);
  assert.match(normalized, /Keep the briefing's.*run status separate from its delivery status/);
  assert.match(setup, /Do not send any Telegram test or setup message unless I explicitly request one/);
  assert.match(run, /Earlier\s+instructions to stop retrieval do not skip this final file\/status handling/);
  assert.doesNotMatch(prompt, /https:\/\/api\.telegram\.org\/bot\d+:[A-Za-z0-9_-]+/);
  assert.ok(prompt.includes("https://core.telegram.org/bots/api#senddocument"));
});

test("current guides do not reinstate obsolete Markdown link-report contracts", async () => {
  for (const path of guides) {
    const text = (await readGuide(path)).replace(/\s+/g, " ");
    assert.doesNotMatch(text, /link-report storage has not|this migration changes only the feed catalog|original website\/section headings/i, path);
    assert.doesNotMatch(text, /links_YYYY-MM-DD_HH-mm-ss\.md|Reports remain Markdown even with/i, path);
  }
  const catalogGuide = await readGuide("data/README.md");
  assert.match(catalogGuide, /versioned JSON/);
  for (const path of ["scripts/fetch-links.md", "deployment.md"]) {
    const text = (await readGuide(path)).replace(/\s+/g, " ");
    assert.match(text, /warns and skips/);
    assert.match(text, /savedFile/);
  }
});

test("summary policy is documented consistently for all three publisher exceptions", async () => {
  for (const path of ["REFERENCE.md", "scripts/fetch-links.md", "scripts/feed-selection.md", "docs/skills/universal-article-reader/SKILL.md"]) {
    const text = await readGuide(path);
    for (const fact of ["Bloomberg", "Business Insider", "Reuters", "news:title", "description", "1,000"]) {
      assert.ok(text.includes(fact), `${path}: missing ${fact}`);
    }
  }
});

test("interactive guide and portable skill describe actual separate query-hash workflows", async () => {
  const guide = await readGuide("scripts/selective-feeds.md");
  for (const fact of ["/api/feed-catalog", "q=canada&q=economy", "OR", "catalogVersion", "candidateLimit", "1–8", "16,384", "sitemap", "JSON Feed", "no report", "hash"])
    assert.ok(guide.toLowerCase().includes(fact.toLowerCase()), fact);
  const skill = await readGuide("docs/skills/folio-news/SKILL.md");
  assert.match(skill, /^---\nname: folio-news\ndescription:/);
  assert.match(skill, /does \*\*not\*\* grant HTTP access/);
  assert.match(skill, /OR/);
  const api = await readGuide("docs/skills/folio-news/references/api.md");
  assert.ok(api.includes("hash") && api.includes("202") && api.includes("catalogVersion"));
  for (const fact of ["72 hours", "168 hours", "ceiling", "Never invent", "partial-week coverage"])
    assert.ok(api.includes(fact), `Portable skill missing ${fact}`);
  const prompt = await readGuide("docs/prompts/daily-news-brief.md");
  assert.ok(prompt.includes("Do not use `/api/feed-catalog` or `/api/feed-fetch`"));
  assert.doesNotMatch(prompt, /Authorization: Bearer/);
});

test("Claude skills describe corrected catalog identities, locale scope and pinned reading", async () => {
  const portable = await readGuide("docs/skills/folio-news/SKILL.md");
  const api = await readGuide("docs/skills/folio-news/references/api.md");
  const workflows = await readGuide("docs/skills/folio-news/references/workflows.md");
  const reader = await readGuide("docs/skills/universal-article-reader/SKILL.md");
  for (const [path, text] of [["portable skill", portable], ["API reference", api], ["reader skill", reader]]) {
    assert.ok(text.replace(/\s+/g, " ").includes("not country-topic filters"), `${path}: locale caveat`);
  }
  assert.match(api, /final index URL/);
  assert.match(api, /duplicate article URLs retain their first occurrence/);
  assert.match(api, /16,384 bytes/);
  assert.match(api, /not an additional request-wide allowance/);
  assert.match(portable, /even if a newer folder becomes latest/);
  assert.match(workflows.replace(/\s+/g, " "), /newer folder becomes latest/);
  assert.match(reader, /collections\[\]/);
  assert.match(reader, /no separate legacy parser branch/);
  assert.doesNotMatch(reader, /inactive native JSON\s+branch|Request the current key privately/);
});

test("briefing and reading guidance separates retrieval quality, provenance and upstream failures", async () => {
  for (const path of [
    "docs/prompts/daily-news-brief.md",
    "docs/skills/folio-news/references/workflows.md",
    "docs/skills/universal-article-reader/SKILL.md",
  ]) {
    const text = (await readGuide(path)).replace(/[*`]/g, "").replace(/\s+/g, " ");
    for (const fact of ["Jina Markdown", "partial=false", "checksums", "original publisher URLs", "sourceUrl", "request-level Folio 401"])
      assert.ok(text.includes(fact), `${path}: missing ${fact}`);
    assert.match(text, /snapshot dates are not publication dates/i, path);
    assert.match(text, /substantive reporting/i, path);
    assert.match(text, /upstream/i, path);
  }
  const portable = await readGuide("docs/skills/folio-news/SKILL.md");
  assert.match(portable, /references\/workflows\.md#saved-text-quality-and-retrieval-failures/);
  const api = await readGuide("docs/skills/folio-news/references/api.md");
  assert.match(api, /workflow is unchanged/);
  assert.match(api, /Request-level Folio 401/);
  const evals = JSON.parse(await readGuide("docs/skills/folio-news/evals/evals.json"));
  assert.equal(evals.evals.length, 4);
  assert.equal(new Set(evals.evals.map(item => item.id)).size, 4);
  const qualityEval = evals.evals.find(item => item.id === 4);
  for (const fact of ["archive picker", "Jina Markdown", "partial=false", "upstream 403"])
    assert.ok(qualityEval.prompt.includes(fact), `Missing quality scenario: ${fact}`);
});
