import { createFileRoute } from "@tanstack/react-router";
import { feedHandlers } from "@/lib/rss/selected-sources";

export const Route = createFileRoute("/api/feed-fetch")({
  server: { handlers: { POST: ({ request }) => feedHandlers.fetch(request) } },
});
