import { createFileRoute } from "@tanstack/react-router";
import { handleAgentRead } from "@/lib/agent/api";

export const Route = createFileRoute("/api/agent/read")({
  server: { handlers: { GET: ({ request }) => handleAgentRead(request) } },
});
