import { timingSafeEqual } from "node:crypto";

/** Query param `hash` must match the server-only ACCESS_HASH environment variable. */
export function hashMatches(given: string | null | undefined): boolean {
  const accessHash = process.env.ACCESS_HASH;
  if (!given || !accessHash) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(accessHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
