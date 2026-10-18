import { hashMatches } from "../../../reader/auth.ts";
import { generateLinks } from "./links.ts";

/** One collection at a time per Node process, to avoid duplicate feed storms. */
export function createLinksHandler(catalog: unknown, generate = generateLinks) {
  let running = false;
  return async function handleLinksRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const json = url.searchParams.get("format") === "json";
    const headers = { "cache-control": "no-store" };
    const errorResponse = (message: string, status: number) =>
      json
        ? Response.json({ error: message }, { status, headers })
        : new Response(message, {
            status,
            headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
          });
    if (!hashMatches(url.searchParams.get("hash"))) return errorResponse("Unauthorized", 401);
    if (running)
      return errorResponse("A link collection is already running. Please try again later.", 409);
    running = true;
    try {
      const report = await generate(catalog);
      const status = report.failedFeedCount === report.feedCount ? 502 : 200;
      const responseHeaders = { ...headers, "x-saved-file": report.savedFile };
      if (json) return Response.json(report, { status, headers: responseHeaders });
      return new Response(report.markdown, {
        status,
        headers: { ...responseHeaders, "content-type": "text/markdown; charset=utf-8" },
      });
    } catch {
      return errorResponse("Unable to collect article links. Please try again later.", 500);
    } finally {
      running = false;
    }
  };
}
