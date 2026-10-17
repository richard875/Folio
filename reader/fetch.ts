import { userAgentFor } from "./extract.ts";
import { boundedBytes, publicFetch, publicUrl, outboundProxyEnabled, outboundProxyUrl, permanentNetworkFailure } from "../src/lib/runtime/network.ts";
import { boundedInteger } from "../src/lib/runtime/limits.ts";

const ATTEMPT_MS = 15_000;
const TEXT_EXTRACTION_ATTEMPT_MS = 10_000;
const DEFAULT_MAX_BYTES = 8_000_000;
const HARD_MAX_BYTES = 16_000_000;
const DEFAULT_RETRY_LIMIT = 8;

const TEXT_EXTRACTION_METHODS = new Set([
  "jina-http", "jina-https", "jina-enc", "textise-dot-iitty", "textise-iitty",
]);

function isTextExtractionMethod(method: string): boolean {
  return TEXT_EXTRACTION_METHODS.has(method);
}

function attemptTimeout(method: string): number {
  return isTextExtractionMethod(method) ? TEXT_EXTRACTION_ATTEMPT_MS : ATTEMPT_MS;
}

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
  // A failing service must not consume the entire 48-second extraction budget.
  // Direct mode retains its existing retry/deadline behaviour.
  const proxyActive = outboundProxyEnabled() && Boolean(outboundProxyUrl());
  const limit = proxyActive ? Math.min(retryLimit(), 1) : retryLimit();
  const probeDeadline = proxyActive ? Math.min(deadline, Date.now() + 6000) : deadline;
  const maxBytes = boundedInteger(process.env.ARTICLE_MAX_RESPONSE_BYTES, DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
  let currentUrl = url;

  for (let attempt = 0; ; attempt++) {
    const remainingMs = probeDeadline - Date.now();
    if (remainingMs <= 0) throw new Error("time budget");

    let type = "";
    let buf: Uint8Array = new Uint8Array();
    let finalUrl = currentUrl;
    let redirectCount = 0;

    try {
      // Follow redirects manually to capture the final URL
      while (redirectCount < maxRedirects) {
        publicUrl(currentUrl);
        if (Date.now() >= probeDeadline) throw new Error("time budget");
        const signal = AbortSignal.timeout(Math.max(1, Math.min(attemptTimeout(method), probeDeadline - Date.now())));
        const res = await publicFetch(currentUrl, {
          redirect: "manual",
          signal,
          headers: {
            "user-agent": userAgentFor(method),
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
          },
        }, maxBytes);

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
          throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
        }

        type = res.headers.get("content-type") || "";
        if (type && !/html|text|json|xml/i.test(type)) {
          await res.body?.cancel();
          throw new Error(`Unsupported type ${type}`);
        }
        buf = await boundedBytes(res, maxBytes, signal);
        break;
      }
      if (redirectCount >= maxRedirects) throw new Error("Too many redirects.");
    } catch (error) {
      if (error instanceof Error && /Response too large/.test(error.message)) {
        throw new Error(`Response too large (article limit: ${maxBytes} bytes; ARTICLE_MAX_RESPONSE_BYTES supports up to ${HARD_MAX_BYTES}).`);
      }
      if (error instanceof Error && /Unsupported type|Private network|URL credentials|HTTP 429/.test(error.message)) throw error;
      if (permanentNetworkFailure(error) || error instanceof Error && "httpStatus" in error &&
          typeof error.httpStatus === "number" && error.httpStatus >= 400 && error.httpStatus < 500 && error.httpStatus !== 408) throw error;
      if (attempt >= limit || Date.now() >= probeDeadline) throw error;
      continue;
    }

    // A successfully fetched but unusable response needs another extraction
    // method, not repeated requests for the same payload.
    if (type && !/html|text|json|xml/i.test(type)) throw new Error(`Unsupported type ${type}`);
    if (buf.byteLength > maxBytes) throw new Error(`Response too large (article limit: ${maxBytes} bytes).`);
    return {
      html: new TextDecoder("utf-8", { fatal: false }).decode(buf),
      finalUrl,
    };
  }
}
