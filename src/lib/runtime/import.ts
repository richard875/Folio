import { createHash } from "node:crypto";
import { mkdir, lstat, readFile } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { hashMatches } from "../../../reader/auth.ts";
import { validArticleFolder } from "../agent/articles.ts";
import { jobManager, validCallId } from "../batch/jobs.ts";
import { boundedBytes } from "./network.ts";
import { WorkLimit } from "./limits.ts";
import { writeNewFile } from "./storage.ts";

const limit = new WorkLimit(() => 1);
const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };

export function validImportPath(path: string): boolean {
  const article = /^output\/articles\/([^/]+)\/([A-Za-z0-9_-][A-Za-z0-9_.-]{0,230}\.(?:md|json|txt))$/.exec(path);
  if (article) return validArticleFolder(article[1]);
  if (/^output\/links\/links_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/.test(path)) return true;
  const job = /^output\/jobs\/([a-f0-9-]+)\.json$/i.exec(path);
  return Boolean(job && validCallId(job[1]));
}

/** Explicit, authenticated restoration into TEMPORARY storage. Never executes jobs. */
export async function handleImport(request: Request, root = process.cwd()): Promise<Response> {
  const url = new URL(request.url);
  const bearer = /^Bearer (.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!hashMatches(bearer ?? url.searchParams.get("hash"))) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const path = url.searchParams.get("path") || "";
  const checksum = request.headers.get("x-folio-sha256") || "";
  if (!validImportPath(path) || !/^[a-f0-9]{64}$/.test(checksum)) return Response.json({ error: "Invalid import path or checksum." }, { status: 400, headers });
  if (jobManager.isRunning) return Response.json({ error: "Wait for the active collection to finish before importing." }, { status: 409, headers });
  try {
    return await limit.run(async () => {
      const bytes = await boundedBytes(new Response(request.body), 8_000_000, request.signal);
      if (createHash("sha256").update(bytes).digest("hex") !== checksum) return Response.json({ error: "Checksum mismatch." }, { status: 400, headers });
      let content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      let normalizedJob = false;
      if (path.startsWith("output/jobs/")) {
        if (bytes.length > 4_000_000) return Response.json({ error: "Job record is too large." }, { status: 413, headers });
        const job = JSON.parse(content);
        if (job.callId !== path.slice(12, -5) || typeof job.startedAt !== "string" || !Number.isFinite(Date.parse(job.startedAt)) || !["in progress", "completed", "partial", "error"].includes(job.status)) return Response.json({ error: "Invalid job record." }, { status: 400, headers });
        if (job.status === "in progress" || !job.finishedAt) {
          Object.assign(job, { status: "error", phase: "finished", active: 0, finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), importSourceSha256: checksum, error: "Imported interrupted job. Start a new collection explicitly." });
          content = `${JSON.stringify(job, null, 2)}\n`;
          normalizedJob = true;
        }
      } else if (path.endsWith(".json")) JSON.parse(content.replace(/^\uFEFF/, ""));
      const destination = resolve(root, path);
      // Refuse symlink components, including pre-existing destination files.
      let component = resolve(root);
      for (const part of relative(root, destination).split(sep)) {
        component = resolve(component, part);
        try { if ((await lstat(component)).isSymbolicLink()) throw new Error("Unsafe destination"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      let alreadyExists = false;
      try { await writeNewFile(destination, content); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readFile(destination);
        const sameImport = normalizedJob && JSON.parse(existing.toString("utf8")).importSourceSha256 === checksum;
        if (!sameImport && createHash("sha256").update(existing).digest("hex") !== createHash("sha256").update(content).digest("hex")) return Response.json({ error: "A different file already exists. Nothing was overwritten." }, { status: 409, headers });
        alreadyExists = true;
      }
      return Response.json({ savedFile: path, alreadyExists, normalizedJob, temporary: true }, { headers });
    });
  } catch (error) {
    const busy = (error as { status?: number }).status === 429;
    const large = error instanceof Error && error.message === "Response too large";
    return Response.json({ error: busy ? "Import is busy. Retry later." : large ? "File exceeds 8 MB." : "Unable to import this file." }, { status: busy ? 429 : large ? 413 : 400, headers });
  }
}
