import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/healthz")({
  server: { handlers: { GET: () => new Response("ok\n", { headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } }) } },
});
