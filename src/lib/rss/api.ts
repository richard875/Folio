import { hashMatches } from "../../../reader/auth.ts";
import { generateLinks } from "./links.ts";
import { selectMainFeeds } from "./catalog.ts";
import { feedOperationLimit } from "../runtime/limits.ts";

/** One collection at a time per Node process, to avoid duplicate feed storms. */
export function createLinksHandler(catalog: unknown, generate = generateLinks) {
  let running = false;
  return async function handleLinksRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers = { "cache-control": "no-store" };
    const errorResponse = (message: string, status: number) =>
      Response.json({ error: message }, { status, headers });
    if (!hashMatches(url.searchParams.get("hash"))) return errorResponse("Unauthorized", 401);
    if (url.searchParams.has("format") && url.searchParams.get("format") !== "json")
      return errorResponse("Link reports are JSON only. Omit format or use format=json.", 400);
    if (running)
      return errorResponse("A link collection is already running. Please try again later.", 409);
    running = true;
    try {
      const report = await feedOperationLimit.run(() => generate(selectMainFeeds(catalog)));
      const status = report.failedFeedCount === report.feedCount ? 502 : 200;
      const responseHeaders = { ...headers, "x-saved-file": report.savedFile };
      return Response.json(report, { status, headers: responseHeaders });
    } catch (error) {
      if ((error as { status?: number })?.status === 429)
        return Response.json({ error: "Feed collection is busy. Retry later." }, { status: 429, headers: { ...headers, "retry-after": "5" } });
      return errorResponse("Unable to collect article links. Please try again later.", 500);
    } finally {
      running = false;
    }
  };
}
