# Folio on Oracle Cloud — single-VM production deployment

## Architecture

Ubuntu 24.04 on one A1 Flex VM (2 OCPUs, 12 GB RAM), its default boot disk,
and a public VCN. Caddy terminates HTTPS and proxies to **127.0.0.1:3000**.
Folio uses Nitro's `node-server` build and **one Node process** managed by
systemd. Articles, links and job records live in `/opt/folio/output`.
No PostgreSQL, Oracle database, load balancer, additional data disk or Object
Storage is required. Confirm current Always Free eligibility in your home region.

This is a hardened private application, **not a high-availability architecture**.
A single VM cannot eliminate downtime, Oracle reclamation, disk failure, external
publisher outages, or the need for updates and tested backups.

## VM prerequisites

- Install **Node 24 LTS** for Linux ARM64 (minimum supported version: 22.12).
  Verify `/usr/bin/node` is the intended binary; update all unit paths if needed.
- Install Caddy using its [official Ubuntu instructions](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).
- Create a dedicated `folio` system user/group with no interactive login.
  Put this repository in `/opt/folio`; the deployment administrator builds it.
- Run `npm ci` **on the VM**. Do not copy macOS `node_modules` to Linux ARM64.
- Use your domain/subdomain with an A record pointing to the VM's public IP.
  Do not add an AAAA record unless IPv6 routing/firewall are configured too.
- OCI security list: TCP 80/443 from `0.0.0.0/0`; TCP 22 only from your IP.
  Allow required outbound DNS and HTTP/HTTPS traffic.
- Allow the same traffic in the OS firewall. Inspect the OCI image's existing
  iptables/nftables rules; do not blindly insert at an assumed rule position.
  Keep an existing SSH session open while changing firewall rules.
- Never expose Node port 3000 or Caddy's admin port 2019 to the internet.

## Configuration and initial installation

The production service reads `/etc/folio/folio.env`, not a secret baked into
the client bundle. Use `deployment/folio.env.example` as the template, replace
the placeholder with `openssl rand -hex 32`, and set ownership `root:folio`
and permissions `0640`. Do not share the secret or put it in shell command
arguments, Git, screenshots or logs. No `DATABASE_URL` is needed; leave it unset.

Production validates the hash length, loopback binding, port and resource settings
before listening. It also verifies writable storage and at least 1 GiB free space.
The defaults are 5 simultaneous reads/saves, 5 articles per source, 5 fetch retries.
Production accepts concurrency 1–10, article limits 1–100 and retries 0–10.
Prefer the defaults; higher concurrency is not necessarily faster on two CPUs.

From `/opt/folio`, as the deployment user:

