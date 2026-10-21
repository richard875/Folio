import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { selectMainFeeds, type Feed } from "./catalog.ts";
import { articleUrl, parseCandidates, parseFeedDocument, rankCandidates, UnsupportedFeedError, type Candidate, type FeedDocumentFormat } from "./selection.ts";
import { isGoogleNewsArticle, resolveGoogleNewsUrl } from "./google-news.ts";
import { boundedBytes, publicFetch, publicFetchRedirects } from "../runtime/network.ts";
import { writeNewFile } from "../runtime/storage.ts";
import { boundedInteger } from "../runtime/limits.ts";
import { parseLinksReport, linksReportSchema, type LinksReport } from "./report.ts";
import { feedSummary } from "./summary.ts";

const USER_AGENT = "Mozilla/5.0 (compatible; FolioRSS/1.0)";

export type FeedArticle = { url: string; summary?: string };
export type FeedResult = Feed & {
  urls: string[];
  articles?: FeedArticle[];
  ok: boolean;
  candidates?: Candidate[];
  documentFormat?: FeedDocumentFormat;
  entryCount?: number;
  childSitemaps?: string[];
  errorCode?: "fetch_failed" | "parse_failed" | "deadline_exceeded" | "unsupported";
  httpStatus?: number;
};
export type FetchOptions = {
  fetchImpl?: typeof fetch;
  retryLimit?: number;
  timeoutMs?: number;
  limit?: number;
  concurrency?: number;
  onProgress?: (result: FeedResult, index: number) => void;
  now?: () => number;
  signal?: AbortSignal;
  maximumBytes?: number;
};
export type SaveLinksOptions = {
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<unknown>;
  limit?: number;
};

export function configuredRetryLimit(value: string | undefined): number {
  if (!value?.trim() || !/^\d+$/.test(value.trim())) return 5;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= 10 ? number : 5;
}

export function configuredLinkLimit(value: string | undefined): number {
  if (!value?.trim() || !/^\d+$/.test(value.trim())) return 5;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 100 ? number : 5;
}

export async function parseArticleLinks(
  xml: string,
  feedUrl: string,
  limit = 5,
): Promise<string[]> {
  const feed = { site: "", section: "", url: feedUrl };
  return rankCandidates(parseCandidates(xml, feed))
    .slice(0, limit)
    .map((candidate) => candidate.url);
}

export async function fetchFeed(
  feed: Feed,
  {
    fetchImpl = publicFetchRedirects,
    retryLimit = 5,
    timeoutMs = 15000,
    limit = 5,
    now = Date.now,
    signal: parentSignal,
    maximumBytes = 8_000_000,
  }: FetchOptions = {},
): Promise<FeedResult> {
  const isReutersJson = feed.site === "Reuters" && feed.url.includes("/pf/api/v3/");
  
  for (let attempt = 0; ; attempt++) {
    let parsing = false;
    let httpStatus: number | undefined;
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(parentSignal ? [parentSignal] : [])]);
    try {
      signal.throwIfAborted();
      const response = await fetchImpl(feed.url, {
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: isReutersJson 
            ? "application/json" 
             : "application/rss+xml, application/atom+xml, application/xml, text/xml, application/feed+json, application/json",
        },
      });
      if (!response.ok) {
        httpStatus = response.status;
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      
      const xml = new TextDecoder().decode(await boundedBytes(response, maximumBytes, signal));
      signal.throwIfAborted();
      parsing = true;
      const document = parseFeedDocument(xml, { ...feed, url: response.url || feed.url }, now());
      signal.throwIfAborted();
      const { candidates } = document;
      const articles = (limit > 0 ? rankCandidates(candidates, candidates, now()) : [])
        .slice(0, limit)
        .map(({ url, summary }) => ({ url, ...(summary && { summary }) }));
      return {
        ...feed,
        urls: articles.map((article) => article.url),
        articles,
        candidates,
        documentFormat: document.format,
        entryCount: document.entryCount,
        childSitemaps: document.childSitemaps,
        ok: true,
      };
    } catch (error) {
      if (attempt === retryLimit || parentSignal?.aborted)
        return { ...feed, urls: [], ok: false, errorCode: signal.aborted ? "deadline_exceeded" : error instanceof UnsupportedFeedError ? "unsupported" : parsing ? "parse_failed" : "fetch_failed", ...(httpStatus && { httpStatus }) };
      try { await sleep(Math.min(250 * 2 ** attempt, 2000), undefined, { signal: parentSignal }); }
      catch { return { ...feed, urls: [], ok: false, errorCode: "deadline_exceeded" }; }
    }
  }
}

export function parseReutersJson(
  json: { result?: { articles?: Array<{ canonical_url: string; title: string; description?: string; published_time?: string; kicker?: { names?: string[] } }> } },
  feed: Feed,
  limit: number,
  now: () => number,
): FeedArticle[] {
  const articles = json.result?.articles || [];
  const results: FeedArticle[] = [];
  
  for (const article of articles) {
    if (results.length >= limit) break;
    
    // Skip stock-quote pages and wire-only headlines
    const title = article.title || "";
    if (/stock price/i.test(title) || /^Reuters$/i.test(title)) continue;
    
    const canonicalUrl = article.canonical_url;
    if (!canonicalUrl) continue;
    
    const url = `https://www.reuters.com${canonicalUrl}`;
    
    // Validate URL is a proper article
    const validated = articleUrl(url, feed);
    if (!validated) continue;
    
    const summary = feedSummary([article.description], title, feed.site);
    results.push({
      url: validated,
      ...(summary && { summary }),
    });
  }
  
  return results;
}

