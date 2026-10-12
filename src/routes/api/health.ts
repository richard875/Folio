import { createFileRoute } from "@tanstack/react-router";
import { handleHealth } from "@/lib/runtime/health";

export const Route = createFileRoute("/api/health")({
  server: { handlers: { GET: ({ request }) => handleHealth(request) } },
});
