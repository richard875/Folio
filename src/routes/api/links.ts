import { createFileRoute } from "@tanstack/react-router";
import catalog from "../../../data/feeds.json" with { type: "json" };
import { createLinksHandler } from "@/lib/rss/api";

// Bundle the catalog into the server, rather than depending on source files
// being copied alongside the production build.
const handle = createLinksHandler(catalog);

export const Route = createFileRoute("/api/links")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
