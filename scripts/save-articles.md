# Save articles API

`GET /api/save?url=…&hash=…` reads and saves an article before returning it.
It uses the same access key and article extraction as `/api/read`.

By default, both the file and response are Markdown. Add `format=json` to save
a `.json` file and receive the same article data as JSON. Partial results use
HTTP 206. HTTP responses are non-cacheable and each successful request creates a
new file, but extraction may reuse the reader's in-memory article cache.
The `X-Saved-File` response header identifies its relative path.

Files are stored beneath the server's project directory:

```text
output/articles/YYYY-MM-DD_HH-mm/website_section_first_five_title_words_HH-mm-ss.md
```

Dates and times are UTC; `HH` is the 24-hour clock and `mm` is the minute. Missing directories are
created automatically and existing directories are reused. Existing files are
never overwritten: a same-name collision waits for the next second, including
across minute/hour/day boundaries. Filenames are filesystem-safe, lowercase, and
underscore-separated; overly long parts are truncated.

When a save includes a known batch `callId`, the folder uses that job's start
date, hour and minute for every article, even if saves finish later or after
midnight. The timestamp is read from the server's job record, not supplied by
the caller. Filenames still use each save's actual time. A standalone save with
no call ID uses its current date/hour/minute. An unknown call ID returns 404.

The website name comes from the original URL's hostname. The section is
inferred from the URL path where possible, otherwise `general`. Override either
with `website` and `section` query parameters; this is especially useful for
Google News links or opaque article URLs:

```text
/api/save?url=https%3A%2F%2Fwww.ft.com%2Fcontent%2Farticle-id&hash=YOUR_KEY&section=Markets
```

This endpoint needs a writable filesystem and a single-process Node server.
The current deployment is **Render Free**, with Nitro's `node-server` preset;
see [deployment.md](../deployment.md). Files are temporary and can disappear on
sleep, restart or redeploy. A successful save is not a durable-storage guarantee.

Keep output directories private and archive important files elsewhere. The access
key is never written into article files. Failed reads create no files; ordinary
write failures return 500 and low-storage protection can return 507. A saved file
or `partial=false` is not proof of complete/correct article extraction.

## Selective background saving

`POST /api/save-batch?hash=YOUR_KEY` saves an explicit list without collecting feeds:

```json
{
  "urls": [
    "https://example.com/article-one",
    { "url": "https://example.com/article-two", "website": "Example", "section": "World" }
  ],
  "format": "markdown"
}
```

Send JSON (`Content-Type: application/json`); `urls` must contain 1–100 entries.
`format` is `markdown` (default) or `json` **in the body**, not a query override.
Entries can be URL strings or objects with `url` and optional `website`/`section`.
The initial JSON response is 202 with `callId`, counts and a credential-free
`statusEndpoint`. Poll `GET /api/save-batch/status?callId=…&hash=YOUR_KEY`.

Collection and save-batch share one job lock: an overlapping start returns 409.
Non-POST starts return 405; invalid JSON/list/format inputs return 400. Status
returns 404 for a missing job and 200 for known states: `in progress`, `completed`,
`partial` (some saves failed), or `error` (all attempted saves failed or the job
could not finish). An individual saved article can still carry `partial: true`
inside a `completed` job. Status includes finished per-URL results and queued work.

Both job types use `SAVE_CONCURRENCY` and the one-hour budget; configure concurrency
1 on Render Free. Job files and saved articles have the same temporary-storage
limitations. See the [collection guide](collect-articles.md) for retries and recovery.
