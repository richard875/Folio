import { createFileRoute } from "@tanstack/react-router";
import { feedHandlers } from "@/lib/rss/selected-sources";

export const Route = createFileRoute("/api/feed-catalog")({
  server: { handlers: { GET: ({ request }) => feedHandlers.catalog(request) } },
});
