import { createFileRoute } from "@tanstack/react-router";
import { readArticle, statusOf } from "@/lib/reader/read";

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get("url") || "";
  const hash = url.searchParams.get("hash");
  const format = (url.searchParams.get("format") || "markdown").toLowerCase();
  try {
    const article = await readArticle(target, hash);
    if (format === "json") {
      return Response.json(article);
    }
    return new Response(article.markdown, {
      status: article.partial ? 206 : 200,
      headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "private, max-age=300" },
    });
  } catch (error) {
    const status = statusOf(error);
    const message = status === 500 ? "Unable to read the article. Please try again later."
      : error instanceof Error ? error.message : "Failed";
    if (format === "json" || (request.headers.get("accept") || "").includes("application/json")) {
      return Response.json({ error: message }, { status });
    }
    return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

export const Route = createFileRoute("/api/read")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
    },
  },
});
