import { createFileRoute } from "@tanstack/react-router";
import { handleSaveBatchStatus } from "@/lib/batch/save-batch";

export const Route = createFileRoute("/api/save-batch/status")({
  server: { handlers: { GET: ({ request }) => handleSaveBatchStatus(request) } },
});