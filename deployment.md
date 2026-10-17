# Folio

Private article reading, feed collection and checksum-verifiable agent retrieval.

## Render Free deployment

This deployment deliberately uses **temporary files only**. No Neon, database,
Redis, persistent disk, cron or paid worker is provisioned. Everything created
under `output/` is lost on **sleep, restart and redeploy**, including imported
history and job statuses. Keep important output in a separate local archive.

1. Publish `chore/migrate-to-render` to your Git provider when ready. No main push
   is required: create the Blueprint from this branch. Merge later through your
   normal review process, then change the linked deployment branch if desired.
2. In Render, create **New → Blueprint**, connect the repository and select the
   branch containing `render.yaml`. Review **Free** and **Singapore** before creating.
3. Enter `ACCESS_HASH`: a new random secret of at least 32 characters (for example,
   generate with `openssl rand -hex 32`). Do not paste it into Git or shared URLs.
   All other deployment variables are supplied by the Blueprint. Render supplies
   `PORT`; do not replace it with a fixed value. Never set `DATABASE_URL`.
4. Render builds and starts the app, terminates HTTPS, and checks public `/healthz`.
   This probe has no secrets or downstream calls. `/api/health` remains authenticated
   and reports memory plus temporary-storage readiness.
5. Use the assigned `https://…onrender.com` address. A custom domain is optional:
   add it in Render Settings, create the DNS records Render specifies, remove any
   conflicting old Oracle A/AAAA records, and wait for verification and managed TLS.
   Stay within the two included custom domains. No Caddy, certbot or SSH is required.

### Optional Webshare proxy

Add `OUTBOUND_PROXY_URL` as a **secret environment variable** in the Render service
and redeploy. Format: `http://USERNAME:PASSWORD@p.webshare.io:80/` (placeholder
credentials only). Use the same setting locally for comparable routing. Never put
the secret into `render.yaml`, Git, or a `VITE_` variable. Leave it unset for direct
connections. Configured proxy failures do not fall back to Render's outbound IP.
See the README's outbound-proxy section for scope, TLS and DNS behaviour.
Set `OUTBOUND_PROXY_ENABLED=false` to disable the proxy while keeping its URL;
set `true` to re-enable it, then redeploy. Unset/blank defaults to true and still
requires a nonblank proxy URL. Invalid toggle values fail requests.

### Limits and costs

- Free compute: **0.1 CPU / 512 MB**, shared **750 hours/month/workspace**.
- Idle services sleep after **15 minutes**; the next request takes about **one
  minute** to wake. API clients should allow for this and verify JSON responses,
  not mistake a platform loading page for a completed operation.
- **5 GB outbound bandwidth/month** and **500 build minutes/month**. Without a
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
concurrency is 1, feed concurrency 2, and the article cache is capped at 8 MiB.
Do not raise concurrency on Free without measuring RSS.

Builds explicitly include dev dependencies and run lint/tests/typecheck before
building. All build-time commands get a scoped 4096 MiB heap on Render's 8 GB builder;
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

### Local release verification

```sh
NODE_OPTIONS=--max-old-space-size=4096 sh -c 'npm ci --include=dev && npm run lint && npm test && npm run typecheck && npm run build'
PRODUCTION_SMOKE_PORT=8765 npm run test:production
```

The smoke test starts a disposable server, checks non-default-port operation,
auth, agent checksums, memory, Swagger refresh and desktop/mobile rendering,
then stops it. Browser QA needs Playwright Chromium installed locally; it is not
installed or run as part of Render's build. The local dev preview remains on 8080.
Legacy `scripts/*.md` describe earlier workflows; this README is the deployment
source of truth for temporary-storage behaviour. Platform helpers are preserved.

### Retiring Oracle — manual only

After Render is working and important output is backed up, in the OCI console:
terminate the Folio VM; decide whether to retain or delete its boot/block volumes
and backups; release a reserved public IP if allocated; remove unused Folio-only
subnets, gateway and VCN after checking dependencies. Remove obsolete DNS records.
Do not delete shared resources or backups you still need. No OCI CLI command,
Terraform destroy or live-resource action is performed by this repository.
