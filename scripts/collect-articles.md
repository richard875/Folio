# Background article collection

## Start

```text
POST /api/collect?hash=YOUR_KEY
```

GET is also supported. The response is HTTP 202 immediately after creating the
progress record, with `callId`, `status: "in progress"`, `phase`, `concurrency`,
and a `statusEndpoint` path. Add your hash when calling that status path.

In the background, the server calls `/api/links`, reads the Markdown file that
request generated, and calls `/api/save` for each article. Each save receives
the original website/section headings, URL, access hash, and `callId`.
Article output paths remain unchanged. Add `format=json` to the start request
to save articles as JSON rather than the default Markdown. The start and status
responses are always JSON, regardless of article file format.

Set concurrency in the root `.env` or server environment and restart:

```env
SAVE_CONCURRENCY=5
```

Valid values are integers from 1 to 50; missing or invalid values default to 5.
`RSS_LINKS_PER_SECTION` still controls the number of links per subsection.
One batch collection can run per Node process; overlapping starts return 409.
The existing article rate limit is retained: workers wait and retry when saves
return 429. This can make a large batch take considerably longer. Each
rate-limited article retries up to ten times. Ordinary save failures are
recorded while other saves continue.

## Check

```text
GET /api/collect/status?callId=YOUR_CALL_ID&hash=YOUR_KEY
```

The response includes status, phase, total, processed, saved, failed, active,
queued, timestamps, generated links file, failed feed count, and per-article
results with saved paths or generic error messages.

Statuses:

- `in progress`: collecting links or saving articles.
- `completed`: all listed articles saved, including partial articles (marked).
- `error`: collection failed, one or more articles could not be saved, or the
  server restarted mid-job. Already saved articles are retained.
- `not found`: no such call ID (HTTP 404).

Missing call IDs return 400; invalid keys return 401. Known job states, including
terminal errors, return HTTP 200. Incomplete feeds are recorded in `failedFeeds`;
they do not fail a batch if the generated article list is saved successfully.

Progress is atomically written under `output/jobs/<callId>.json`. Completed
statuses survive restarts. Interrupted jobs become `error` when checked after
restart; they are not automatically resumed. Access keys are kept only in
memory and are never included in progress files, API responses or saved articles.
`/api/save` accepts `callId` and echoes it in `X-Call-Id`.

This requires the persistent single-process Node server described in
`deployment/README.md`, not a serverless function or a multi-worker deployment.
The background work survives the initiating client's disconnect, not a server
restart. Do not configure multiple app replicas against the same progress
directory. Internal API calls use server-configured loopback ports, never
incoming Host headers. Keep output directories private and backed up.
