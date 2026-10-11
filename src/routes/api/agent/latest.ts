import { createFileRoute } from "@tanstack/react-router";
import { handleAgentLatest } from "@/lib/agent/api";

export const Route = createFileRoute("/api/agent/latest")({
  server: { handlers: { GET: ({ request }) => handleAgentLatest(request) } },
});
