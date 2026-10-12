# RSS article links API

All application operations are available over HTTP:

- `GET /api/read?url=…&hash=…` — read an article.
- `GET /api/save?url=…&hash=…` — read and save an article.
- `GET /api/links?hash=…` — collect RSS article links, save a report, and return Markdown.

`/api/links` also accepts POST with the same query parameters. Prefer POST when
triggering a collection, since it creates a file. Every endpoint uses the
`ACCESS_HASH` secret. Add `format=json` to return JSON. Links JSON includes the
saved path, counts, Markdown, and website/section-grouped article URLs.
`X-Saved-File` supplies the saved relative path in either format.

Reports are stored in `output/links/links_YYYY-MM-DD_HH-mm-ss.md`. Timestamps are
UTC. Existing files are never overwritten. Each website is a level-one heading
and each section is a level-two heading.

Set these in the root `.env` or server environment, then restart the server:

```env
ACCESS_HASH=your-secret
RSS_LINKS_PER_SECTION=5
FETCH_RETRY_LIMIT=5
```

The default is 5 unique article links per subsection, after filtering and ranking. Invalid or
non-positive limits default to 5. Retry limits count retries after the initial
attempt; 0 disables retries. Existing environment variables override `.env`.

The research file `attachments/News site RSS feeds by section.md` is bundled
into the server build. Changing it requires rebuilding/restarting production;
the deployed server does not need the original source file at runtime.
Only explicit URLs in the table's feed column are fetched. URLs in notes,
reference links, templates, and formerly configured subsection feeds are not
included. The current attachment lists 12 websites with one feed each; each
website uses a `Main feed` subsection, so a limit of 1 yields at most 12 links.
Removing table rows reduces that maximum. Website-heading/section-table inputs
are also supported, but no shorthand URLs are expanded automatically.

Up to six feeds are fetched concurrently, with a 15-second per-attempt timeout.
One collection can run per server process. An overlapping request returns 409.
Collection runs only when requested; the server does not automatically poll.
Large collections can take several minutes; clients and reverse proxies need
appropriate request timeouts. Failed feeds are marked without discarding the
others. If all feeds fail, the report is still saved and returned with HTTP 502.
Write/configuration failures return HTTP 500, and invalid keys return HTTP 401.

RSS, Atom and Google News sitemap XML are supported. The source descriptions,
scores and editions in the attachment are read by column name. Each publisher's
media/non-article cleanup is applied before the limit. Curated feeds preserve
editor order; unranked feeds use publication time and cross-publisher headline
coverage. See `scripts/feed-selection.md` for the complete policy and limitations.
Google News candidates are resolved to publisher URLs during selection so
videos/quotes can be excluded and replaced with the next eligible article.
Article bodies and publisher homepages are not fetched by `/api/links`.
The background save resolver remains compatible with older Google-wrapper reports.
The npm `fetch:links` command and its CLI options have been removed.
