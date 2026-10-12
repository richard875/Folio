import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, statfs, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Persist directory entries too, not just file contents, on the Linux target. */
export async function syncDirectory(directory: string): Promise<void> {
  if (process.platform !== "linux") return;
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Publish complete files atomically, without replacing an existing destination.
 * Hidden temporary files are never exposed by the agent's article listing. */
export async function writeNewFile(path: string, content: string): Promise<void> {
  if (Buffer.byteLength(content) > 8_000_000) throw new Error("Saved file exceeds its safety size limit.");
  if (process.env.NODE_ENV === "production") {
    const disk = await statfs(dirname(path), { bigint: true });
    if (disk.bavail * disk.bsize < 1_073_741_824n) {
      throw Object.assign(new Error("Storage is nearly full. Free space before saving more articles."), { status: 507 });
    }
  }
  const temporary = resolve(dirname(path), `.folio-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(content, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await link(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}
