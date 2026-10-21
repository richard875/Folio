# RSS article links API

The basic read/save/feed operations are available over HTTP:

- `GET /api/read?url=…&hash=…` — read an article.
- `GET /api/save?url=…&hash=…` — read and save an article.
- `GET /api/links?hash=…` — collect RSS article links, save a report, and return JSON.

`/api/links` also accepts POST with the same query parameters. Prefer POST when
triggering a collection, since it creates a file. Every endpoint uses the
`ACCESS_HASH` secret. Links reports are JSON only; omit `format` or use `format=json`.
Other formats return HTTP 400 before collection. `X-Saved-File` supplies the saved path.
Article read/save endpoints retain their separate Markdown/JSON format options.
GET and POST share the same handler, parameters, lock and response format; the
request body is ignored. Both start a fresh collection, not a read of an existing
report. There is no API to list/read old link reports or save their articles by filename.

Reports are stored in `output/links/links_YYYY-MM-DD_HH-mm-ss.json`. Timestamps are
UTC. Existing files are never overwritten. The file and response share this schema:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-19T12:00:00.000Z",
  "savedFile": "output/links/links_2026-10-19_12-00-00.json",
  "limit": 5,
  "feedCount": 1,
  "failedFeedCount": 0,
  "linkCount": 1,
  "websites": [
    {
      "name": "Example News",
      "sections": [
        {
          "name": "Main feed",
          "available": true,
          "articles": [
            { "url": "https://example.com/story", "summary": "Optional feed-provided excerpt." }
          ]
        }
      ]
    }
  ]
}
```

`summary` is omitted when unavailable. For Bloomberg and Business Insider news sitemaps,
`news:title` supplies `summary` (even for short/headline-only text), capped at
1,000 characters; empty titles are omitted. Other sitemaps are unchanged.
Reuters' Google News RSS feed uses HTML `description` text as `summary`, even
when short or headline-only. Tags/active content are removed, entities decoded,
and whitespace normalized; publisher text is retained. Empty descriptions are
omitted and the 1,000-character cap applies. Other feeds keep their normal filters.
`available` is false if any feed in the section failed; an available empty section
has no eligible articles. `linkCount`
counts the actual deduplicated, capped article entries. Feed counts count sources,
not sections. Array order preserves selection order. The shared runtime schema in
`src/lib/rss/report.ts` validates reads, writes and imports, including version,
counts, URLs and summary limits. Reports contain no rendered Markdown or duplicate
URL-only arrays. Background jobs read these JSON groups to create saving tasks.

Example configuration (substitute a private random key of at least 32 characters
for production). Configure the server environment or an existing ignored `.env`,
then restart; see [environment loading](../deployment.md#local-release-verification):

```env
ACCESS_HASH=YOUR_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS
RSS_LINKS_PER_SECTION=5
FETCH_RETRY_LIMIT=2
```

The link limit accepts 1–100 and defaults to 5 unique articles per subsection,
after filtering/ranking. Invalid limits fall back to 5 in the collector;
production startup rejects explicitly invalid settings. Feed retries accept 0–10,
defaulting to 5 when unset/invalid in the collector; the example explicitly uses 2.
Retries count attempts after the initial request; 0 disables retries. Existing
environment variables override `.env`. Article retrieval has separate retry caps.

The ten publisher JSON files under `data/` are bundled through
`src/lib/rss/sources.ts`. Changes require rebuilding/restarting production;
the deployed server does not need source attachments at runtime.
The stored inventory has 1731 entries (36 WSJ, 714 NY Times, 50 Washington Post,
61 Bloomberg, 64 Economist, 427 Financial Times, 65 Foreign Policy, 104 CNBC, 81 Reuters and 129 Business Insider feeds/sitemaps), but **only the ten
`Main feed` entries are selected before any fetching or ranking**, one per publisher.
The other 1544 entries are inactive reference data, never used as fallback sources.
Bloomberg's Main feed remains its latest-news sitemap, not the stored all-news RSS feed.
Missing/duplicate mains fail closed. GET and POST, and background `/api/collect`,
share this policy; query parameters/body cannot opt into reference feeds.
A limit of 1 yields at most ten article entries; the default of 5 permits at most 50.
Retries and Google resolution may produce more than ten outbound requests.
See the [catalog inventory and caveats](../data/README.md). Invalid JSON entries are rejected rather than
silently skipped. Markdown table inputs and prose inference are no longer supported.

Feed concurrency defaults to two (configurable up to six), with a 15-second per-attempt timeout.
One collection can run per server process. An overlapping request returns 409.
Collection runs only when requested; the server does not automatically poll.
Large collections can take several minutes; clients and reverse proxies need
appropriate request timeouts. Failed feeds are marked without discarding the
others. If all feeds fail, the report is still saved and returned with HTTP 502.
Write/configuration failures return HTTP 500, and invalid keys return HTTP 401.

RSS, Atom and Google News sitemap XML are supported. Ordering, format, numeric
homepage score and edition are explicit JSON fields. Each publisher's
media/non-article cleanup is applied before the limit. Curated feeds preserve
editor order; unranked feeds use publication time and cross-publisher headline
coverage. See the [feed selection guide](feed-selection.md) for the complete policy,
freshness rules, undated entries and limitations.
Google News candidates are resolved to publisher URLs during selection so
videos/quotes can be excluded and replaced with the next eligible article.
Article bodies and publisher homepages are not fetched by `/api/links`.
The background save resolver remains compatible with older Google-wrapper reports.
The npm `fetch:links` command and its CLI options have been removed.

This replaces the former Markdown report/API format. Historical `.md` link reports
are left untouched, but are not consumed or accepted by the JSON import workflow;
the archive uploader warns and skips them without conversion or deletion.
New collections always generate fresh JSON reports. Saved articles remain Markdown
by default. Storage is temporary on Render Free; consume/archive
reports before sleep, restart or redeploy. For async orchestration and status
polling use the [collection API](collect-articles.md).