```sh
npm ci
npm test
npm run typecheck
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

The auth-off build default is tracked in `.grok/app-env.defaults.json`; no
ignored local file is required. Do not override `VITE_AUTH_ENABLED=true`.
Do not apply the build's `NODE_OPTIONS` to the runtime environment file.

Before starting the service, create the writable directories as an administrator:

```sh
sudo install -d -o folio -g folio -m 0700 /opt/folio/output
sudo install -d -o folio -g folio -m 0700 /opt/folio/output/articles /opt/folio/output/links /opt/folio/output/jobs
sudo install -m 0644 deployment/folio.service /etc/systemd/system/folio.service
sudo install -m 0644 deployment/folio-health.service /etc/systemd/system/folio-health.service
sudo install -m 0644 deployment/folio-health.timer /etc/systemd/system/folio-health.timer
sudo systemd-analyze verify /etc/systemd/system/folio.service /etc/systemd/system/folio-health.service /etc/systemd/system/folio-health.timer
sudo systemctl daemon-reload
sudo systemctl enable --now folio.service folio-health.timer
```

Application code/build output should be readable by `folio`, but not writable
by it; only `output/` requires writes at runtime. The service enforces this
using a read-only filesystem sandbox and an explicit writable-path exception.
Never run a second copy, PM2 cluster, or multiple workers against the same output.
The systemd entrypoint uses `flock` before recovering jobs to prevent duplicate
service launches. `npm start` is a foreground diagnostic entrypoint; **stop the
service first** and never use it alongside the service.

## HTTPS

Replace `folio.example.com` in `deployment/Caddyfile`, install it as
`/etc/caddy/Caddyfile`, then validate and reload:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Caddy obtains and renews certificates. The supplied configuration uses HTTP/1.1
and HTTP/2, so no UDP 443 rule is necessary. It bounds header/body upload time,
limits request bodies, and deliberately permits long upstream collection requests.
It does not retry mutating requests. Use `/api/collect` rather than holding a
connection open for a whole workflow; there is no automatic collection schedule.

**Request/access/error logs containing request URIs are excluded**, because APIs
and Swagger retain the access hash in query URLs. Do not enable debug/trace or
request logging without credential redaction. Operational TLS logs remain.
The hash still appears in browser history/bookmarks; never share authenticated
URLs. API responses are non-cacheable and HTTPS responses prevent referrer leaks.
Prefer Bearer auth on the endpoints that support it (agent, health and docs);
the original read/save/links/collect APIs retain query-hash authentication.

## Resource protections

| Control | Production setting |
|---|---|
| V8 old-generation heap | `--max-old-space-size=2048` on `npm start` and systemd |
| Entire service memory | systemd `MemoryHigh=3G`, `MemoryMax=4G` |
| Threads/processes and open files | `TasksMax=128`, `LimitNOFILE=16384` |
| Active extraction | 5 by default, configurable to 1–10; excess requests get 429 |
| Agent snapshot work | 2 concurrent requests; excess work gets 429 |
| Article cache | At most 40 entries and 32 MiB accounted retained strings |
| Downloaded bodies | Streaming cap: 8 MB transport/feed; articles/Google reads 3 MB |
| Feed XML | At most 2000 entries; oversized sources fail, not silently truncate |
| DOM/JSON-LD extraction | 50,000 DOM elements; nested graph depth bounded |
| Agent snapshot | 8 MB/file, 64 MB/folder, 2000 files; explicit errors, no skipped files |
| Remaining storage | Refuse new article/link writes below 1 GiB free; health returns 503 |
| Crash restart | Retry after 5 seconds, maximum 5 starts in a 5-minute interval |
| Background job budget | 1 hour total; internal links request capped at 10 minutes |

**A heap limit is not an RSS limit**: Buffers, native libraries, stacks and some
DOM/parser allocations live outside the managed heap. The systemd ceiling covers
those too, protecting the VM. At the ceiling the process can be killed and
restarted; it does not magically fix a memory leak. The remaining RAM gives the
OS, Caddy and builds headroom. Avoid building while a heavy collection is running.

Files are written privately, flushed, then published atomically. Completed job
result arrays are released from RAM. Agent manifests retain metadata rather than
all article bodies, and chunk requests load only their requested article body.
Outbound connections validate socket DNS results and redirect destinations,
blocking private networks and OCI's metadata service, including DNS rebinding.

## Health, logs and recovery

`GET /api/health` requires the access hash (Bearer or query). It reports process
memory and uptime and checks available/writable storage. The health timer calls
it every minute without putting secrets in command arguments. A failure appears
in systemd/journal; **the timer does not restart Folio or send external alerts**.
Configure an external uptime alert if you need to be notified of a VM outage.

```sh
sudo systemctl status folio folio-health.timer
sudo journalctl -u folio -u folio-health.service --since "1 hour ago"
sudo systemctl show folio -p MemoryCurrent -p MemoryPeak -p MemoryHigh -p MemoryMax -p NRestarts
df -h /opt/folio/output
```

`deployment/journald-folio.conf` is an optional **VM-wide** journald drop-in:
200 MB persistent logs, 100 MB volatile logs, 1 GiB disk reserve and 7-day
retention. Install under `/etc/systemd/journald.conf.d/` and restart journald
if those limits are appropriate for all services on this VM.

On a normal stop, Nitro gets up to 60 seconds to drain requests; systemd waits
90 seconds before killing the process. Long background jobs are **not guaranteed
to finish during shutdown**. On the next start, all interrupted records are
marked error before the API serves requests, and already-published articles are
retained. Jobs are not automatically resumed or replayed. Check status and start
a new collection explicitly; avoid deploying during an active collection.
A job that exceeds its one-hour budget stops scheduling work and finishes as an
error after outstanding workers settle; files already saved remain available.
An unusually large article limit can exceed that budget. Timeouts abort HTTP
requests, but a server-side save already executing can still finish afterwards.

If repeated crashes hit the restart limit, fix the cause first, then run
`sudo systemctl reset-failed folio` and `sudo systemctl start folio`.
Malformed job records fail startup rather than being silently discarded; repair
or restore them from backup. Do not delete saved output as a troubleshooting step.

## Updates, retention and backups

- Record the deployed Git revision. Build/test a candidate revision before
  replacing the running deployment; keep a previous known-good revision for rollback.
- For the simple in-place deployment, wait for collections to finish, stop Folio,
  back up `output/`, update code/dependencies, build, then start the service.
  Never rebuild `.output` under a running Node process.
- Preserve `output/` and `/etc/folio/folio.env` across updates and rollback.
  Roll back code only; do not overwrite newer article/job data.
- Saved data is **not automatically deleted**. Monitor usage and choose your
  retention policy. The existing `/api/purge` now accepts **POST only** and
  refuses to run with unfinished jobs. It deletes article folders older than
  the current UTC day, so use it only if that aggressive retention is intended.
  It does not prune link reports or job history. Archive those while Folio is stopped
  if history grows large; retaining years of job records increases scan time.
- Use the included Oracle boot-volume backup allowance and keep a separate copy
  of important articles/configuration outside this VM. Stop Folio for a consistent
  backup when feasible. Protect backups containing the secret and private articles.
- Test restoration, including service startup, HTTPS, job status, and agent
  checksum reconstruction. Rotate the access hash after any suspected exposure.
- Keep Ubuntu, Node, Caddy and dependencies patched. Check `npm audit` regularly.

## Final checks on the actual VM

After building, `npm run test:production` launches a disposable standalone
server on 8081, tests authentication/recovery/agent checksums/overload and
Swagger refresh, then shuts it down. It writes only temporary fixture data and
QA screenshots, not real `output/`. It requires the Playwright Chromium browser
installed for your architecture (`npx playwright install chromium` if missing).
`PRODUCTION_SMOKE_COMPARE_DEV=1` also compares against an already-running dev
server on 8080. This is a release check, not a continuously-running service.

Confirm systemd unit validation and hardening, effective memory ceilings, DNS/TLS,
both firewalls, external HTTPS, health-timer success, SSH restrictions, and reboot
recovery. Perform a real background collection and a complete agent checksum
readback. Test backup restoration and alert delivery. Local macOS tests do not
establish Linux ARM64 behaviour or Oracle service availability.
