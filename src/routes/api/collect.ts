import { createFileRoute } from "@tanstack/react-router";
import { handleCollectRequest } from "@/lib/batch/api";

export const Route = createFileRoute("/api/collect")({
  server: {
    handlers: {
      GET: ({ request }) => handleCollectRequest(request),
      POST: ({ request }) => handleCollectRequest(request),
    },
  },
});
