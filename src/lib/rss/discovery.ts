import { createHash } from "node:crypto";
import { validateFeedCatalog } from "./catalog.ts";

export const SELECTIVE_LIMITS = Object.freeze({
  maxFeeds: 8, maxCandidatesPerFeed: 20, maxCandidates: 100,
  concurrency: 2, requestTimeoutMs: 25_000, feedTimeoutMs: 8_000,
  maximumBytes: 2_000_000, maxChildSitemaps: 3, maxGoogleResolutions: 10,
  maxResponseBytes: 16_000_000, maxOutboundRequests: 80,
});
export class FeedRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Stable identity is independent of inventory position and descriptive metadata. */
export function createFeedCatalog(inventory: unknown) {
  const records = validateFeedCatalog(inventory).map((feed) => ({
    ...feed,
    feedId: `feed_${digest([feed.site, feed.section, feed.url])}`,
    publisher: feed.site,
    isMain: feed.section === "Main feed",
    description: `${feed.site} — ${feed.section}. Catalog label; availability and article extraction are unverified.`,
    descriptionSource: "catalog-label" as const,
    compatibility: "unverified" as const,
  })).sort((a, b) => a.feedId < b.feedId ? -1 : a.feedId > b.feedId ? 1 : 0);
  const catalogVersion = digest(records);
  const byId = new Map(records.map((record) => [record.feedId, record]));
  return { records, catalogVersion, byId };
}
export type DiscoveryCatalog = ReturnType<typeof createFeedCatalog>;
export type FeedRecord = DiscoveryCatalog["records"][number];

export function discoverFeeds(url: URL, catalog: DiscoveryCatalog) {
  const query = url.searchParams;
  if (url.search.length > 8192 || [...query.keys()].some((key) => !["hash", "q", "publisher", "limit", "cursor"].includes(key)) ||
      ["hash", "limit", "cursor"].some((key) => query.getAll(key).length > 1))
    throw new FeedRequestError(400, "Invalid catalog query parameters.");
  function values(key: string, maximum: number) {
    const raw = query.getAll(key);
    if (raw.length > maximum || raw.some((value) => !value.trim() || value.length > 80))
      throw new FeedRequestError(400, `Use at most ${maximum} nonempty ${key} values of up to 80 characters.`);
    return [...new Set(raw.map((value) => normalize(value.trim())))].sort();
  }
  const keywords = values("q", 12);
  const publishers = values("publisher", 10);
  const limitText = query.get("limit") ?? "25";
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new FeedRequestError(400, "Catalog limit must be 1–100.");
  const knownPublishers = [...new Set(catalog.records.map(({ publisher }) => publisher))].sort();
  if (publishers.some((publisher) => !knownPublishers.some((known) => normalize(known) === publisher)))
    throw new FeedRequestError(400, "Unknown publisher. Use a publisher name from the catalog response.");
  const matches = catalog.records.flatMap((record) => {
    if (publishers.length && !publishers.includes(normalize(record.publisher))) return [];
    const fields = { publisher: record.publisher, section: record.section, description: record.description };
    const matchedKeywords = keywords.filter((keyword) => Object.values(fields).some((value) => normalize(value).includes(keyword)));
    if (keywords.length && !matchedKeywords.length) return [];
    const matchedFields = Object.entries(fields).filter(([, value]) => keywords.some((keyword) => normalize(value).includes(keyword))).map(([key]) => key);
    const { site: _site, ...item } = record;
    return [{ ...item, matchedKeywords, matchedFields }];
  });
  const scope = digest([keywords, publishers, limit]);
  let offset = 0;
  const cursor = query.get("cursor");
  if (cursor !== null) {
    try {
      if (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (decoded.version !== catalog.catalogVersion)
        throw new FeedRequestError(409, "Catalog changed. Restart discovery without a cursor.");
      if (decoded.scope !== scope || !Number.isSafeInteger(decoded.offset) || decoded.offset < 1 || decoded.offset >= matches.length) throw new Error();
      offset = decoded.offset;
    } catch (error) {
      if (error instanceof FeedRequestError) throw error;
      throw new FeedRequestError(400, "Invalid cursor. Follow nextUrl without changing filters or limit.");
    }
  }
  const nextOffset = Math.min(offset + limit, matches.length);
  const nextCursor = nextOffset < matches.length
    ? Buffer.from(JSON.stringify({ version: catalog.catalogVersion, scope, offset: nextOffset })).toString("base64url") : null;
  const nextQuery = new URLSearchParams();
  keywords.forEach((value) => nextQuery.append("q", value));
  publishers.forEach((value) => nextQuery.append("publisher", value));
  nextQuery.set("limit", String(limit));
  if (nextCursor) nextQuery.set("cursor", nextCursor);
  return {
    schemaVersion: 1, catalogVersion: catalog.catalogVersion, matchMode: "OR",
    keywords, publishers: knownPublishers.map((name) => ({ name, feedCount: catalog.records.filter((record) => record.publisher === name).length })),
    inventoryCount: catalog.records.length, totalMatched: matches.length,
    items: matches.slice(offset, nextOffset), nextCursor,
    nextUrl: nextCursor ? `/api/feed-catalog?${nextQuery}` : null,
    limits: SELECTIVE_LIMITS,
  };
}
