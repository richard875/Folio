import { z } from "zod";
import { fetchFeed, type FeedResult } from "./links.ts";
import { articleUrl, cleanTitle, rankCandidates, type Candidate } from "./selection.ts";
import { isGoogleNewsArticle, resolveGoogleNewsUrl } from "./google-news.ts";
import { boundedBytes, publicFetch, publicUrl } from "../runtime/network.ts";
import { FeedRequestError, SELECTIVE_LIMITS as limits, type DiscoveryCatalog, type FeedRecord } from "./discovery.ts";

export const selectedFeedRequestSchema = z.object({
  catalogVersion: z.string().regex(/^[a-f0-9]{64}$/),
  selections: z.array(z.object({
    feedId: z.string().regex(/^feed_[a-f0-9]{64}$/),
    candidateLimit: z.number().int().min(1).max(limits.maxCandidatesPerFeed),
  }).strict()).min(1).max(limits.maxFeeds),
}).strict();
export type SelectedFeedRequest = z.infer<typeof selectedFeedRequestSchema>;
type Selection = { feed: FeedRecord; candidateLimit: number };
export type SelectiveCandidate = { url: string; title: string; summary?: string; publishedAt: string | null; feedRank: number };
type Outcome = "ok" | "empty" | "fetch_failed" | "parse_failed" | "deadline_exceeded" | "unsupported";
export type SelectiveOptions = { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; feedTimeoutMs?: number };

export function validateSelections(input: unknown, catalog: DiscoveryCatalog): Selection[] {
  const parsed = selectedFeedRequestSchema.safeParse(input);
  if (!parsed.success) throw new FeedRequestError(400, "Provide catalogVersion and 1–8 selections with feedId and candidateLimit (1–20), without extra fields.");
  if (parsed.data.catalogVersion !== catalog.catalogVersion)
    throw new FeedRequestError(409, "Catalog changed. Rediscover feeds and select current IDs.");
  const seen = new Set<string>();
  let total = 0;
  return parsed.data.selections.map(({ feedId, candidateLimit }) => {
    const feed = catalog.byId.get(feedId);
    if (!feed) throw new FeedRequestError(400, "Unknown feedId. Select IDs returned by feed-catalog.");
    if (seen.has(feedId)) throw new FeedRequestError(400, "Duplicate feedId. Select each feed once.");
    seen.add(feedId);
    total += candidateLimit;
    if (total > limits.maxCandidates) throw new FeedRequestError(400, "Sum of candidateLimit values must not exceed 100.");
    return { feed, candidateLimit };
  });
}

/** Request-scoped byte/request budgets and origin locks cover redirects and Google too. */
function createSelectiveTransport(implementation?: typeof fetch): typeof fetch {
  let remainingBytes = limits.maxResponseBytes;
  let requests = 0;
  const origins = new Map<string, Promise<void>>();
  async function once(url: URL, init: RequestInit = {}): Promise<Response> {
    const prior = origins.get(url.origin) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.then(() => gate);
    origins.set(url.origin, tail);
    // An aborted waiter must not remove the lock of an earlier in-flight request.
    void tail.then(() => { if (origins.get(url.origin) === tail) origins.delete(url.origin); });
    let abort: (() => void) | undefined;
    try {
      init.signal?.throwIfAborted();
      await Promise.race([prior, new Promise<never>((_, reject) => {
        abort = () => reject(init.signal?.reason ?? new Error("Request aborted"));
        init.signal?.addEventListener("abort", abort, { once: true });
      })]);
      init.signal?.throwIfAborted();
      if (++requests > limits.maxOutboundRequests || remainingBytes < 1) throw new Error("Feed transport budget exhausted.");
      const allowance = Math.min(limits.maximumBytes, remainingBytes);
      remainingBytes -= allowance; // Reserve before await; concurrent streams cannot overspend.
      const response = implementation ? await implementation(url.href, { ...init, redirect: "manual" })
        : await publicFetch(url, { ...init, redirect: "manual" }, allowance);
      const bytes = await boundedBytes(response, allowance, init.signal ?? undefined);
      remainingBytes += allowance - bytes.length;
      const buffered = new Response(bytes as BodyInit, { status: response.status, headers: response.headers });
      Object.defineProperty(buffered, "url", { value: response.url || url.href });
      return buffered;
    } finally {
      if (abort) init.signal?.removeEventListener("abort", abort);
      release();
    }
  }
  return async (input, init) => {
    let url = publicUrl(input instanceof Request ? input.url : String(input));
    for (let hop = 0; hop <= 5; hop++) {
      const response = await once(url, init);
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      if (init?.redirect === "manual") return response;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (init?.redirect === "error") throw new Error("Unexpected redirect.");
      if (!location || hop === 5) throw new Error("Invalid feed redirect.");
      url = publicUrl(new URL(location, url).href);
    }
    throw new Error("Too many feed redirects.");
  };
}

