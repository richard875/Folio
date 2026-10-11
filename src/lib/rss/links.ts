import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Parser from "rss-parser";
import { parseFeedCatalog, type Feed } from "./catalog.ts";

const parser = new Parser();
const USER_AGENT = "Mozilla/5.0 (compatible; FolioRSS/1.0)";

export type FeedResult = Feed & { urls: string[]; ok: boolean };
export type FetchOptions = {
  fetchImpl?: typeof fetch;
  retryLimit?: number;
  timeoutMs?: number;
  limit?: number;
  concurrency?: number;
  onProgress?: (result: FeedResult, index: number) => void;
};
export type SaveLinksOptions = {
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<unknown>;
  limit?: number;
};

export function configuredRetryLimit(value: string | undefined): number {
  if (!value?.trim() || !/^\d+$/.test(value.trim())) return 5;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 5;
}

export function configuredLinkLimit(value: string | undefined): number {
  const number = configuredRetryLimit(value);
  return number > 0 ? number : 5;
}

export async function parseArticleLinks(
  xml: string,
  feedUrl: string,
  limit = 5,
): Promise<string[]> {
  const feed = await parser.parseString(xml);
  const urls = new Set<string>();
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
  feed: Feed,
  { fetchImpl = fetch, retryLimit = 5, timeoutMs = 15000, limit = 5 }: FetchOptions = {},
): Promise<FeedResult> {
  for (let attempt = 0; ; attempt++) {
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

export async function collectFeeds(
  feeds: Feed[],
  options: FetchOptions = {},
): Promise<FeedResult[]> {
  const results = new Array<FeedResult>(feeds.length);
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
  const sections = new Map<string, Set<string>>();
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

function heading(text: string): string {
  return text.replace(/[\r\n]/g, " ").replace(/[\\`*_[\]<>#]/g, "\\$&");
}

export function renderLinksMarkdown(
  results: FeedResult[],
  generatedAt = new Date(),
  limit = 5,
): string {
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

export function linksFilename(date: Date): string {
  return `links_${date.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-")}.md`;
}

export async function saveLinks(
  results: FeedResult[],
  outputDir: string,
  { now = () => new Date(), wait = sleep, limit = 5 }: SaveLinksOptions = {},
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  for (;;) {
    const generatedAt = now();
    const path = resolve(outputDir, linksFilename(generatedAt));
    try {
      await writeFile(path, renderLinksMarkdown(results, generatedAt, limit), { flag: "wx" });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Two runs in the same second must not overwrite each other's output.
      await wait(1000);
    }
  }
}

export async function generateLinks(
  research: string,
  options: FetchOptions & { outputDir?: string } = {},
) {
  const limit = options.limit ?? configuredLinkLimit(process.env.RSS_LINKS_PER_SECTION);
  const retryLimit = options.retryLimit ?? configuredRetryLimit(process.env.FETCH_RETRY_LIMIT);
  const feeds = parseFeedCatalog(research);
  if (!feeds.length) throw new Error("No feed URLs found in the research file.");
  const results = await collectFeeds(feeds, { ...options, limit, retryLimit });
  const outputDir = options.outputDir ?? resolve(process.cwd(), "output/links");
  const path = await saveLinks(results, outputDir, { limit });
  const markdown = await readFile(path, "utf8");
  const failures = results.filter((result) => !result.ok).length;
  return {
    savedFile: `output/links/${basename(path)}`,
    limit,
    feedCount: feeds.length,
    failedFeedCount: failures,
    linkCount: results.reduce((count, result) => count + result.urls.length, 0),
    markdown,
    websites: [...new Set(results.map((result) => result.site))].map((name) => {
      const siteResults = results.filter((result) => result.site === name);
      return {
        name,
        sections: [...new Set(siteResults.map((result) => result.section))].map((section) => {
          const group = siteResults.filter((result) => result.section === section);
          return {
            name: section,
            links: group.flatMap((result) => result.urls),
            available: group.every((result) => result.ok),
          };
        }),
      };
    }),
  };
}
