import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  collectFeeds,
  configuredLinkLimit,
  configuredRetryLimit,
  fetchFeed,
  linksFilename,
  parseArticleLinks,
  renderLinksMarkdown,
  saveLinks,
} from "./fetch-links.mjs";
import { parseFeedCatalog } from "./rss-feed-catalog.mjs";

const execFileAsync = promisify(execFile);
const feed = { site: "Example News", section: "World", url: "https://example.com/rss" };
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><link>https://example.com</link><description>News</description>
<item><title>First</title><link>https://example.com/story?a=1&amp;b=2</link></item>
<item><title>Duplicate</title><link>https://example.com/story?a=1&amp;b=2#fragment</link></item>
<item><title>Relative</title><link>/other</link></item>
<item><title>Unsafe</title><link>javascript:alert(1)</link></item>
<item><title>Credentials</title><link>https://user:pass@example.com/private</link></item>
<item><title>Only ID</title><guid isPermaLink="false">internal-id</guid></item>
</channel></rss>`;

test("catalog includes all twelve websites and expands concrete shorthand", async () => {
  const source = await readFile(
    new URL("../attachments/News site RSS feeds by section.md", import.meta.url),
    "utf8",
  );
  const feeds = parseFeedCatalog(source);
  assert.equal(new Set(feeds.map((item) => item.site)).size, 12);
  const urls = new Set(feeds.map((item) => item.url));
  for (const url of [
    "https://rss.nytimes.com/services/xml/rss/nyt/Books/Review.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/FashionandStyle.xml",
    "https://thehill.com/business/economy/feed/",
    "https://thehill.com/business/trade/feed/",
    "https://api.axios.com/feed/audience/denver",
    "https://feeds.washingtonpost.com/rss/world/europe",
    "https://www.ft.com/artificial-intelligence?format=rss",
    "https://www.nytimes.com/athletic/rss/nfl/",
  ])
    assert.ok(urls.has(url), url);
  assert.ok(feeds.some((item) => item.section === "Make It" && item.site === "CNBC"));
  assert.ok(feeds.every((item) => !/[<>]|\.\.\./.test(item.url)));
  assert.ok(feeds.every((item) => !/feeder\.co|feedspot\.com/.test(item.url)));
  assert.ok(feeds.every((item) => item.site !== "At a glance" && item.site !== "Sources"));
  assert.equal(new Set(feeds.map((item) => `${item.site}:${item.url}`)).size, feeds.length);
});

test("catalog ignores dead/prose links and supports CRLF and escaped table pipes", () => {
  const feeds = parseFeedCatalog(
    "## Test\r\nDead: `https://old.example.com/feed`\r\n| Section | URL |\r\n| --- | --- |\r\n| Main | `https://example.com/feed` |\r\n| Categories | `https://example.com/<one\\|two>/feed` |\r\n",
  );
  assert.deepEqual(
    feeds.map((item) => item.url),
    ["https://example.com/feed", "https://example.com/one/feed", "https://example.com/two/feed"],
  );
});

test("extracts and deduplicates RSS article links, not IDs or unsafe URLs", async () => {
  assert.deepEqual(await parseArticleLinks(rss, feed.url), [
    "https://example.com/story?a=1&b=2",
    "https://example.com/other",
  ]);
});

test("supports Atom feeds and preserves Google News article URLs", async () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><id>news</id><updated>2026-10-11T00:00:00Z</updated><entry><title>Article</title><id>article</id><link rel="alternate" href="https://news.google.com/rss/articles/example"/></entry></feed>`;
  assert.deepEqual(await parseArticleLinks(atom, feed.url), [
    "https://news.google.com/rss/articles/example",
  ]);
});

test("defaults to five unique links per feed and supports a custom limit", async () => {
  const xml = `<rss version="2.0"><channel><title>News</title>${Array.from(
    { length: 8 },
    (_, index) =>
      `<item><link>https://example.com/story-${index}</link></item><item><link>https://example.com/story-${index}#duplicate</link></item>`,
  ).join("")}</channel></rss>`;
  const defaults = await parseArticleLinks(xml, feed.url);
  assert.equal(defaults.length, 5);
  assert.equal(defaults[4], "https://example.com/story-4");
  assert.equal((await parseArticleLinks(xml, feed.url, 2)).length, 2);
  assert.equal(
    (await fetchFeed(feed, { limit: 7, fetchImpl: async () => new Response(xml) })).urls.length,
    7,
  );
});

test("the cap is shared across feeds in a subsection and enforced in Markdown", async () => {
  const results = await collectFeeds([feed, { ...feed, url: "https://example.com/second-feed" }], {
    limit: 3,
    fetchImpl: async (url) =>
      new Response(
        `<rss version="2.0"><channel><title>News</title>${Array.from(
          { length: 5 },
          (_, index) => `<item><link>${url}/story-${index}</link></item>`,
        ).join("")}</channel></rss>`,
      ),
  });
  assert.equal(
    results.reduce((sum, result) => sum + result.urls.length, 0),
    3,
  );
  const rawResults = [
    {
      ...feed,
      ok: true,
      urls: Array.from({ length: 8 }, (_, index) => `https://example.com/story-${index}`),
    },
    { ...feed, ok: true, urls: ["https://example.com/extra"] },
  ];
  assert.equal((renderLinksMarkdown(rawResults).match(/^- </gm) || []).length, 5);
  assert.equal((renderLinksMarkdown(rawResults, new Date(), 7).match(/^- </gm) || []).length, 7);
});

test("rejects HTML instead of treating it as an empty feed", async () => {
  await assert.rejects(parseArticleLinks("<html><body>Access denied</body></html>", feed.url));
});

