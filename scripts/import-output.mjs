// Usage: ACCESS_HASH supplied through the environment, never a CLI argument.
// node --env-file-if-exists=.env scripts/import-output.mjs SOURCE_OUTPUT HTTPS_ORIGIN
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

const [source, target] = process.argv.slice(2);
if (!source || !target || process.argv.length !== 4 || !process.env.ACCESS_HASH) throw new Error("Supply SOURCE_OUTPUT and HTTPS_ORIGIN; set ACCESS_HASH in the environment.");
const origin = new URL(target);
if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) throw new Error("Use an HTTPS origin without credentials, query, or path.");
const root = resolve(source);
if ((await lstat(root)).isSymbolicLink()) throw new Error("Source must not be a symlink.");
let imported = 0;
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await visit(path); continue; }
    if (!entry.isFile()) continue;
    const savedPath = `output/${relative(root, path).split(sep).join("/")}`;
    if (!/^output\/(?:articles|links|jobs)\//.test(savedPath)) continue;
    if (savedPath.startsWith("output/links/") && !/^output\/links\/links_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/.test(savedPath)) {
      console.warn("Skipped a legacy or unsupported link report; only JSON link reports can be imported. Source files are unchanged.");
      continue;
    }
    if ((await lstat(path)).size > 8_000_000) throw new Error("A source file exceeds 8 MB. No files were removed.");
    const bytes = await readFile(path);
    const url = new URL("/api/import", origin);
    url.searchParams.set("path", savedPath);
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(120000), body: bytes,
      headers: { authorization: `Bearer ${process.env.ACCESS_HASH}`, "content-type": "application/octet-stream", "x-folio-sha256": createHash("sha256").update(bytes).digest("hex") },
    });
    if (!response.ok) throw new Error(`Import stopped with HTTP ${response.status}. Existing files and source history were retained.`);
    const result = await response.json();
    if (result.savedFile !== savedPath || result.temporary !== true) throw new Error("Import did not return a valid acknowledgement. Warm the service and retry.");
    imported++;
  }
}
await visit(root);
console.log(JSON.stringify({ imported, temporary: true, warning: "Imported history is lost on Render sleep, restart or redeploy. Keep the original archive." }));
