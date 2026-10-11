import { createFileRoute } from "@tanstack/react-router";
import { handleCollectStatus } from "@/lib/batch/api";

export const Route = createFileRoute("/api/collect/status")({
  server: { handlers: { GET: ({ request }) => handleCollectStatus(request) } },
});
