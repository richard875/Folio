import { constants } from "node:fs";
import { access, mkdir, open, readdir, rename, statfs, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

export function productionConfig(env) {
  if (!env.ACCESS_HASH || env.ACCESS_HASH.trim().length < 32 || env.ACCESS_HASH.startsWith("REPLACE_WITH_")) {
    throw new Error("ACCESS_HASH must contain at least 32 characters. Generate a random secret before starting production.");
  }
  if (env.DATABASE_URL?.trim()) throw new Error("This file-backed Folio deployment does not use DATABASE_URL. Remove it.");
  if (env.NITRO_UNIX_SOCKET || env.NITRO_SSL_CERT || env.NITRO_SSL_KEY) throw new Error("Use the configured loopback HTTP listener behind Caddy, not Nitro socket/TLS overrides.");
  const host = env.HOST || "0.0.0.0";
  if (!["0.0.0.0", "127.0.0.1"].includes(host)) throw new Error("Unsupported HOST.");
  const port = env.PORT || "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Use an unprivileged valid PORT (default 3000).");
  for (const [key, minimum, maximum] of [
    ["READ_CONCURRENCY", 1, 10], ["SAVE_CONCURRENCY", 1, 10],
    ["FETCH_RETRY_LIMIT", 0, 10], ["RSS_LINKS_PER_SECTION", 1, 100],
    ["FEED_CONCURRENCY", 1, 6],
  ]) {
    if (env[key] !== undefined && (!/^\d+$/.test(env[key]) || Number(env[key]) < minimum || Number(env[key]) > maximum)) {
      throw new Error(`${key} must be ${minimum}–${maximum}.`);
    }
  }
  if (env.NODE_OPTIONS && env.NODE_OPTIONS !== "--max-old-space-size=256 --max-semi-space-size=16") throw new Error("Use the documented Render heap and semi-space limits in NODE_OPTIONS.");
  return { host, port };
}

/** Run before accepting requests, including after an OOM kill or power interruption. */
export async function prepareProduction(root) {
  await access(resolve(root, ".output/server/index.mjs"), constants.R_OK);
  for (const name of ["articles", "links", "jobs"]) {
    const directory = resolve(root, "output", name);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = resolve(directory, `.folio-${randomUUID()}.tmp`);
    const handle = await open(path, "wx", 0o600);
    try { await handle.writeFile("storage probe"); await handle.sync(); }
    finally { await handle.close(); await unlink(path); }
  }
  const disk = await statfs(resolve(root, "output"), { bigint: true });
  if (disk.bavail * disk.bsize < 67_108_864n) throw new Error("Less than 64 MiB of temporary storage is available.");
  const directory = resolve(root, "output/jobs");
  let recovered = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!/^[a-f0-9-]{36}\.json$/i.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let job;
    try {
      if ((await handle.stat()).size > 4_000_000) throw new Error("A job record exceeds its safety size limit.");
      job = JSON.parse(await handle.readFile("utf8"));
    } finally { await handle.close(); }
    if (job.status !== "in progress") continue;
    Object.assign(job, {
      status: "error", phase: "finished", active: 0,
      error: "The server restarted before this operation finished. Start a new collection.",
      updatedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    });
    const temporary = resolve(directory, `.folio-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(`${JSON.stringify(job, null, 2)}\n`); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, path);
      if (process.platform === "linux") {
        const handle = await open(directory, constants.O_RDONLY);
        try { await handle.sync(); } finally { await handle.close(); }
      }
    } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
    recovered++;
  }
  return recovered;
}
