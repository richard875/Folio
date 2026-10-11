#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import Parser from "rss-parser";
import { parseFeedCatalog } from "./rss-feed-catalog.mjs";
import { isMainModule } from "./with-app-env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parser = new Parser();
const USER_AGENT = "Mozilla/5.0 (compatible; FolioRSS/1.0)";

export function configuredRetryLimit(value) {
  if (!value?.trim() || !/^\d+$/.test(value.trim())) return 5;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 5;
}

export function configuredLinkLimit(value) {
  const number = configuredRetryLimit(value);
  return number > 0 ? number : 5;
}

export async function parseArticleLinks(xml, feedUrl, limit = 5) {
  const feed = await parser.parseString(xml);
  const urls = new Set();
  for (const item of feed.items || []) {
    // GUIDs are identifiers, not necessarily article URLs.
    if (!item.link?.trim()) continue;
    try {
      const url = new URL(item.link.trim(), feedUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
      url.hash = "";
      urls.add(url.href);
      if (urls.size >= limit) break;
    } catch {
      /* Ignore invalid article links. */
    }
  }
  return [...urls];
}

export async function fetchFeed(
  feed,
  { fetchImpl = fetch, retryLimit = 5, timeoutMs = 15000, limit = 5 } = {},
) {
  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    try {
      const response = await fetchImpl(feed.url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      return {
        ...feed,
        urls: await parseArticleLinks(await response.text(), response.url || feed.url, limit),
        ok: true,
      };
    } catch {
      if (attempt === retryLimit) return { ...feed, urls: [], ok: false };
      await sleep(Math.min(250 * 2 ** attempt, 2000));
    }
  }
}

export async function collectFeeds(feeds, options = {}) {
  const results = new Array(feeds.length);
  let next = 0;
  const concurrency = options.concurrency ?? 6;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, feeds.length) }, async () => {
      while (next < feeds.length) {
        const index = next++;
        results[index] = await fetchFeed(feeds[index], options);
        options.onProgress?.(results[index], index);
      }
    }),
  );
  // Enforce the cap across feeds sharing a subsection, not just per feed.
  const sections = new Map();
  return results.map((result) => {
    const key = JSON.stringify([result.site, result.section]);
    const seen = sections.get(key) || new Set();
    sections.set(key, seen);
    const urls = result.urls.filter((url) => {
      if (seen.has(url) || seen.size >= (options.limit ?? 5)) return false;
      seen.add(url);
      return true;
    });
    return { ...result, urls };
  });
}

function heading(text) {
  return text.replace(/[\r\n]/g, " ").replace(/[\\`*_[\]<>#]/g, "\\$&");
}

export function renderLinksMarkdown(results, generatedAt = new Date(), limit = 5) {
  const lines = [`Generated: ${generatedAt.toISOString()} (UTC)`, ""];
  for (const site of new Set(results.map((result) => result.site))) {
    lines.push(`# ${heading(site)}`, "");
    const sections = results.filter((result) => result.site === site);
    for (const section of new Set(sections.map((result) => result.section))) {
      lines.push(`## ${heading(section)}`, "");
      const group = sections.filter((result) => result.section === section);
      const urls = [...new Set(group.flatMap((result) => result.urls))].slice(0, limit);
      for (const url of urls) lines.push(`- <${url.replace(/</g, "%3C").replace(/>/g, "%3E")}>`);
      if (group.some((result) => !result.ok))
        lines.push("", "Some feeds were unavailable during this run.");
      if (!urls.length && group.every((result) => result.ok))
        lines.push("No article links available in this feed.");
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function linksFilename(date) {
  return `links_${date.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-")}.md`;
}

export async function saveLinks(
  results,
  outputDir,
  { now = () => new Date(), wait = sleep, limit = 5 } = {},
) {
  await mkdir(outputDir, { recursive: true });
  for (;;) {
    const generatedAt = now();
    const path = resolve(outputDir, linksFilename(generatedAt));
    try {
      await writeFile(path, renderLinksMarkdown(results, generatedAt, limit), { flag: "wx" });
      return path;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Two runs in the same second must not overwrite each other's output.
      await wait(1000);
    }
  }
}

function parseArgs(args) {
  const options = {
    input: resolve(ROOT, "attachments/News site RSS feeds by section.md"),
    outputDir: resolve(ROOT, "output/links"),
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") return { help: true };
    if (
      !["--input", "--output-dir", "--retry-limit", "--timeout-ms", "--limit"].includes(arg) ||
      !args[index + 1]
    )
      throw new Error(`Invalid option: ${arg}`);
    const value = args[++index];
    if (arg === "--input") options.input = resolve(value);
    if (arg === "--output-dir") options.outputDir = resolve(value);
    if (arg === "--retry-limit" || arg === "--timeout-ms" || arg === "--limit") {
      const number = Number(value);
      if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(number) ||
        (arg === "--limit" && number < 1) ||
        (arg === "--timeout-ms" && (number < 1 || number > 2147483647))
      )
        throw new Error(`Invalid value for ${arg}`);
      options[arg === "--retry-limit" ? "retryLimit" : arg === "--limit" ? "limit" : "timeoutMs"] =
        number;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: npm run fetch:links -- [--input file.md] [--output-dir directory] [--limit 5] [--retry-limit 5] [--timeout-ms 15000]",
    );
    return;
  }
  try {
    loadEnvFile(resolve(ROOT, ".env"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  options.retryLimit ??= configuredRetryLimit(process.env.FETCH_RETRY_LIMIT);
  options.limit ??= configuredLinkLimit(process.env.RSS_LINKS_PER_SECTION);
  const feeds = parseFeedCatalog(await readFile(options.input, "utf8"));
  if (!feeds.length) throw new Error("No feed URLs found in the research file.");
  console.log(
    `Fetching ${feeds.length} feeds across ${new Set(feeds.map((feed) => feed.site)).size} websites…`,
  );
  let completed = 0;
  const results = await collectFeeds(feeds, {
    ...options,
    onProgress: (result) => {
      console.log(
        `[${++completed}/${feeds.length}] ${result.site} / ${result.section}: ${result.ok ? `${result.urls.length} links` : "unavailable"}`,
      );
    },
  });
  const path = await saveLinks(results, options.outputDir, { limit: options.limit });
  const failures = results.filter((result) => !result.ok).length;
  console.log(
    `Saved ${results.reduce((count, result) => count + result.urls.length, 0)} section links to ${path}`,
  );
  if (failures)
    console.warn(`${failures} feeds were unavailable; the other results have been saved.`);
  if (failures === results.length) process.exitCode = 1;
}

if (isMainModule(import.meta.url))
  main().catch((error) => {
    console.error(`Could not generate article links: ${error.message}`);
    process.exitCode = 1;
  });