export async function collectFeeds(
  feeds: Feed[],
  options: FetchOptions = {},
): Promise<FeedResult[]> {
  const results = new Array<FeedResult>(feeds.length);
  let next = 0;
  const concurrency = options.concurrency ?? boundedInteger(process.env.FEED_CONCURRENCY, 2, 6);
  await Promise.all(
    Array.from({ length: Math.min(concurrency, feeds.length) }, async () => {
      while (next < feeds.length) {
        const index = next++;
        results[index] = await fetchFeed(feeds[index], options);
      }
    }),
  );
  const pool = results.flatMap((result) => result.candidates || []);
  let selectionIndex = 0;
  const resolvedGoogle = new Map<string, Promise<string>>();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, feeds.length) }, async () => {
      while (selectionIndex < results.length) {
        const index = selectionIndex++;
        const result = results[index];
        if (!result.ok) {
          options.onProgress?.(result, index);
          continue;
        }
        const ranked = rankCandidates(result.candidates || [], pool, options.now?.() ?? Date.now());
        const selected = new Map<string, FeedArticle>();
        const deadline = AbortSignal.timeout(60000);
        let resolutionFailed = false;
        for (const candidate of ranked) {
          if (selected.size >= (options.limit ?? 5)) break;
          let url = candidate.url;
          if (new URL(result.url).hostname === "news.google.com" && isGoogleNewsArticle(url)) {
            if (deadline.aborted) {
              resolutionFailed = true;
              break;
            }
            let pending = resolvedGoogle.get(url);
            if (!pending) {
              const fetchImpl = options.fetchImpl ?? publicFetch;
              pending = resolveGoogleNewsUrl(url, (input, init) =>
                fetchImpl(input, {
                  ...init,
                  signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
                }),
              );
              resolvedGoogle.set(url, pending);
            }
            try {
              url = await pending;
            } catch {
              resolutionFailed = true;
              continue;
            }
          }
          const canonical = articleUrl(url, result);
          if (canonical && (!selected.has(canonical) || !selected.get(canonical)?.summary))
            selected.set(canonical, {
              url: canonical,
              ...(candidate.summary && { summary: candidate.summary }),
            });
        }
        result.urls = [...selected.keys()];
        result.articles = [...selected.values()];
        if (!result.urls.length && resolutionFailed) result.ok = false;
        options.onProgress?.(result, index);
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
    return { ...result, urls, articles: result.articles?.filter((article) => urls.includes(article.url)) };
  });
}

function sectionArticles(group: FeedResult[], limit: number): FeedArticle[] {
  const summaries = new Map<string, string>();
  for (const result of group)
    for (const article of result.articles || [])
      if (article.summary && !summaries.has(article.url)) summaries.set(article.url, article.summary);
  return [...new Set(group.flatMap((result) => result.urls))].slice(0, limit).map((url) => ({
    url,
    ...(summaries.has(url) && { summary: summaries.get(url)! }),
  }));
}

export function buildLinksReport(
  results: FeedResult[],
  generatedAt = new Date(),
  limit = 5,
): LinksReport {
  const websites = [...new Set(results.map((result) => result.site))].map((name) => {
    const siteResults = results.filter((result) => result.site === name);
    return {
      name,
      sections: [...new Set(siteResults.map((result) => result.section))].map((section) => {
        const group = siteResults.filter((result) => result.section === section);
        return {
          name: section,
          available: group.every((result) => result.ok),
          articles: sectionArticles(group, limit),
        };
      }),
    };
  });
  return linksReportSchema.parse({
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    savedFile: `output/links/${linksFilename(generatedAt)}`,
    limit,
    feedCount: results.length,
    failedFeedCount: results.filter((result) => !result.ok).length,
    linkCount: websites.reduce((total, site) => total + site.sections.reduce((sum, section) => sum + section.articles.length, 0), 0),
    websites,
  });
}

export function linksFilename(date: Date): string {
  return `links_${date.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-")}.json`;
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
      await writeNewFile(path, `${JSON.stringify(buildLinksReport(results, generatedAt, limit), null, 2)}\n`);
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Two runs in the same second must not overwrite each other's output.
      await wait(1000);
    }
  }
}

export async function generateLinks(
  catalog: unknown,
  options: FetchOptions & { outputDir?: string } = {},
) {
  const limit = options.limit ?? configuredLinkLimit(process.env.RSS_LINKS_PER_SECTION);
  const retryLimit = options.retryLimit ?? configuredRetryLimit(process.env.FETCH_RETRY_LIMIT);
  const feeds = selectMainFeeds(catalog);
  const results = await collectFeeds(feeds, { ...options, limit, retryLimit });
  const outputDir = options.outputDir ?? resolve(process.cwd(), "output/links");
  const path = await saveLinks(results, outputDir, { limit });
  return parseLinksReport(await readFile(path, "utf8"));
}