test("retry setting defaults to 5 and accepts zero", () => {
  for (const value of [undefined, "", "-1", "1.5", "invalid", "9007199254740992"])
    assert.equal(configuredRetryLimit(value), 5);
  assert.equal(configuredRetryLimit("0"), 0);
  assert.equal(configuredRetryLimit(" 2 "), 2);
});

test("link limit environment setting defaults to 5 and accepts positive integers", () => {
  for (const value of [undefined, "", "0", "-1", "1.5", "invalid", "9007199254740992"]) {
    assert.equal(configuredLinkLimit(value), 5);
  }
  assert.equal(configuredLinkLimit(" 10 "), 10);
  assert.equal(configuredLinkLimit("1"), 1);
});

test("retries a failed request, stopping on success", async () => {
  let calls = 0;
  const result = await fetchFeed(feed, {
    retryLimit: 2,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return new Response("Unavailable", { status: 503 });
      return new Response(rss);
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.urls.length, 2);
});

test("failed feeds do not abort other feeds and completion order is stable", async () => {
  let active = 0;
  let maximum = 0;
  const feeds = Array.from({ length: 5 }, (_, index) => ({
    ...feed,
    section: `${index}`,
    url: `https://example.com/${index}`,
  }));
  const results = await collectFeeds(feeds, {
    concurrency: 2,
    retryLimit: 0,
    fetchImpl: async (url) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((done) => setTimeout(done, url.endsWith("0") ? 15 : 1));
      active--;
      if (url.endsWith("1")) throw new Error("internal request details");
      return new Response(rss);
    },
  });
  assert.equal(maximum, 2);
  assert.deepEqual(
    results.map((item) => item.section),
    ["0", "1", "2", "3", "4"],
  );
  assert.equal(results[1].ok, false);
  assert.equal(results.filter((item) => item.ok).length, 4);
});

test("Markdown groups sites and sections without request metadata", () => {
  const markdown = renderLinksMarkdown(
    [
      { ...feed, urls: ["https://example.com/story"], ok: true },
      { ...feed, urls: ["https://example.com/story", "https://example.com/second"], ok: true },
      { ...feed, section: "Tech", urls: [], ok: false },
      { ...feed, site: "Other", urls: [], ok: true },
    ],
    new Date("2026-10-11T12:34:56Z"),
  );
  assert.match(markdown, /^# Example News$/m);
  assert.match(markdown, /^## World$/m);
  assert.match(markdown, /^## Tech$/m);
  assert.match(markdown, /^# Other$/m);
  assert.equal(markdown.match(/<https:\/\/example.com\/story>/g).length, 1);
  assert.match(markdown, /Some feeds were unavailable/);
  assert.match(markdown, /No article links available/);
  assert.doesNotMatch(markdown, /method|bypass|internal request|https:\/\/example.com\/rss/i);
});

test("timestamped output never overwrites an existing run", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "folio-links-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const results = [{ ...feed, urls: ["https://example.com/story"], ok: true }];
  let current = new Date("2026-10-11T12:34:56Z");
  assert.equal(linksFilename(current), "links_2026-10-11_12-34-56.md");
  const first = await saveLinks(results, dir, { now: () => current });
  const original = await readFile(first, "utf8");
  const second = await saveLinks(results, dir, {
    now: () => current,
    wait: async () => {
      current = new Date(current.getTime() + 1000);
    },
  });
  assert.notEqual(first, second);
  assert.equal(await readFile(first, "utf8"), original);
  assert.equal((await readdir(dir)).length, 2);
});

test("CLI fetches feeds and generates a file; timeouts and all-failed runs exit cleanly", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "folio-links-cli-"));
  const server = createServer((request, response) => {
    if (request.url === "/slow") return;
    response.writeHead(200, { "content-type": "application/rss+xml" });
    response.end(rss);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const input = join(dir, "feeds.md");
  const output = join(dir, "links");
  await writeFile(
    input,
    `## Local News\n| Section | Feed |\n| --- | --- |\n| World | \`${origin}/rss\` |\n| Tech | \`${origin}/slow\` |\n`,
  );
  const script = fileURLToPath(new URL("./fetch-links.mjs", import.meta.url));
  const args = [
    script,
    "--input",
    input,
    "--output-dir",
    output,
    "--retry-limit",
    "0",
    "--timeout-ms",
    "100",
  ];
  const result = await execFileAsync(process.execPath, args);
  assert.match(result.stdout, /Saved 2 section links/);
  assert.match(result.stderr, /1 feeds were unavailable/);
  const files = await readdir(output);
  assert.equal(files.length, 1);
  assert.match(files[0], /^links_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/);
  assert.match(await readFile(join(output, files[0]), "utf8"), /# Local News/);
  const envOutput = join(dir, "env-links");
  const envArgs = [...args, "--output-dir", envOutput];
  const envOptions = { env: { ...process.env, RSS_LINKS_PER_SECTION: "1" } };
  const envRun = await execFileAsync(process.execPath, envArgs, envOptions);
  assert.match(envRun.stdout, /Saved 1 section links/);
  const overrideRun = await execFileAsync(
    process.execPath,
    [...envArgs, "--limit", "2"],
    envOptions,
  );
  assert.match(overrideRun.stdout, /Saved 2 section links/);
  await writeFile(
    input,
    `## Local News\n| Section | Feed |\n| --- | --- |\n| Tech | \`${origin}/slow\` |\n`,
  );
  await assert.rejects(execFileAsync(process.execPath, args), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /Saved 0 section links/);
    return true;
  });
  assert.equal((await readdir(output)).length, 2);
});
