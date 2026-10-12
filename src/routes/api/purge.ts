import { createFileRoute } from "@tanstack/react-router";
import { hashMatches } from "@/lib/reader/auth";
import { rm, readdir, lstat } from "node:fs/promises";
import { resolve } from "node:path";

const headers = { "cache-control": "no-store" };

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const hash = url.searchParams.get("hash");
  if (!hashMatches(hash)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  const articlesRoot = resolve(process.cwd(), "output/articles");
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    const entries = await readdir(articlesRoot, { withFileTypes: true });
    const deleted: string[] = [];
    const kept: string[] = [];
    const errors: { folder: string; error: string }[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".")) continue;

      // Parse folder name to extract date: 2026-10-11_14-12 or 2026-10-11_22-10
      const match = /^(\d{4}-\d{2}-\d{2})_/.exec(entry.name);
      if (!match) continue;

      const folderDate = match[1];
      if (folderDate < todayStr) {
        const folderPath = resolve(articlesRoot, entry.name);
        try {
          await rm(folderPath, { recursive: true, force: true });
          deleted.push(entry.name);
        } catch (err) {
          errors.push({ folder: entry.name, error: err instanceof Error ? err.message : String(err) });
        }
      } else {
        kept.push(entry.name);
      }
    }

    return Response.json(
      {
        success: true,
        today: todayStr,
        deleted,
        kept,
        errors,
        deletedCount: deleted.length,
        keptCount: kept.length,
        errorCount: errors.length,
      },
      { headers }
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return Response.json(
        { success: true, today: todayStr, deleted: [], kept: [], errors: [], deletedCount: 0, keptCount: 0, errorCount: 0 },
        { headers }
      );
    }
    return Response.json(
      { error: "Unable to purge articles. Please try again later." },
      { status: 500, headers }
    );
  }
}

export const Route = createFileRoute("/api/purge")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});