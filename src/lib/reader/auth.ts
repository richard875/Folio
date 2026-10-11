import { timingSafeEqual } from "node:crypto";

/** Shared secret. Query param `hash` must match. Server-only. */
export const ACCESS_HASH = "<REMOVED_ACCESS_HASH>";

export function hashMatches(given: string | null | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(ACCESS_HASH);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
