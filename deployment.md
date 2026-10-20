# Folio

Private article reading, feed collection and checksum-verifiable agent retrieval.

## Render Free deployment

This deployment deliberately uses **temporary files only**. No Neon, database,
Redis, persistent disk, cron or paid worker is provisioned. Everything created
under `output/` is lost on **sleep, restart and redeploy**, including imported
history and job statuses. Keep important output in a separate local archive.

1. When a release is authorized, push the branch you intend Render to deploy
   (normally `main`). There is no remaining migration-branch prerequisite.
2. In Render, create **New → Blueprint**, connect the repository and select the
   branch containing `render.yaml`. Review **Free** and **Singapore** before creating.
3. Enter `ACCESS_HASH`: a new random secret of at least 32 characters (for example,
   generate with `openssl rand -hex 32`). Do not paste it into Git or shared URLs.
   The Blueprint also prompts for `READ_CONCURRENCY`, `SAVE_CONCURRENCY` and
   `RSS_LINKS_PER_SECTION` (`sync: false`); use **1**, **1** and **5** respectively.
   Fixed settings, including `VITE_AUTH_ENABLED=false` and `FEED_CONCURRENCY=2`,
   are supplied by the Blueprint. Render supplies
   `PORT`; do not replace it with a fixed value. Never set `DATABASE_URL`.
4. Render builds and starts the app, terminates HTTPS, and checks public `/healthz`.
   This probe has no secrets or downstream calls. `/api/health` remains authenticated
   and reports memory plus temporary-storage readiness.
5. Use the assigned `https://…onrender.com` address. A custom domain is optional:
   add it in Render Settings, create the DNS records Render specifies, remove any
   conflicting old Oracle A/AAAA records, and wait for verification and managed TLS.
   Check your workspace's current custom-domain allowance. No Caddy, certbot or SSH
   is required. `autoDeployTrigger: commit` deploys commits on the linked branch;
   the YAML does not pin a branch. Check the actual linked branch in Render.

### Optional Webshare proxy

Add `OUTBOUND_PROXY_URL` as a **secret environment variable** in the Render service
and redeploy. Format: `http://USERNAME:PASSWORD@p.webshare.io:80/` (placeholder
credentials only). Use the same setting locally for comparable routing. Never put
the secret into `render.yaml`, Git, or a `VITE_` variable. Leave both URL settings
unset for direct connections. Configured proxy failures do not fall back to Render's outbound IP.
See the README's outbound-proxy section for scope, TLS and DNS behaviour.
Set `OUTBOUND_PROXY_ENABLED=false` to disable the proxy while keeping its URL;
set `true` to re-enable it, then redeploy. Unset/blank defaults to true and still
requires a nonblank single URL or pool. Invalid toggle values fail requests.
For Webshare rotation, set `OUTBOUND_PROXY_MODE=rotating` with the `p.webshare.io:80`
HTTP gateway. Folio adds `-rotate` to the username if missing and opens a fresh
tunnel for every request, retry and redirect. Webshare randomly selects from your
pool, so consecutive IPs can repeat. Unset mode or `configured` preserves the URL's
credentials unchanged. Set these values in the service environment, then redeploy.

