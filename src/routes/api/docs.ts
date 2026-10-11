import { createFileRoute } from "@tanstack/react-router";
import { handleSwaggerDocs } from "@/lib/swagger/docs";

export const Route = createFileRoute("/api/docs")({
  server: { handlers: { GET: ({ request }) => handleSwaggerDocs(request) } },
});
