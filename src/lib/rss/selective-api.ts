import { hashMatches } from "../../../reader/auth.ts";
import { boundedBytes } from "../runtime/network.ts";
import { feedOperationLimit } from "../runtime/limits.ts";
import { discoverFeeds, FeedRequestError, type DiscoveryCatalog } from "./discovery.ts";
import { fetchSelectedFeeds, validateSelections, type SelectiveOptions } from "./selective.ts";

const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
export function createFeedHandlers(catalog: DiscoveryCatalog, options: SelectiveOptions = {}) {
  const fail = (error: unknown) => {
    const status = error instanceof FeedRequestError ? error.status : (error as { status?: number })?.status === 429 ? 429 : 500;
    return Response.json({ error: status === 429 ? "Feed collection is busy. Retry later." : error instanceof FeedRequestError ? error.message : "Unable to process feeds." },
      { status, headers: { ...headers, ...(status === 429 && { "retry-after": "5" }) } });
  };
  function authenticate(request: Request) {
    const url = new URL(request.url);
    if (!hashMatches(url.searchParams.get("hash"))) throw new FeedRequestError(401, "Unauthorized");
    return url;
  }
  return {
    async catalog(request: Request): Promise<Response> {
      try {
        const url = authenticate(request);
        if (request.method !== "GET") throw new FeedRequestError(405, "Use GET.");
        return Response.json(discoverFeeds(url, catalog), { headers });
      } catch (error) { return fail(error); }
    },
    async fetch(request: Request): Promise<Response> {
      try {
        const url = authenticate(request);
        if (request.method !== "POST") throw new FeedRequestError(405, "Use POST.");
        if ([...url.searchParams.keys()].some((key) => key !== "hash") || url.searchParams.getAll("hash").length !== 1)
          throw new FeedRequestError(400, "Only hash is supported in the fetch query.");
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
          throw new FeedRequestError(400, "Use Content-Type: application/json.");
        let text: string;
        try {
          const body = await boundedBytes(new Response(request.body, { headers: request.headers }), 16_384, AbortSignal.any([request.signal, AbortSignal.timeout(3000)]));
          text = new TextDecoder().decode(body);
        } catch {
          throw new FeedRequestError(413, "Provide at most 16384 bytes within three seconds.");
        }
        let input: unknown;
        try { input = JSON.parse(text); } catch { throw new FeedRequestError(400, "Provide valid JSON."); }
        validateSelections(input, catalog);
        const signal = AbortSignal.any([request.signal, ...(options.signal ? [options.signal] : [])]);
        return Response.json(await feedOperationLimit.run(() => fetchSelectedFeeds(input, catalog, { ...options, signal })), { headers });
      } catch (error) { return fail(error); }
    },
  };
}
