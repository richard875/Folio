import { readArticle, statusOf } from "./read.ts";
import { saveArticle } from "./save.ts";
import { jobManager, validCallId } from "../batch/jobs.ts";

/** Dependencies are injectable so auth, write failures and responses are testable. */
export async function handleSaveRequest(
  request: Request,
  {
    read = readArticle,
    save = saveArticle,
    getJob = (callId: string): Promise<{ startedAt: string } | null> => jobManager.get(callId),
  } = {},
): Promise<Response> {
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") || "markdown").toLowerCase();
  const callId = url.searchParams.get("callId");
  try {
    const article = await read(url.searchParams.get("url") || "", url.searchParams.get("hash"));
    if (callId && !validCallId(callId)) {
      return Response.json(
        { error: "Invalid callId." },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const job = callId ? await getJob(callId) : null;
    if (callId && !job) {
      return Response.json(
        { error: "Call not found." },
        {
          status: 404,
          headers: { "cache-control": "no-store" },
        },
      );
    }
    const savedFile = await save(article, {
      format,
      website: url.searchParams.get("website"),
      section: url.searchParams.get("section"),
      jobStartedAt: job?.startedAt,
    });
    const headers: Record<string, string> = {
      "cache-control": "no-store",
      "x-saved-file": savedFile,
    };
    if (callId) headers["x-call-id"] = callId;
    const status = article.partial ? 206 : 200;
    if (format === "json") return Response.json(article, { status, headers });
    return new Response(article.markdown, {
      status,
      headers: { ...headers, "content-type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    const status = statusOf(error);
    const message =
      status === 500
        ? "Unable to save the article. Please try again later."
        : error instanceof Error
          ? error.message
          : "Failed";
    // Log actual error for debugging (Render logs)
    console.error("[save-api] error:", { status, message, url: url.searchParams.get("url"), error: error instanceof Error ? error.stack : error });
    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (status === 429) headers["retry-after"] = "60";
    if (format === "json" || (request.headers.get("accept") || "").includes("application/json")) {
      return Response.json({ error: message }, { status, headers });
    }
    return new Response(message, {
      status,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
    });
  }
}
