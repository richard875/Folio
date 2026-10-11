import { createFileRoute } from "@tanstack/react-router";
import research from "../../../attachments/News site RSS feeds by section.md?raw";
import { createLinksHandler } from "@/lib/rss/api";

// Bundle the catalog into the server, rather than depending on source files
// being copied alongside the production build.
const handle = createLinksHandler(research);

export const Route = createFileRoute("/api/links")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
