import { createFileRoute } from "@tanstack/react-router";
import css from "swagger-ui-dist/swagger-ui.css?raw";
import js from "swagger-ui-dist/swagger-ui-bundle.js?raw";
import { handleSwaggerAsset } from "@/lib/swagger/docs";

export const Route = createFileRoute("/api/docs/assets")({
  server: { handlers: { GET: ({ request }) => handleSwaggerAsset(request, { css, js }) } },
});
