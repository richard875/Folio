import { createFileRoute } from "@tanstack/react-router";
import { handleSaveRequest } from "@reader/save-api";

export const Route = createFileRoute("/api/save")({
  server: {
    handlers: {
      GET: ({ request }) => handleSaveRequest(request),
    },
  },
});
