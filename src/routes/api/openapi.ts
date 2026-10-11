import { createFileRoute } from "@tanstack/react-router";
import { handleOpenApi } from "@/lib/swagger/docs";

export const Route = createFileRoute("/api/openapi")({
  server: { handlers: { GET: ({ request }) => handleOpenApi(request) } },
});
