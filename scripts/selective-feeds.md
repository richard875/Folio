# Interactive topic news: discover, fetch, then select

Folio performs deterministic discovery/fetching; the external AI interprets the
topic, chooses feeds, evaluates candidates and produces the answer. No server AI,
accounts, database or scheduler is involved. The existing ten Main feeds remain
the **only** sources for GET/POST `/api/links` and `/api/collect`. Only the explicit
`/api/feed-fetch` operation can fetch a selected subset of the reference inventory.

## Discover with OR keywords

```text
GET /api/feed-catalog?hash=<ACCESS_HASH>&q=canada&q=economy&q=economics&limit=25
```

Generate several keywords, synonyms and related concepts before calling. Repeat
`q` (at most 12, each 1–80 characters); a literal case/accent-insensitive substring
match to **any** keyword qualifies a record. Matching fields are publisher,
section and description. Phrases are literal; commas/spaces do not implicitly
split into more keywords. There is no semantic search or article-body search.
Repeat `publisher` for exact publisher-name filters; OR within publishers, AND
between the publisher filter and keyword results. Omit `q` to enumerate everything.

The response includes `schemaVersion`, `catalogVersion`, `matchMode: "OR"`,
normalized `keywords`, all `publishers` with counts, `inventoryCount`,
`totalMatched`, `items`, `nextCursor`, `nextUrl`, and execution `limits`.
Each item contains `feedId`, `publisher`, `section`, `url`, declared `ordering`
and `format`, `isMain`, optional `edition`/`homepageScore`, `description`,
`descriptionSource`, `compatibility`, `matchedKeywords` and `matchedFields`.

Descriptions derive from catalog labels (`descriptionSource: "catalog-label"`),
not publisher-authored descriptions. `compatibility: "unverified"` is honest:
inventory membership is no availability/freshness/extraction guarantee. Edition
does not identify coverage geography or reliably identify language.

Discovery performs no publisher requests. Pages default to 25, maximum 100.
Follow `nextUrl` until null when full enumeration is needed; re-add `hash` on
every request. Returned URLs intentionally omit credentials. Cursors bind the
catalog version, filters and page size. Invalid cursors return 400; changed
catalogs return 409: rediscover from page one. IDs derive from publisher, section
and normalized full URL, never array positions. Metadata changes update the
catalog version; identity changes produce a different ID. These are not secrets.

## Fetch explicit selections

```text
POST /api/feed-fetch?hash=<ACCESS_HASH>
Content-Type: application/json
```

```json
{
  "catalogVersion": "<copy from discovery>",
  "selections": [
    { "feedId": "<copy first feedId>", "candidateLimit": 15 },
    { "feedId": "<copy second feedId>", "candidateLimit": 5 }
  ]
}
```

IDs/version must come from discovery; placeholders above are not valid IDs.
Select 1–8 unique IDs, each requesting 1–20 candidates, sum at most 100. Bodies
are strict, at most 16,384 bytes with a three-second read deadline. Arbitrary
URLs, headers, proxies, retry settings and other overrides are rejected before
transport. Unknown IDs/invalid input return 400, stale version 409, oversized/slow
body 413, unauthorized 401. No Bearer header is required or accepted by these
two new endpoints: use the `hash` query parameter.

The synchronous response contains `schemaVersion`, `catalogVersion`,
`generatedAt`, `feedCount`, `failedFeedCount`, `candidateCount`,
`uniqueCandidateCount`, `partial`, and `feeds`. Each feed has its identity,
`requestedLimit`, `status`, detected `documentFormat` when available,
`entryCount`, `eligibleCount`, `truncated`, `warnings`, optional `httpStatus`,
and `candidates` with `url`, `title`, optional `summary`, nullable ISO
`publishedAt`, and original 1-based `feedRank`.

`candidateCount` counts entries across feed pools; `uniqueCandidateCount`
deduplicates URLs across them. Duplicate coverage preserves feed provenance;
deduplicate before saving. `eligibleCount` is after initial parsing/filtering,
before final Google resolution/deduplication. Limits are ceilings, not guarantees
of relevance, quantity, or full article text. `truncated` also marks bounded
sitemap traversal or candidate omissions, not an RSS pagination promise.

HTTP 200 includes per-feed `ok`, `empty`, `fetch_failed`, `parse_failed`,
`deadline_exceeded`, or `unsupported` outcomes. Check all statuses and warnings;
`partial` reports failures/warnings, not an article extraction quality flag.
An empty pool may reflect existing publisher-domain, media or freshness filters;
it does not establish that a publisher has no news on the topic. Do not silently
expand publisher allowlists to accommodate partner/sister-publication feeds.

### Formats and bounds

Content detection supports RSS 2, Atom, RSS 1/RDF, news sitemaps, plain URL
sitemaps, JSON Feed 1/1.1 and Reuters `result.articles` JSON. Declared format,
MIME and extension do not override content detection (CNBC `.html` can be XML).
JSON/XML use the same article/media/domain/freshness filters. HTML error pages,
unknown JSON, malformed XML, DTD/entities and oversized payloads fail explicitly;
there is no JS/browser execution or generic HTML scraping fallback.

Sitemap indexes consider at most the first three unique same-origin child URLs
in document order, non-recursively, with at most 2000 combined child entries.
Omissions/failures are warnings. This is not exhaustive sitemap crawling.
Each document is bounded to 2,000,000 decompressed bytes and 2000 entries.
Feed fetching has an eight-second allowance including child traversal; the
request-wide network deadline is 25 seconds. Parsing is size/entry bounded,
not preemptible JavaScript; cold start and proxy/platform time add latency.
Concurrency is two, with one request per origin at a time (including redirects).
The whole operation reserves at most 16 MB of response bodies across at most
80 transport requests, including redirects, index children and Google resolution.
No retries. At most
ten distinct Google article wrappers are resolved under the same request deadline;
failed/unresolved wrappers are never returned as publisher article URLs.

Selective fetching and daily links share a process-wide admission slot; overload
returns 429 with `Retry-After: 5`, not an unbounded queue. Existing transport
retains DNS/IP/public-network validation, TLS, configured proxies and bounded
redirects; no silent direct fallback. Results are private/non-cacheable and
create **no report file, article save, or background job**. A lost response may
be fetched again deliberately (new network cost), but is not recoverable as a job.

## Agent strategy and downstream workflow

For Canadian economy, combine Canada-focused and economy/economics feeds from a
small diverse publisher set. Fetch enough candidates to avoid hiding a topic
match behind unrelated top items. Inspect titles/summaries/dates, not invented
metadata. A bounded second discovery/fetch round is appropriate when coverage is
thin; do not sweep all inventory sources. Increasing counts does not recover
articles absent from the finite feed. Dated non-editorial candidates retain the
72-hour horizon; editorial feeds get 168 hours; undated articles can qualify.

Select relevant canonical URLs, then use the existing [save-batch](save-articles.md)
and [verified agent reading](agent-reader.md) operations with query-hash
authentication. Retain the batch ID and check successful saved files against the
latest manifest. Latest is still the latest finished folder, not a topic-specific
job lookup; no new locator is necessary. Read every listed file, pin the snapshot
and verify all chunks/checksums. Summarize only supported full text, disclose
partial extraction, unverified recency, failures and coverage gaps. Render's
temporary storage is not durable or automatically replayed.

The portable [Folio news skill](../docs/skills/folio-news/README.md) includes
instructions, API references and a standard-library Python client for Claude.
Skills supply knowledge/code, not network permissions: ordinary Claude chat
still requires code execution and allowed HTTP access to the Folio origin.
