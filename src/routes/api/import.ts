import { createFileRoute } from "@tanstack/react-router";
import { handleImport } from "@/lib/runtime/import";

export const Route = createFileRoute("/api/import")({
  server: { handlers: { POST: ({ request }) => handleImport(request) } },
});
