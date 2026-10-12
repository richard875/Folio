import { productionConfig, prepareProduction } from "./production-config.mjs";
import { createServer } from "node:net";
import { getHeapStatistics } from "node:v8";

let reservation;
try {
  const config = productionConfig(process.env);
  if (getHeapStatistics().heap_size_limit > 2300 * 1024 * 1024) throw new Error("Start Folio with --max-old-space-size=2048 (use npm start or the supplied service).");
  // Refuse a duplicate launch before touching another process's active job records.
  // Reject probes during preflight rather than retaining sockets that would
  // prevent reservation.close() from finishing when the real server starts.
  reservation = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen({ host: config.host, port: Number(config.port), exclusive: true }, resolve);
  });
  process.env.NODE_ENV = "production";
  process.env.HOST = process.env.NITRO_HOST = config.host;
  process.env.PORT = process.env.NITRO_PORT = config.port;
  const recovered = await prepareProduction(process.cwd());
  console.info(JSON.stringify({ event: "folio_start", recoveredJobs: recovered, heapLimitBytes: getHeapStatistics().heap_size_limit }));
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  reservation = undefined;
  // The CLI applies the 2 GiB heap limit before this script runs.
  await import("../.output/server/index.mjs");
} catch (error) {
  if (reservation?.listening) reservation.close();
  console.error("Folio startup failed:", error instanceof Error ? error.message : "Invalid production configuration.");
  process.exitCode = 1;
}
