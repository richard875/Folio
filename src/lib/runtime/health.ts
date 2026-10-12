import { randomUUID } from "node:crypto";
import { open, statfs, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { hashMatches } from "../reader/auth.ts";

export async function handleHealth(request: Request, root = process.cwd()): Promise<Response> {
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  const bearer = /^Bearer (.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!hashMatches(bearer ?? new URL(request.url).searchParams.get("hash"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  try {
    const directory = resolve(root, "output/jobs");
    const disk = await statfs(directory, { bigint: true });
    const available = disk.bavail * disk.bsize;
    if (available < 1_073_741_824n) throw new Error("storage");
    const path = resolve(directory, `.folio-${randomUUID()}.tmp`);
    const handle = await open(path, "wx", 0o600);
    try { await handle.writeFile("health"); } finally { await handle.close(); await unlink(path); }
    const memory = process.memoryUsage();
    return Response.json({
      status: "ready", uptimeSeconds: Math.floor(process.uptime()),
      memoryBytes: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external },
      storageAvailableBytes: Number(available),
    }, { headers });
  } catch {
    return Response.json({ status: "unavailable", error: "Persistent storage is unavailable or nearly full." }, { status: 503, headers });
  }
}