For multiple accounts, set secret `OUTBOUND_PROXY_URLS` to a JSON array containing
all account URLs in the desired round-robin order (1–16 distinct URLs). It replaces
`OUTBOUND_PROXY_URL`; blank/unset falls back to the single URL. In Render enter
the array without dotenv's outer single quotes. `OUTBOUND_PROXY_MODE` applies to
every entry. Invalid lists fail requests rather than silently using direct transport
or the old URL. See the [pool configuration](README.md#multiple-accounts-round-robin-pool).
Each proxied request, retry and redirect hop takes the next account; bypassed
requests do not. Allocation is process-local and restarts at account 1 on restart
or pool change. It balances request counts, not bytes, and does not track quotas
or guarantee provider allowances. No real credentials belong in the Blueprint.

If third-party retrieval services work directly but not through the proxy, set
`OUTBOUND_PROXY_BYPASS_HOSTS` to a comma-separated list of their exact hostnames.
The intended value is `freedium-mirror.cfd,wallhop.io`, explicitly bypassing the
working mirror and WallHop (not a hardcoded default). Keep archive.is,
archive.today and archive.ph out of this list unless direct access has been verified
from Render itself. This explicitly
uses Render's IP for those hosts and logs each bypass; all other hosts still use
the proxy. Empty (default) bypasses nothing. Redirect destinations are checked
independently and there is never automatic direct fallback. Proxy-enabled article
extraction uses the orders in [reader/README.md](reader/README.md): WallHop precedes
the publisher for WSJ, Foreign Policy and CNBC; the publisher precedes WallHop for
the other seven. Ordinary proxy-active methods get at most six seconds/one retry;
WallHop gets up to 25 seconds, still limited by the article/pass deadline.
See [README.md](README.md#optional-outbound-proxy-webshare) for diagnostics.

### Limits and costs

- Free compute: **0.1 CPU / 512 MB**, shared **750 hours/month/workspace**.
- Idle services sleep after **15 minutes**; the next request takes about **one
  minute** to wake. API clients should allow for this and verify JSON responses,
  not mistake a platform loading page for a completed operation.
- Outbound bandwidth and build-pipeline allowances depend on the workspace plan;
  check **Billing → Monthly Included Usage** rather than assuming a fixed quota.
  Without a
  payment method, exceeding limits suspends services/builds rather than buying
  additional usage. With a card, overages can cost money: keep the workspace
  free-only, review billing/spend controls, and do not authorize paid overages.
- Render can restart the service at any time. Free hosting is not an availability
  guarantee. High service-initiated external traffic can also trigger suspension.
- SMTP is blocked; Folio currently sends no email. No email service is added.

### Background collections

Prefer `POST /api/collect` to long synchronous link/save requests. Have the calling
client or agent poll `/api/collect/status` with authentication every **30–60 seconds**
while work is active. Real inbound polling can keep an active session awake;
internal loopback requests do not provide a Render keepalive guarantee.

Jobs are best-effort, with a one-hour budget. They cannot run while asleep.
Shutdown can interrupt work; a surviving record is marked error after restart,
but a wiped filesystem means the status becomes 404 and all output is gone.
Start a new collection explicitly; there is no automatic replay/resume. Avoid
redeploying mid-collection. Download/consume results before inactivity begins.

An optional external free uptime pinger can hit `/healthz` every 10–14 minutes.
One always-on service fits within 750 monthly hours, but other services share that
allowance. A pinger does not protect files from restart/redeploy, and no self-ping
is implemented. Confirm the pinger provider's current free allowance yourself.

### Memory and runtime

Node is pinned to **24.20.0**. Old-space is **256 MiB**, and semi-space is capped
at **16 MiB** (approximately 48 MiB total young generation). This bounds V8's
overall heap around 304 MiB, leaving headroom below 512 MB for buffers, native
libraries, DOM parsing and Node itself. A heap
limit is **not** a total RSS limit or proof against leaks. Extraction/save
concurrency should be configured to 1, feed concurrency is 2 in the Blueprint,
and the article cache is capped at 8 MiB. The batch helper's fallback is 5 when
`SAVE_CONCURRENCY` is absent/invalid; that is not the recommended Free setting.
Do not raise concurrency on Free without measuring RSS.

The ten publisher JSON inventories under `data/` are bundled through
`src/lib/rss/sources.ts`; rebuild/redeploy after editing them. Only the ten Main
feeds (one per publisher) are operational for both links and collection APIs.
The other 748 stored entries are reference-only, never fetched or used as fallback
feeds. With `RSS_LINKS_PER_SECTION=1`, at most ten article entries are selected;
retries/Google resolution can still add outbound requests. See the
[file mapping and validation rules](data/README.md).

Builds explicitly include dev dependencies and run lint/tests/typecheck before
building. Test commands preload `scripts/test-env.mjs` to remove inherited proxy
settings and use only test fixtures; Render's runtime proxy settings are unchanged.
All build-time commands get a scoped 4096 MiB heap via the Blueprint;
the runtime stays at 256 MiB. Nitro handles SIGTERM with a 20-second drain,
below Render's default 30-second termination delay. Free services cannot configure
`maxShutdownDelaySeconds`; the Blueprint deliberately omits it. Jobs may still be cut short.
There is no Express server or Express trust-proxy setting. Render forwards traffic
to Nitro; internal API destinations are derived from PORT, never a client Host.

### Optional history import

Keep your original local `output/` archive. Warm `/healthz` first, stop collections,
then run locally (the key comes from your local environment, never an argument):

```sh
node --env-file-if-exists=.env scripts/import-output.mjs ./output https://YOUR-SERVICE.onrender.com
```

The tool uploads files sequentially to authenticated `POST /api/import`, checks
SHA-256 acknowledgements, rejects unsafe paths/symlinks, and never overwrites a
different file. Interrupted job records are restored as errors, never executed.
Imported article bytes/checksums are preserved. Imports consume bandwidth and
are **temporary**: repeat after data loss if needed. No source files are deleted.

Link reports must be version-1 JSON files named
`output/links/links_YYYY-MM-DD_HH-mm-ss.json`. The import API validates their schema
and requires their `savedFile` to match the destination path. The uploader warns
and skips legacy Markdown or otherwise unsupported link-report filenames; it does
not convert or delete them. Direct attempts to import a Markdown link report return
400. Article `.md`, `.json` and `.txt` imports remain supported, and importing a
link report never starts article saving. See the [report format](scripts/fetch-links.md).

### Local release verification

Use the repository's Node **24.20.0** (`.node-version`). Existing dependencies
need not be reinstalled for a documentation-only change. Export server settings
before `npm run dev`: Vite explicitly loads only `ACCESS_HASH`, `FETCH_RETRY_LIMIT`,
`RSS_LINKS_PER_SECTION` and `SAVE_CONCURRENCY` from `.env`; it does not make arbitrary
unprefixed settings (such as proxy credentials or `FEED_CONCURRENCY`) available to
server code. Process variables take precedence. `npm start` uses Node's
`--env-file-if-exists=.env`; Render normally supplies settings in its environment.

Run the existing verification commands from the repository root:

```sh
NODE_OPTIONS=--max-old-space-size=4096 sh -c 'npm ci --include=dev && npm run lint && npm test && npm run typecheck && npm run build'
PRODUCTION_SMOKE_PORT=8765 npm run test:production
```

The smoke test starts a disposable server, checks non-default-port operation,
auth, agent checksums, memory, Swagger refresh and desktop/mobile rendering,
then stops it. Browser QA needs Playwright Chromium installed locally; it is not
installed or run as part of Render's build. The local dev preview remains on 8080.
For a dev baseline, start the app with `sh startup.sh`, then use
`PRODUCTION_SMOKE_COMPARE_DEV=1 npm run test:production`. The production smoke uses
disposable storage, synthetic feeds/articles and generated credentials; it does not
rewrite real `output/` or benchmark live publisher availability. Its generated QA
artifacts are ignored under `docs/qa/`.

The `scripts/*.md` guides describe the current APIs; this document owns deployment
and temporary-storage behaviour. The Linux-only `npm run preview:restart` helper
uses `/proc`; on macOS prefer `npm run test:production` for built-server QA.
Platform helpers remain preserved, but the retained `vercel.json` is not the active
file-backed deployment target. Do not claim a remote release was verified merely
because local tests passed.

Hosting limits and billing are controlled by Render, not this repository. Consult
[Free services](https://render.com/docs/free),
[Blueprint fields](https://render.com/docs/blueprint-spec), and your dashboard for
current terms and actual settings.

### Retiring Oracle — manual only

After Render is working and important output is backed up, in the OCI console:
terminate the Folio VM; decide whether to retain or delete its boot/block volumes
and backups; release a reserved public IP if allocated; remove unused Folio-only
subnets, gateway and VCN after checking dependencies. Remove obsolete DNS records.
Do not delete shared resources or backups you still need. No OCI CLI command,
Terraform destroy or live-resource action is performed by this repository.
