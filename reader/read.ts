import { hashMatches } from "./auth.ts";
import { isSubstantial, looksLikeShell, toMarkdown } from "./extract.ts";
import { fetchHtmlWithRedirects } from "./fetch.ts";
import { parseArticleResponse } from "./response.ts";
import { assertPublicHttpUrl, probeList, type Probe } from "./targets.ts";
import type { ArticleResult } from "./types.ts";
import { BoundedCache, extractionLimit } from "../src/lib/runtime/limits.ts";

const CACHE = new BoundedCache<ArticleResult>(10, 8 * 1024 * 1024, 30 * 60 * 1000);
const BUDGET_MS = 48_000;

// Cache for resolved archive.is/newest URLs -> direct archive.is/... URLs
// Key: original article URL, Value: { finalUrl, at }
const ARCHIVE_RESOLVE_CACHE = new Map<string, { finalUrl: string; at: number }>();
const ARCHIVE_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours - archive snapshots are stable
const MAX_ARCHIVE_CACHE = 500;

const HITS: number[] = [];

function rateOk(): boolean {
  const now = Date.now();
  while (HITS.length && now - HITS[0] > 60_000) HITS.shift();
  if (HITS.length >= 24) return false;
  HITS.push(now);
  return true;
}

/** Get cached resolved archive URL if available and fresh. */
function getCachedArchiveUrl(original: string): string | null {
  const entry = ARCHIVE_RESOLVE_CACHE.get(original);
  if (entry && Date.now() - entry.at < ARCHIVE_CACHE_MS) {
    return entry.finalUrl;
  }
  return null;
}

/** Cache a resolved archive URL. */
function setCachedArchiveUrl(original: string, finalUrl: string): void {
  if (ARCHIVE_RESOLVE_CACHE.size >= MAX_ARCHIVE_CACHE) {
    const oldest = [...ARCHIVE_RESOLVE_CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) ARCHIVE_RESOLVE_CACHE.delete(oldest[0]);
  }
  ARCHIVE_RESOLVE_CACHE.set(original, { finalUrl, at: Date.now() });
}

