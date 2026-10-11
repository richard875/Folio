import { userAgentFor } from "./extract.ts";

const ATTEMPT_MS = 12_000;
const MAX_BYTES = 1_800_000;
const DEFAULT_RETRY_LIMIT = 5;

function retryLimit(): number {
  const value = process.env.FETCH_RETRY_LIMIT?.trim();
  if (!value || !/^\d+$/.test(value)) return DEFAULT_RETRY_LIMIT;
  const limit = Number(value);
  return Number.isSafeInteger(limit) ? limit : DEFAULT_RETRY_LIMIT;
}

/** Retry failed requests, without extending the caller's overall deadline. */
export async function fetchHtml(url: string, method: string, deadline: number): Promise<string> {
  const limit = retryLimit();
  for (let attempt = 0; ; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("time budget");

    let type: string;
    let buf: ArrayBuffer;
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(Math.min(ATTEMPT_MS, remainingMs)),
        headers: {
          "user-agent": userAgentFor(method),
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      type = res.headers.get("content-type") || "";
      buf = await res.arrayBuffer();
    } catch (error) {
      if (attempt >= limit || Date.now() >= deadline) throw error;
      continue;
    }

    // A successfully fetched but unusable response needs another extraction
    // method, not repeated requests for the same payload.
    if (type && !/html|text|json|xml/i.test(type)) throw new Error(`Unsupported type ${type}`);
    if (buf.byteLength > MAX_BYTES) throw new Error("Response too large");
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
}
