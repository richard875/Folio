const string = { type: "string" };
const integer = { type: "integer", minimum: 0 };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (description: string, schema: Record<string, unknown>) => ({ description, content: { "application/json": { schema } } });
const error = (description: string) => json(description, ref("Error"));
const repeated = (name: string, description: string, maximum: number) => ({ name, in: "query", description, style: "form", explode: true, schema: { type: "array", maxItems: maximum, items: { ...string, minLength: 1, maxLength: 80 } } });

export const feedPaths = {
  "/api/feed-catalog": {
    get: {
      tags: ["RSS"], operationId: "discoverFeeds", summary: "Discover feed sources with OR keywords",
      description: "Network-free discovery over all publisher inventories, including reference feeds. Repeat q for case/accent-insensitive literal substring OR matching over publisher, section and derived description. Omit q to enumerate all feeds. Publisher filters are exact names (case-insensitive), combined with keyword matches. Descriptions derive from catalog labels, not verified publisher claims. Follow credential-free nextUrl with hash added on every request. Feed IDs are stable; changed catalog/cursor requires fresh discovery. Daily /api/links and /api/collect remain Main-feed-only.",
      parameters: [repeated("q", "Up to 12 keywords/phrases, e.g. q=canada&q=economy&q=economics. Any keyword may match; not semantic search.", 12), repeated("publisher", "Up to ten publisher names; any listed publisher may match.", 10), { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }, { name: "cursor", in: "query", description: "Follow nextUrl without changing filters/limit.", schema: string }],
      responses: { "200": json("Catalog page, stable IDs, version and limits.", ref("FeedCatalogPage")), "400": error("Invalid query or cursor."), "401": error("Missing or incorrect hash."), "409": error("Catalog changed; restart discovery."), "500": error("Unable to discover feeds.") },
    },
  },
  "/api/feed-fetch": {
    post: {
      tags: ["RSS"], operationId: "fetchSelectedFeeds", summary: "Fetch candidates from explicitly selected catalog feeds",
      description: "Synchronous metadata-only fetch; no article extraction, saving or automatic fallback. Select 1–8 unique feed IDs at the discovered catalogVersion, each with 1–20 candidates; summed requested limits at most 100. Counts are candidate ceilings, not relevance guarantees. Claude selects topical articles. Request network deadline 25 seconds after application entry; each feed has 8 seconds, concurrency two and one request per origin, no retries. Documents bounded to 2 MB/2000 entries; at most 16 MB/80 transport requests overall. Detects RSS, Atom, RDF, news/plain sitemap, JSON Feed and Reuters JSON regardless of filename/MIME. Sitemap indexes consider at most three unique same-origin children, never recursively. Resolve at most ten distinct Google wrappers; unresolved wrappers omitted. Existing publisher/media/freshness policies remain. HTTP 200 includes per-feed failures and warnings. No report file or job. Shares feed admission with /api/links (429 when busy).",
      requestBody: { required: true, content: { "application/json": { schema: ref("SelectedFeedRequest") } } },
      responses: { "200": json("Candidate pools and per-feed outcomes, including partial failures.", ref("SelectedFeedResponse")), "400": error("Invalid JSON, IDs, limits or parameters."), "401": error("Missing or incorrect hash."), "409": error("Stale catalog version; rediscover."), "413": error("Body exceeds 16384 bytes or takes over three seconds."), "429": { ...error("Feed collection busy."), headers: { "Retry-After": { schema: { type: "string", example: "5" } } } }, "500": error("Unable to fetch selected feeds.") },
    },
  },
};

export const feedSchemas = {
  FeedCatalogItem: {
    type: "object", required: ["feedId", "publisher", "section", "url", "ordering", "format", "isMain", "description", "descriptionSource", "compatibility", "matchedKeywords", "matchedFields"],
    properties: {
      feedId: { ...string, pattern: "^feed_[a-f0-9]{64}$" }, publisher: string, section: string, url: { ...string, format: "uri" },
      ordering: { ...string, enum: ["editorial", "newest", "google-ranked", "feed"] }, format: { ...string, enum: ["rss", "news-sitemap"] },
      edition: string, homepageScore: { type: "number", minimum: 0, maximum: 10 }, isMain: { type: "boolean" }, description: string,
      descriptionSource: { ...string, enum: ["catalog-label"] }, compatibility: { ...string, enum: ["unverified"] }, matchedKeywords: { type: "array", items: string }, matchedFields: { type: "array", items: string },
    },
  },
  FeedCatalogPage: {
    type: "object", required: ["schemaVersion", "catalogVersion", "matchMode", "keywords", "publishers", "inventoryCount", "totalMatched", "items", "nextCursor", "nextUrl", "limits"],
    properties: {
      schemaVersion: { type: "integer", enum: [1] }, catalogVersion: { ...string, pattern: "^[a-f0-9]{64}$" }, matchMode: { ...string, enum: ["OR"] }, keywords: { type: "array", items: string },
      publishers: { type: "array", items: { type: "object", required: ["name", "feedCount"], properties: { name: string, feedCount: integer } } }, inventoryCount: integer, totalMatched: integer,
      items: { type: "array", items: ref("FeedCatalogItem") }, nextCursor: { ...string, nullable: true }, nextUrl: { ...string, nullable: true }, limits: { type: "object", additionalProperties: { type: "integer" } },
    },
  },
  SelectedFeedRequest: {
    type: "object", additionalProperties: false, required: ["catalogVersion", "selections"],
    properties: { catalogVersion: { ...string, pattern: "^[a-f0-9]{64}$" }, selections: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["feedId", "candidateLimit"], properties: { feedId: { ...string, pattern: "^feed_[a-f0-9]{64}$" }, candidateLimit: { type: "integer", minimum: 1, maximum: 20 } } } } },
  },
  SelectedFeedResponse: {
    type: "object", required: ["schemaVersion", "catalogVersion", "generatedAt", "feedCount", "failedFeedCount", "candidateCount", "uniqueCandidateCount", "partial", "feeds"],
    properties: {
      schemaVersion: { type: "integer", enum: [1] }, catalogVersion: string, generatedAt: { ...string, format: "date-time" }, feedCount: integer, failedFeedCount: integer, candidateCount: integer, uniqueCandidateCount: integer, partial: { type: "boolean" },
      feeds: { type: "array", items: { type: "object", required: ["feedId", "publisher", "section", "url", "requestedLimit", "status", "entryCount", "eligibleCount", "truncated", "candidates", "warnings"], properties: {
        feedId: string, publisher: string, section: string, url: { ...string, format: "uri" }, requestedLimit: integer,
        status: { ...string, enum: ["ok", "empty", "fetch_failed", "parse_failed", "deadline_exceeded", "unsupported"] }, documentFormat: { ...string, enum: ["rss", "atom", "rdf", "news-sitemap", "sitemap", "sitemap-index", "json-feed", "reuters-json"] },
        httpStatus: integer, entryCount: integer, eligibleCount: integer, truncated: { type: "boolean" }, warnings: { type: "array", items: string },
        candidates: { type: "array", items: { type: "object", required: ["url", "title", "publishedAt", "feedRank"], properties: { url: { ...string, format: "uri" }, title: { ...string, maxLength: 500 }, summary: { ...string, maxLength: 1000 }, publishedAt: { ...string, format: "date-time", nullable: true }, feedRank: { type: "integer", minimum: 1 } } } },
      } } },
    },
  },
};