export async function readArticle(rawUrl: string, hash: string | null): Promise<ArticleResult> {
  if (!hashMatches(hash)) {
    const err = new Error("Unauthorized");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  if (!rateOk()) {
    const err = new Error("Too many requests. Wait a minute.");
    (err as Error & { status: number }).status = 429;
    throw err;
  }

  let original: string;
  try { original = assertPublicHttpUrl(rawUrl.trim()).href; }
  catch (error) { throw Object.assign(error as Error, { status: 400 }); }
  const cached = CACHE.get(original);
  if (cached) return cached;
  return extractionLimit.run(() => extractArticle(original));
}

async function extractArticle(original: string): Promise<ArticleResult> {
  const started = Date.now();
  let best: ArticleResult | null = null;

  const withoutSearch = new URL(original);
  withoutSearch.search = "";
  const sourceUrls = withoutSearch.href === original ? [original] : [withoutSearch.href, original];
  const passBudget = BUDGET_MS / sourceUrls.length;

  for (const sourceUrl of sourceUrls) {
    if (best && !best.partial) break;
    const passStarted = Date.now();

    // Track probes that failed with 429 for a second pass
    const rateLimitedProbes: Array<{ probe: Probe; finalUrl: string }> = [];
    const probes = probeList(sourceUrl);

    for (let i = 0; i < probes.length; i++) {
      const probe = probes[i];
      if (Date.now() - passStarted > passBudget || Date.now() - started > BUDGET_MS) {
        break;
      }
      // Small delay between probes to avoid triggering rate limits
      if (i > 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
      try {
        assertPublicHttpUrl(probe.url);
        let html: string;
        let finalUrl = probe.url;

        // For archive.is-newest, check if we have a cached resolved URL
        if (probe.method === "archive.is-newest") {
          const cachedArchiveUrl = getCachedArchiveUrl(original);
          if (cachedArchiveUrl) {
            // Use cached direct archive URL instead of hitting /newest/
            const result = await fetchHtmlWithRedirects(
              cachedArchiveUrl,
              probe.method,
              Math.min(passStarted + passBudget, started + BUDGET_MS),
            );
            html = result.html;
            finalUrl = result.finalUrl;
          } else {
            const result = await fetchHtmlWithRedirects(
              probe.url,
              probe.method,
              Math.min(passStarted + passBudget, started + BUDGET_MS),
            );
            html = result.html;
            finalUrl = result.finalUrl;
            // Cache the resolved URL for future requests
            if (finalUrl !== probe.url && new URL(finalUrl).hostname === "archive.is") {
              setCachedArchiveUrl(original, finalUrl);
            }
          }
        } else {
          const result = await fetchHtmlWithRedirects(
            probe.url,
            probe.method,
            Math.min(passStarted + passBudget, started + BUDGET_MS),
          );
          html = result.html;
          finalUrl = result.finalUrl;
        }

        const parsed = parseArticleResponse(html, finalUrl, probe.method);
        if (!parsed || looksLikeShell(parsed.title, parsed.text)) {
          continue;
        }
        const partial = !isSubstantial(parsed.text);
        const draft: ArticleResult = {
          title: parsed.title,
          author: parsed.author,
          published: parsed.published,
          originalUrl: original,
          text: parsed.text,
          images: parsed.images,
          partial,
          markdown: "",
          sourceUrl: finalUrl,
        };
        draft.markdown = toMarkdown(draft);
        if (!best || best.partial && !partial || best.partial === partial && parsed.text.length > best.text.length) best = draft;
        if (!partial) break;
      } catch (error) {
        // Track 429 errors for second pass
        if (error instanceof Error && error.message.includes("HTTP 429")) {
          rateLimitedProbes.push({ probe, finalUrl: probe.url });
        }
        // DEBUG: Log fetch failures to understand what's blocking
        console.error("[read] probe failed:", { url: original, probe: probe.method, probeUrl: probe.url, error: error instanceof Error ? error.message : String(error) });
        // Continue without exposing internal request details to the caller.
      }
    }

    // Second pass: retry rate-limited probes after a brief wait
    if (rateLimitedProbes.length > 0 && !best) {
      // Wait a moment for rate limit to clear
      await new Promise((r) => setTimeout(r, 2000));

      for (const { probe, finalUrl } of rateLimitedProbes) {
        if (Date.now() - started > BUDGET_MS) break;
        try {
          assertPublicHttpUrl(probe.url);
          let html: string;
          let retryFinalUrl = finalUrl;

          if (probe.method === "archive.is-newest") {
            const result = await fetchHtmlWithRedirects(
              probe.url,
              probe.method,
              started + BUDGET_MS,
            );
            html = result.html;
            retryFinalUrl = result.finalUrl;
            // Cache the resolved URL for future requests
            if (retryFinalUrl !== probe.url && new URL(retryFinalUrl).hostname === "archive.is") {
              setCachedArchiveUrl(original, retryFinalUrl);
            }
          } else {
            const result = await fetchHtmlWithRedirects(probe.url, probe.method, started + BUDGET_MS);
            html = result.html;
            retryFinalUrl = result.finalUrl;
          }

          const parsed = parseArticleResponse(html, retryFinalUrl, probe.method);
          if (!parsed || looksLikeShell(parsed.title, parsed.text)) {
            continue;
          }
          const partial = !isSubstantial(parsed.text);
          const draft: ArticleResult = {
            title: parsed.title,
            author: parsed.author,
            published: parsed.published,
            originalUrl: original,
            text: parsed.text,
            images: parsed.images,
            partial,
            markdown: "",
            sourceUrl: retryFinalUrl,
          };
          draft.markdown = toMarkdown(draft);
          if (!best || best.partial && !partial || best.partial === partial && parsed.text.length > best.text.length) best = draft;
          if (!partial) break;
        } catch (error) {
          // Ignore second-pass failures
          console.error("[read] second-pass failed:", { url: original, probe: probe.method, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    if (Date.now() - started > BUDGET_MS) {
      break;
    }
  }

  if (!best) {
    console.error("[read] all probes failed:", { url: original });
    const err = new Error("Could not extract an article. Please try again later.");
    (err as Error & { status: number }).status = 422;
    throw err;
  }

  console.info("[read] extracted:", { url: original, sourceUrl: best.sourceUrl, partial: best.partial, textLength: best.text.length });
  CACHE.set(original, best, JSON.stringify(best).length * 2 + original.length * 2);
  return best;
}

export function statusOf(error: unknown): number {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return 500;
}
