import { readArticle, statusOf } from "./read.ts";
import { saveArticle } from "./save.ts";

/** Dependencies are injectable so auth, write failures and responses are testable. */
export async function handleSaveRequest(
  request: Request,
  { read = readArticle, save = saveArticle } = {},
): Promise<Response> {
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") || "markdown").toLowerCase();
  try {
    const article = await read(url.searchParams.get("url") || "", url.searchParams.get("hash"));
    const savedFile = await save(article, {
      format,
      website: url.searchParams.get("website"),
      section: url.searchParams.get("section"),
    });
    const headers = { "cache-control": "no-store", "x-saved-file": savedFile };
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
    const headers = { "cache-control": "no-store" };
    if (format === "json" || (request.headers.get("accept") || "").includes("application/json")) {
      return Response.json({ error: message }, { status, headers });
    }
    return new Response(message, {
      status,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
    });
  }
}
