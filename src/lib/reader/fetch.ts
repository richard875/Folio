import { userAgentFor } from "./extract.ts";
import { boundedBytes, publicFetch, publicUrl } from "../runtime/network.ts";

const ATTEMPT_MS = 12_000;
const MAX_BYTES = 3_000_000;
const DEFAULT_RETRY_LIMIT = 8;

function retryLimit(): number {
  const value = process.env.FETCH_RETRY_LIMIT?.trim();
  if (!value || !/^\d+$/.test(value)) return DEFAULT_RETRY_LIMIT;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit <= 10 ? limit : DEFAULT_RETRY_LIMIT;
}

/** Result of a fetch that may have followed redirects. */
export type FetchResult = {
  html: string;
  finalUrl: string;
};

/** Retry failed requests, without extending the caller's overall deadline. */
export async function fetchHtml(url: string, method: string, deadline: number): Promise<string> {
  const result = await fetchHtmlWithRedirects(url, method, deadline);
  return result.html;
}

/** Fetch with manual redirect following to capture the final URL. */
export async function fetchHtmlWithRedirects(
  url: string,
  method: string,
  deadline: number,
  maxRedirects = 10,
): Promise<FetchResult> {
  const limit = retryLimit();
  let currentUrl = url;

  for (let attempt = 0; ; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("time budget");

    let type = "";
    let buf: Uint8Array = new Uint8Array();
    let finalUrl = currentUrl;
    let redirectCount = 0;

    try {
      // Follow redirects manually to capture the final URL
      while (redirectCount < maxRedirects) {
        publicUrl(currentUrl);
        const signal = AbortSignal.timeout(Math.max(1, Math.min(ATTEMPT_MS, deadline - Date.now())));
        const res = await publicFetch(currentUrl, {
          redirect: "manual",
          signal,
          headers: {
            "user-agent": userAgentFor(method),
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
          },
        }, MAX_BYTES);

        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const location = res.headers.get("location");
          await res.body?.cancel();
          if (!location) throw new Error("Missing redirect destination.");
          currentUrl = publicUrl(new URL(location, currentUrl).href).href;
          finalUrl = currentUrl;
          redirectCount++;
          continue;
        }

        // Handle 429 (rate limited) - don't retry within this function, let the cascade try other methods
        if (res.status === 429) {
          await res.body?.cancel();
          throw new Error(`HTTP 429`);
        }

        if (!res.ok) {
          await res.body?.cancel();
          throw new Error(`HTTP ${res.status}`);
        }

        type = res.headers.get("content-type") || "";
        if (type && !/html|text|json|xml/i.test(type)) {
          await res.body?.cancel();
          throw new Error(`Unsupported type ${type}`);
        }
        buf = await boundedBytes(res, MAX_BYTES, signal);
        break;
      }
      if (redirectCount >= maxRedirects) throw new Error("Too many redirects.");
    } catch (error) {
      if (error instanceof Error && /Response too large|Unsupported type|Private network|URL credentials|HTTP 429/.test(error.message)) throw error;
      if (attempt >= limit || Date.now() >= deadline) throw error;
      continue;
    }

    // A successfully fetched but unusable response needs another extraction
    // method, not repeated requests for the same payload.
    if (type && !/html|text|json|xml/i.test(type)) throw new Error(`Unsupported type ${type}`);
    if (buf.byteLength > MAX_BYTES) throw new Error("Response too large");
    return {
      html: new TextDecoder("utf-8", { fatal: false }).decode(buf),
      finalUrl,
    };
  }
}
