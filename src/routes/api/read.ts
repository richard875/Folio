import { createFileRoute } from "@tanstack/react-router";
import { readArticle, statusOf } from "@reader/read";

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get("url") || "";
  const hash = url.searchParams.get("hash");
  const format = (url.searchParams.get("format") || "markdown").toLowerCase();
  const headers: Record<string, string> = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  try {
    const article = await readArticle(target, hash);
    if (format === "json") {
      return Response.json(article, { headers });
    }
    return new Response(article.markdown, {
      status: article.partial ? 206 : 200,
      headers: { ...headers, "content-type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    const status = statusOf(error);
    if (status === 429) headers["retry-after"] = "60";
    const message = status === 500 ? "Unable to read the article. Please try again later."
      : error instanceof Error ? error.message : "Failed";
    if (format === "json" || (request.headers.get("accept") || "").includes("application/json")) {
      return Response.json({ error: message }, { status, headers });
    }
    return new Response(message, { status, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
  }
}

export const Route = createFileRoute("/api/read")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
    },
  },
});
