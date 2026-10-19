# Background article collection

## Start

```text
POST /api/collect?hash=YOUR_KEY
```

GET is also supported. The response is HTTP 202 immediately after creating the
progress record, with `callId`, `status: "in progress"`, `phase`, `concurrency`,
and a `statusEndpoint` path. Add your hash when calling that status path.

In the background, the server calls `/api/links`, reads the validated JSON file that
request generated, and calls `/api/save` for each article. Each save receives
the website/section names from its JSON groups, URL, access hash, and `callId`.
The link report is always `output/links/links_<UTC timestamp>.json`, regardless
of the article format. Its shared schema validates the stored report before tasks
are created; a malformed report or mismatched saved path fails the job before saving
articles. Summaries remain in the report but are not part of saving tasks.
Both GET and POST collect use only the ten publisher `Main feed` sources through
the same links handler. The other 589 stored feed entries are reference-only:
they are never fetched, ranked or used as fallback sources. No query/body option
enables them. With a link limit of 1, at most ten article entries reach saving.
The job uses its freshly generated report, never scans/replays older link files,
and does not parse historical Markdown reports. See the [links report schema](fetch-links.md).
Article output paths remain unchanged. Add `format=json` to the start request
to save articles as JSON rather than the default Markdown. All batch articles
use the folder for the job's UTC start date/hour/minute, regardless of when
individual saves finish. Filenames retain their actual save times. The start and status
responses are always JSON, regardless of article file format.

Before calling `/api/save`, Google News article links are resolved to their
publisher URLs (for example, the original Reuters URL). Direct publisher links
are unchanged and cause no additional requests. Resolution shares the batch's
save concurrency and has a 20-second timeout. If a destination cannot be found,
that article is marked as failed and the other articles continue; the Google
wrapper is never passed to the save endpoint. Successful progress records show
the publisher URL. The website, section and call ID are preserved.

Set concurrency in the root `.env` or server environment and restart:

```env
SAVE_CONCURRENCY=1
```

Valid values are integers from 1 to 10; the batch helper falls back to 5 for
missing/invalid values. Production startup rejects explicitly invalid values.
**Configure 1 on Render Free**, as in `.env.example`; a fallback of 5 is not a
recommendation for its memory budget. Export development settings or use the
existing startup configuration; see [environment loading](../deployment.md#local-release-verification).
`RSS_LINKS_PER_SECTION` still controls the number of links per subsection.
One collection **or selective save-batch** can run per Node process; overlapping
starts return 409. Direct `/api/links` calls have their own per-process lock.
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
results with saved paths or error messages. The whole job has a one-hour budget;
the internal links request is capped at ten minutes and each save request at
three minutes, within the job deadline.

Statuses:

- `in progress`: collecting links or saving articles.
- `completed`: all listed articles saved, including partial articles (marked).
- `partial`: some saves failed but at least one succeeded, or a feed failed while
  collection otherwise finished. This job status differs from an article's
  `partial` flag: a job containing incomplete-but-saved texts can be `completed`.
- `error`: collection/deadline/persistence failed, all attempted saves failed, or
  the server restarted mid-job. Already saved articles are retained when storage survives.
- `not found`: no such call ID (HTTP 404).

Missing call IDs return 400; invalid keys return 401. Known job states, including
terminal errors, return HTTP 200. Incomplete feeds are recorded in `failedFeeds`
and make an otherwise successful collection `partial`. If every feed fails,
the links request returns 502 and the job becomes `error`. Invalid start formats
return 400; inability to start/persist the job returns 500.

Progress is atomically written under `output/jobs/<callId>.json`. Completed
statuses can survive a restart **only if the filesystem survives**. Render Free
can erase all output on sleep, restart or redeploy, so a previously known job can
return 404. Surviving interrupted records become `error` during production
startup (or when checked after restart); they are not automatically resumed.
Access keys are kept only in
memory and are never included in progress files, API responses or saved articles.
`/api/save` accepts `callId` and echoes it in `X-Call-Id`.

This uses the single-process Node server described in
[deployment.md](../deployment.md), not a serverless function or a multi-worker deployment.
The background work survives the initiating client's disconnect, not a server
restart. Do not configure multiple app replicas against the same progress
directory. Internal API calls use server-configured loopback ports, never
incoming Host headers. Keep output directories private and backed up.

For a supplied URL list without feed collection, use
[`POST /api/save-batch`](save-articles.md#selective-background-saving).