export async function fetchSelectedFeeds(input: unknown, catalog: DiscoveryCatalog, options: SelectiveOptions = {}) {
  const selections = validateSelections(input, catalog); // All validation precedes any I/O.
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? limits.requestTimeoutMs), ...(options.signal ? [options.signal] : [])]);
  const fetchImpl = createSelectiveTransport(options.fetchImpl);
  const raw = new Array<FeedResult>(selections.length);
  const warnings = selections.map(() => [] as string[]);
  const indexTruncated = new Set<number>();
  const pending = new Set(selections.map((_, index) => index));
  const activeOrigins = new Set<string>();

  async function load(index: number) {
    const { feed } = selections[index];
    const feedSignal = AbortSignal.any([signal, AbortSignal.timeout(options.feedTimeoutMs ?? limits.feedTimeoutMs)]);
    const fetchOptions = { fetchImpl, retryLimit: 0, timeoutMs: options.feedTimeoutMs ?? limits.feedTimeoutMs, maximumBytes: limits.maximumBytes, signal: feedSignal, limit: 0 };
    let result = await fetchFeed(feed, fetchOptions);
    if (result.ok && result.documentFormat === "sitemap-index") {
      const children = [...new Set(result.childSitemaps)].flatMap((value) => {
        try {
          const url = publicUrl(new URL(value, feed.url).href);
          // No arbitrary cross-origin traversal or recursive sitemap crawling.
          return url.origin === new URL(feed.url).origin ? [url.href] : [];
        } catch { return []; }
      });
      const selected = children.slice(0, limits.maxChildSitemaps);
      indexTruncated.add(index);
      warnings[index].push("Sitemap index: only the first three unique same-origin children are considered; no recursive crawling.");
      if (children.length !== result.childSitemaps?.length) warnings[index].push("Unsafe, cross-origin or duplicate sitemap children were excluded.");
      const candidates: Candidate[] = [];
      let entryCount = 0;
      let childFailed = false;
      for (const url of selected) {
        const child = await fetchFeed({ ...feed, url }, fetchOptions);
        if (!child.ok || child.documentFormat === "sitemap-index") {
          childFailed = true;
          warnings[index].push(child.errorCode === "deadline_exceeded" ? "Child sitemap deadline exceeded." : "A child sitemap failed or required unsupported recursive traversal.");
          continue;
        }
        entryCount += child.entryCount ?? 0;
        if (entryCount > 2000) {
          childFailed = true;
          warnings[index].push("Combined sitemap entry limit reached (2000); remaining children omitted.");
          break;
        }
        const base = candidates.length;
        candidates.push(...(child.candidates ?? []).map((candidate) => ({ ...candidate, index: base + candidate.index })));
      }
      const unique = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
      result = { ...result, entryCount: Math.min(entryCount, 2000), candidates: unique, ok: selected.length > 0 && (!childFailed || unique.length > 0),
        ...((!selected.length || childFailed && !unique.length) && { errorCode: feedSignal.aborted ? "deadline_exceeded" as const : "fetch_failed" as const }) };
      if (!selected.length) warnings[index].push("No eligible same-origin sitemap children.");
    }
    raw[index] = result;
  }

  // Bounded work within one request; never queue incoming HTTP operations.
  async function worker(): Promise<void> {
    for (;;) {
      const index = [...pending].find((index) => !activeOrigins.has(new URL(selections[index].feed.url).origin));
      if (index === undefined) return;
      pending.delete(index);
      const origin = new URL(selections[index].feed.url).origin;
      activeOrigins.add(origin);
      try { await load(index); } finally { activeOrigins.delete(origin); }
    }
  }
  await Promise.all(Array.from({ length: limits.concurrency }, () => worker()));

  let googleAttempts = 0;
  const resolved = new Map<string, string | null>();
  const feeds = [];
  for (const [index, { feed, candidateLimit }] of selections.entries()) {
    const result = raw[index];
    const candidates: SelectiveCandidate[] = [];
    const selectedUrls = new Set<string>();
    const ranked = rankCandidates(result.candidates ?? []);
    let resolutionFailed = false;
    for (const candidate of ranked) {
      if (candidates.length === candidateLimit) break;
      let url: string | null = candidate.url;
      if (isGoogleNewsArticle(url)) {
        if (!resolved.has(url)) {
          if (googleAttempts >= limits.maxGoogleResolutions || signal.aborted) {
            resolutionFailed = true;
            continue;
          }
          googleAttempts++;
          const resolutionSignal = AbortSignal.any([signal, AbortSignal.timeout(options.feedTimeoutMs ?? limits.feedTimeoutMs)]);
          try {
            const destination = await resolveGoogleNewsUrl(url, (input, init) => fetchImpl(input, {
              ...init, signal: AbortSignal.any([resolutionSignal, ...(init?.signal ? [init.signal] : [])]),
            }));
            resolved.set(url, destination);
          } catch { resolved.set(url, null); }
        }
        url = resolved.get(url) ?? null;
        if (!url) { resolutionFailed = true; continue; }
      }
      url = articleUrl(url, feed);
      // Never emit unresolved Google pages as article candidates.
      if (!url || new URL(url).hostname === "news.google.com" || selectedUrls.has(url)) continue;
      selectedUrls.add(url);
      candidates.push({
        url, title: cleanTitle(candidate.title).slice(0, 500),
        ...(candidate.summary && { summary: candidate.summary.slice(0, 1000) }),
        publishedAt: candidate.publishedAt === null ? null : new Date(candidate.publishedAt).toISOString(),
        feedRank: candidate.index + 1,
      });
    }
    if (resolutionFailed) warnings[index].push("Some Google News links could not be resolved within request/resolution limits; wrappers were not returned.");
    if (result.ok && (result.entryCount ?? 0) > 0 && !ranked.length)
      warnings[index].push("All entries were filtered by publisher-domain, article/media or freshness rules. Catalog membership does not guarantee extraction compatibility.");
    let status: Outcome = !result.ok ? result.errorCode ?? "fetch_failed" : candidates.length ? "ok" : "empty";
    if (!candidates.length && resolutionFailed) status = signal.aborted ? "deadline_exceeded" : "fetch_failed";
    const truncated = indexTruncated.has(index) || ranked.length > candidates.length || resolutionFailed;
    feeds.push({
      feedId: feed.feedId, publisher: feed.publisher, section: feed.section, url: feed.url,
      requestedLimit: candidateLimit, status,
      ...(result.documentFormat && { documentFormat: result.documentFormat }),
      ...(result.httpStatus && { httpStatus: result.httpStatus }),
      entryCount: result.entryCount ?? 0, eligibleCount: ranked.length, truncated,
      candidates, warnings: warnings[index],
    });
  }
  const all = feeds.flatMap((feed) => feed.candidates);
  return {
    schemaVersion: 1, catalogVersion: catalog.catalogVersion, generatedAt: new Date().toISOString(),
    feedCount: feeds.length, failedFeedCount: feeds.filter((feed) => !["ok", "empty"].includes(feed.status)).length,
    candidateCount: all.length, uniqueCandidateCount: new Set(all.map(({ url }) => url)).size,
    partial: feeds.some((feed) => !["ok", "empty"].includes(feed.status) || feed.warnings.length > 0),
    feeds,
  };
}
