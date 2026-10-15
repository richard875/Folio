import { createFileRoute } from "@tanstack/react-router";
import { hashMatches } from "@reader/auth";
import { rm, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jobManager } from "@/lib/batch/jobs";
import { validArticleFolder } from "@/lib/agent/articles";

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
    // Never remove the start-minute folder of a job that crosses UTC midnight.
    if (jobManager.isRunning) {
      return Response.json({ error: "A collection is running. Retry after it finishes." }, { status: 409, headers });
    }
    const jobsRoot = resolve(process.cwd(), "output/jobs");
    const jobs = await readdir(jobsRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of jobs) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      if (JSON.parse(await readFile(resolve(jobsRoot, entry.name), "utf8")).status === "in progress") {
        return Response.json({ error: "Unfinished collection records exist. Restart Folio before purging." }, { status: 409, headers });
      }
    }
    const entries = await readdir(articlesRoot, { withFileTypes: true });
    const deleted: string[] = [];
    const kept: string[] = [];
    const errors: { folder: string; error: string }[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (!validArticleFolder(entry.name)) continue;

      // Parse folder name to extract date: 2026-10-11_14-12 or 2026-10-11_22-10
      const match = /^(\d{4}-\d{2}-\d{2})_/.exec(entry.name);
      if (!match) continue;

      const folderDate = match[1];
      if (folderDate < todayStr) {
        const folderPath = resolve(articlesRoot, entry.name);
        try {
          await rm(folderPath, { recursive: true, force: true });
          deleted.push(entry.name);
        } catch {
          errors.push({ folder: entry.name, error: "Unable to remove this article folder." });
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
      GET: ({ request }) => hashMatches(new URL(request.url).searchParams.get("hash"))
        ? Response.json({ error: "Use POST for destructive operations." }, { status: 405, headers: { ...headers, allow: "POST" } })
        : Response.json({ error: "Unauthorized" }, { status: 401, headers }),
      POST: ({ request }) => handle(request),
    },
  },
});
