import { createFileRoute } from "@tanstack/react-router";
import { handleSaveBatchRequest, handleSaveBatchStatus } from "@/lib/batch/save-batch";

export const Route = createFileRoute("/api/save-batch")({
  server: {
    handlers: {
      POST: ({ request }) => handleSaveBatchRequest(request),
    },
  },
});