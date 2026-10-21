# Folio API contract

All requests target the configured HTTPS root origin and append only query authentication `hash=FOLIO_ACCESS_HASH`. Never display, persist or log that authenticated URL. Returned navigation URLs are credential-free: validate origin and exact endpoint before adding authentication. Redirects are forbidden. Do not use arbitrary endpoints, publisher fetches, crawl, or `/api/collect`.

## Discovery

`GET /api/feed-catalog?q=canada&q=economy&limit=25`

- Omit `q` for enumeration; otherwise 1–12 literal strings, each 1–80 characters. Matching is case/accent-insensitive substring **OR** over catalog metadata, not full article text. It is not regex, semantic search, or an AND query.
- Optional repeated `publisher` values are exact names; `limit` is 1–100, default 25. Follow returned `nextUrl`/cursor without altering its query.
- Response: `schemaVersion:1`, `catalogVersion` (64 lowercase hex), `matchMode:"OR"`, `keywords`, `publishers:[{name,feedCount}]`, `inventoryCount`, `totalMatched`, `items`, `nextCursor`, `nextUrl`, `limits`.
- Each item: `feedId:"feed_" + 64 hex`, `publisher`, `section`, `url`, `ordering`, `format`, `isMain`, `description`, `descriptionSource:"catalog-label"`, `compatibility:"unverified"`, `matchedKeywords`, `matchedFields`, and possibly additional metadata. Labels are inventory metadata; descriptions derive from those labels, **not** publication-authored descriptions. No semantic alias expansion is performed. A broad inventory is not a guarantee a feed works.

`POST /api/feed-fetch`

```json
{"catalogVersion":"<64 hex from discovery>","selections":[{"feedId":"feed_<64 hex>","candidateLimit":10}]}
```

Strict body: 1–8 unique IDs, each candidate limit 1–20; sum at most 100. Use the matching catalog version. Response: `schemaVersion:1`, `catalogVersion`, `generatedAt`, `feedCount`, `failedFeedCount`, `candidateCount`, `uniqueCandidateCount`, `partial`, `feeds`.

Each feed has `feedId,publisher,section,url,requestedLimit,status`, optional `documentFormat`, `entryCount,eligibleCount,truncated,candidates,warnings` (string array), optional `httpStatus`. Status is `ok|empty|fetch_failed|parse_failed|deadline_exceeded|unsupported`. Candidates have `url,title,summary?`, `publishedAt` (ISO or null), `feedRank`. They are not full extracted articles. Do not turn absent dates into today's date.

`candidateLimit` is a ceiling on eligible candidate output, not a guarantee of
relevance or that many articles. Feeds are finite snapshots, not historical search.
Existing freshness filters reject dated non-editorial items older than **72 hours**;
editorial feeds allow **168 hours**. Dates over 24 hours ahead are rejected;
undated items can qualify. There is no `since`/archive/backfill override. A request
for "this week" can therefore yield only partial-week coverage; disclose the
actual dates and gaps rather than claiming a comprehensive weekly search.
On unsupported/empty results inspect warnings, choose another returned catalog
ID within the round budget or report a gap. Never invent IDs/URLs, override
compatibility, change format/domain allowlists, or bypass filtering.

Server work is bounded: 25-second network deadline (not a cold-start/CPU/end-to-end promise), concurrency 2 and one request per origin, 8 seconds per feed including shallow same-origin sitemap traversal, 2 MB per document, 16 MB and 80 transport requests overall, at most 3 child sitemaps per index and 10 distinct Google resolution attempts overall. Parsers reject malformed/unsupported documents and HTML error pages; RSS/Atom/RDF, news/plain sitemaps, JSON Feed and Reuters JSON use shared filtering. HTTP 200 may contain failed feeds/partial results. HTTP 400 invalid input; 401 authentication; 409 stale catalog (rediscover and reselect, no blind replay); 413 oversized; 429 busy (`Retry-After: 5`, wait explicitly). Topic discovery does not create persisted reports or jobs.

## Daily candidates

`POST /api/links` and `GET /api/links` both start a fresh collection and save a new report; neither reads an old report. The CLI uses POST. Daily collection uses only ten Main feeds, not the whole catalog. Reports are versioned JSON with `websites[].sections[].articles[]` containing `url` and optional `summary`; counters include `feedCount,failedFeedCount` and `savedFile`. HTTP 502 means all feeds failed. Do not replay legacy Markdown reports. Summaries are feed metadata, not proof of full article reading.

## Selected-article saving

`POST /api/save-batch` body:

```json
{"urls":[{"url":"https://publisher.example/story","website":"Publisher","section":"Economy"}],"format":"markdown"}
```

At most 100 articles. HTTP 202 returns `callId,statusEndpoint,...`. Follow only `/api/save-batch/status?callId=...` on the same origin, authenticating it yourself. `GET` status returns `in progress|completed|partial|error` plus counters and `results` with save status, `savedFile`, `partial`, and possible errors. Poll no faster than five seconds. The client does not retry POST or poll automatically. Lost response without ID means uncertain submission, not permission to submit again. Free Render sleep/restarts can lose files/jobs; no automatic replay or durable storage is promised.

## Saved-file reading

`GET /api/agent/latest` returns `folder,snapshotId,collections` (call IDs), `articleCount,articles,nextManifestUrl`, plus counters/readiness/warnings. Articles include `filename,characters,bytes,sha256,partial,readUrl`. Follow every manifest page, pinned by `folder` and `snapshot` query parameters. Unique filenames must equal `articleCount`. Verify a new job's call ID and saved files against its terminal status before trusting latest.

`GET /api/agent/read?folder=...&snapshot=...&file=...` returns `folder,snapshotId,filename,offset,nextOffset,text,chunkCharacters,totalCharacters,totalBytes,sha256,partial,endOfArticle,nextUrl`. Follow sequentially until `endOfArticle:true` and `nextUrl:null`; concatenate text **without trimming or normalization**. Count Unicode code points (Python `len`), UTF-8 bytes and SHA-256 against the manifest. On 409 discard the incomplete session; do not mix snapshots. `nextManifestUrl` must target exactly `/api/agent/latest`, article navigation exactly `/api/agent/read`. Reject cross-origin URLs, credentials, fragments, hash parameters, unexpected paths/queries, changed pins, loops and unsafe filenames.

Reading all saved files with valid checksums is distinct from successful complete publisher extraction. Preserve partial flags and collection failures in the final answer.
