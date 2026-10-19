import { createFileRoute } from "@tanstack/react-router";
import { mainFeeds } from "@/lib/rss/sources";
import { createLinksHandler } from "@/lib/rss/api";

// Bundle the catalog into the server, rather than depending on source files
// being copied alongside the production build.
const handle = createLinksHandler(mainFeeds);

export const Route = createFileRoute("/api/links")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
