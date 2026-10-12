import { createFileRoute } from "@tanstack/react-router";
import { handleSwaggerDocs } from "@/lib/swagger/docs";
import small from "swagger-ui-dist/favicon-16x16.png?inline";
import large from "swagger-ui-dist/favicon-32x32.png?inline";

export const Route = createFileRoute("/api/docs")({
  server: { handlers: { GET: ({ request }) => handleSwaggerDocs(request, { small, large }) } },
});
