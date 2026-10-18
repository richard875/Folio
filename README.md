# Folio

Folio is a private article reader and news-collection API. It extracts readable article content, collects links from configured feeds, and saves Markdown or JSON for later retrieval by people and agents.

Built with React 19, TypeScript, TanStack Start, Tailwind CSS, and Nitro. The current deployment is file-backed; no database or account system is required.

## Features

- Browser-based article reading with title, author, publication date, and partial-content indicators.
- RSS, Atom, and news-sitemap collection with publisher URL resolution.
- Feed-provided article summaries in link reports, when available.
- Background collection jobs with progress polling and bounded execution.
- Saved-article manifests and paginated agent retrieval with SHA-256 verification.
- Interactive Swagger documentation and an OpenAPI specification.

Article extraction relies on third-party archive and retrieval services; availability and completeness vary.

Documentation, the article-reader skill, historical handovers, research and QA
artifacts are organized under **[docs/](docs/README.md)**. Private deployment files
and generated QA captures stay Git-ignored.

## Getting started

Use **Node.js 24.20.0** (see `.node-version`) and npm.

```sh
npm ci
export ACCESS_HASH="$(openssl rand -hex 32)"
npm run dev
```

Open `http://localhost:8080`, enter an article URL, and use the generated `ACCESS_HASH` as the access key. Keep the same key configured across restarts if you want clients to continue working.

See [`.env.example`](.env.example) for configuration options. Keep `VITE_AUTH_ENABLED=false` and leave `DATABASE_URL` unset for the current file-backed deployment. Never commit access keys or expose them through `VITE_` variables.

### Article retrieval order

For editable publisher orders, method definitions and a full fallback diagram,
see **[reader/README.md](reader/README.md)**. Configuration lives in
`reader/retrieval.config.ts` (ordering) and `reader/methods.ts` (service definitions).

Folio uses WallHop's normal HTML page (`https://wallhop.io/https://…`), not its
`/raw` or `/api` endpoints, with the existing article parser:

- **First attempt:** WSJ, Foreign Policy, CNBC.
- **Second attempt:** NY Times, Washington Post, Bloomberg, The Economist,
  Financial Times, Reuters, Business Insider.

For the second-attempt group, the first attempt is the publisher page when the
proxy is enabled/configured, otherwise Freedium Mirror. All existing fallbacks
remain in their previous relative order. Later methods are tried when earlier
ones fail or yield short/incomplete text; a substantial result can stop the cascade.
For WSJ, WallHop's normal page loads article HTML from the same URL with
`X-Wallhop-Load: 1`; Folio sends that header only to WallHop, without executing
page scripts. WallHop gets at most **25 seconds total**, bounded by the existing
48-second article budget, because its WSJ loading page advertises 10–20 seconds.
Query-bearing URLs split the normal passes into roughly 24 seconds each, so the
remaining pass deadline can shorten that 25-second allowance.
It uses the same transport and response limits as other HTML retrieval services
and is not automatically exempted from proxy routing. Availability
and article completeness are not guaranteed; existing cached results may skip fetching.

### Article response limits

Article downloads allow up to **8,000,000 bytes** per response by default,
including decoded compressed bodies. Set server-only `ARTICLE_MAX_RESPONSE_BYTES`
to a positive integer up to **16,000,000** for larger archive/publisher pages;
invalid values fall back to the 8 MB default. Oversized responses are cancelled,
not truncated or repeatedly retried by the fetcher. Keep extraction concurrency low
on Render Free: HTML parsing needs substantially more memory than the raw response.
This setting does not increase feed-download limits. Restart after changing it.

### Optional outbound proxy (Webshare)

Set the server-only `OUTBOUND_PROXY_URL` environment variable to your proxy URL,
for example `http://USERNAME:PASSWORD@p.webshare.io:80/`. Use your current credentials
privately; never commit them or put them in a `VITE_` variable. Percent-encode special
characters in the username/password. HTTP and HTTPS proxy endpoints are supported.

For Webshare **Rotating Proxy Endpoint / HTTP / Username-Password**, configure:

```text
OUTBOUND_PROXY_ENABLED=true
OUTBOUND_PROXY_MODE=rotating
OUTBOUND_PROXY_URL=http://USERNAME:YOUR_PRIVATE_PASSWORD@p.webshare.io:80/
```

Rotating mode appends Webshare's `-rotate` username suffix automatically, or keeps
an existing suffix unchanged. It requires the `p.webshare.io` gateway and username/
password authentication. Credentials from the dashboard remain private; the example
contains placeholders only. Unset `OUTBOUND_PROXY_MODE` (or set `configured`) to use
the URL exactly as supplied, including for non-Webshare proxies. Invalid modes fail
requests rather than silently bypassing the proxy.

Every outbound fetch creates a new CONNECT tunnel and destroys its dispatcher
afterwards, even for the same site, retries and redirect hops. Webshare chooses a
random exit from your pool; repeated IPs are still possible. This is not a promise
of a unique IP for every request. Existing third-party retrieval services make their
own downstream requests, whose exit IPs Folio cannot control.

With proxy routing enabled, extraction tries the publisher URL through the proxy
before the existing retrieval-service cascade, except that WallHop precedes it for
WSJ, Foreign Policy and CNBC (see retrieval order above). Except for WallHop's
25-second allowance, each extraction method gets
at most **6 seconds total** across redirects/retries and **one retry**, further
bounded by the existing article deadline and `FETCH_RETRY_LIMIT`. This prevents an
unreachable service from exhausting the entire extraction budget. Direct mode
retains the existing retry budget. In either mode, certificate-validation failures,
DNS `ENOTFOUND`, proxy authentication/quota failures, and non-transient HTTP 4xx
responses fail that method immediately. Certificate verification is never disabled.

#### Selective routing for retrieval services

If a service works directly but performs poorly through Webshare, explicitly list
its hostname in `OUTBOUND_PROXY_BYPASS_HOSTS`, for example:

```text
OUTBOUND_PROXY_BYPASS_HOSTS=freedium-mirror.cfd,wallhop.io
```

This intentionally uses your machine/Render's IP for **those exact hosts only**;
other sites still use the proxy. The intended configuration bypasses the working
mirror and WallHop; archive.is, archive.today and archive.ph remain proxied.
This is an explicit example, not a hardcoded default or a verified deployment export.
The older `.env.example` lists only the mirror; set both hosts explicitly when using
the intended routing above. An unset/empty list
bypasses nothing. Do not bypass archive sites based on local-only access tests. No
automatic direct fallback is introduced. Subdomains do not match implicitly, and
redirects are routed again by destination hostname. Private-network protections
still apply. Bypassed requests emit an `outbound_proxy_bypass` log. This option can
improve access to retrieval services but cannot fix their outages, rate limits,
missing articles or invalid certificates. It also means not every request rotates.

For local development, set the variable in the environment before `npm run dev`
(for example, `export OUTBOUND_PROXY_URL='http://USERNAME:PASSWORD@p.webshare.io:80/'`,
with your private values). For Render, add the same variable in the service's
**Environment** settings and redeploy. Restart local development after changing it.
Do not assume Vite's `.env` loading makes unprefixed values available to server code.

Set `OUTBOUND_PROXY_ENABLED=false` to turn proxy routing off without deleting the
URL; set it to `true` to turn routing back on. Unset/blank defaults to `true` for
backward compatibility, but a nonblank `OUTBOUND_PROXY_URL` is still required.
Invalid toggle values fail requests instead of silently switching to direct mode.
Restart the server after changing either setting (redeploy on Render).

When enabled and configured, feed downloads, Google News resolution, and article-fetch requests
(including redirects and existing retrieval-service requests) use the proxy. Internal
Folio API calls and unrelated platform integrations are not proxied. A failed proxy
request **never falls back to a direct connection**. Unset/blank restores direct mode.
Existing article caches can return results without making a network request.

Each proxied request emits a server-side JSON log with event
`outbound_proxy_request`, destination `site`, credential-free `proxy` address,
HTTP `status` (null on connection failure), `outcome` (`response` or `error`), and
`durationMs`. Redirect hops and retries are separate entries. A response can still
be a publisher error such as 403; the log does not claim successful article extraction
or report the proxy's exit IP. Destination paths/queries and proxy credentials are
never included. Requests rejected before proxy dispatch and cached results do not
emit this event. Logs appear in the local server output or Render logs.
Logs also include the effective `connectionMode`. Failures include allowlisted
`errorCode`, `errorType`, and `proxyStatus` diagnostics (for example certificate
errors or CONNECT 407), without exposing raw error messages or credentials.

Private-network filtering, TLS verification, deadlines and response-size limits remain
enabled. Publisher hostnames are resolved locally and CONNECT tunnels use validated
public IPs, preventing a second DNS resolution at the proxy from changing the target.
HTTP proxies receive proxy credentials over an unencrypted connection; HTTPS publisher
content still uses verified end-to-end TLS. Prefer an HTTPS proxy endpoint if your
provider supports one. Plain HTTP publisher traffic is not encrypted.

If reproducible local/Render comparisons matter more than rotation, use Webshare's
fixed-IP configuration with mode `configured`; a gateway
hostname alone does not guarantee a fixed exit IP. Different DNS answers, rate limits,
content changes and publisher policy can still produce different results. Shared
datacenter proxies may also be blocked. Free-plan bandwidth is consumed by downloads
and retries; this integration adds no scraping API and bypasses no login requirement.

## API

The home page includes an **API documentation** control. Swagger is served at `/api/docs`, with the specification at `/api/openapi`; both require the access key.

| Endpoint | Purpose |
| --- | --- |
| `/api/read` | Extract an article as Markdown or JSON |
| `/api/save` | Extract and save an article |
| `/api/links` | Collect and save a feed-links report |
| `/api/collect` | Start a background collection; prefer POST |
| `/api/collect/status` | Poll a job using its `callId` |
| `/api/save-batch` | POST selected URLs for background saving, without collecting feeds |
| `/api/save-batch/status` | Poll a selective-save job |
| `/api/agent/latest` | Retrieve a saved-article manifest |
| `/api/agent/read` | Retrieve checksum-verifiable article content |
| `/api/docs`, `/api/openapi` | Authenticated Swagger UI and OpenAPI specification |
| `/api/import` | POST an explicitly authorized output-file restoration |
| `/api/purge` | POST to delete article folders older than the current UTC date; destructive |
| `/api/health` | Authenticated runtime and storage health |
| `/healthz` | Public deployment health probe |

Most endpoints authenticate through the `hash` query parameter; agent endpoints also accept Bearer authentication. Treat URLs containing the key as secrets. `/healthz` is public; `/api/health` is authenticated.

See the [collection guide](scripts/collect-articles.md),
[save and save-batch guide](scripts/save-articles.md), and
[agent reading protocol](scripts/agent-reader.md) for request formats and statuses.
Saved-file verification proves exact retrieval, not correct or complete extraction.

### Feed summaries

The ten configured feed sources live in [`data/feeds.json`](data/feeds.json).
Ordering and format are explicit fields, not inferred from Markdown research prose.
See [`data/README.md`](data/README.md) for the catalog format.

`/api/links` includes an optional `summary` field with each article URL when its RSS description or Atom summary contains useful text. RSS `content:encoded` and Atom inline content are fallbacks. HTML is converted to plain text; short stubs (under 40 characters) and headline/publisher-only descriptions are omitted. Summaries are capped at 1,000 characters with an ellipsis; they are feed excerpts, not generated summaries or full-article extractions. Missing summaries leave an object containing only `url`, including news sitemaps without descriptions.

Bloomberg's news sitemap is an explicit exception to headline-only summary rejection: its `news:title` is saved as `summary`, including short headlines. Other news sitemaps do not gain a headline fallback. Empty titles are omitted and titles exceeding 1,000 characters are capped.

Link reports are saved and returned as JSON only. Each publisher/section group has an `articles` array of `{ "url": "…", "summary": "…" }` objects; `summary` is omitted when unavailable. Reports include schema version 1, a UTC generation timestamp, the saved path, counts and section availability. Background collection validates and reads these JSON groups. There is no embedded Markdown or duplicate URL-only array. Omit `format` or use `format=json`; other link-report formats return 400. Historical Markdown reports are left untouched, but new collections and link-report imports use JSON. Saved articles remain Markdown by default. See the [report schema and example](scripts/fetch-links.md).

## Development and deployment

```sh
npm run lint
npm test
npm run typecheck
npm run build
npm start
```

`npm start` serves the production build on `PORT` (default `3000`) and requires an `ACCESS_HASH` of at least 32 characters. `npm run test:production` runs a disposable production smoke test; browser checks require Playwright Chromium.

Source routes live in `src/routes/`, article extraction in root `reader/`, feed
collection/runtime/agent helpers in `src/lib/`, and operational tools in `scripts/`.
Generated articles, link reports, and job records are written under `output/`.

The existing `sh startup.sh` starts development idempotently using `npm run dev`
and logs to `.claude/dev.log`. The wrapper reads tracked
`.claude/app-env.defaults.json`, then optional local `.claude/app-env.json`; the process
environment takes precedence. Only `VITE_` string flags are read from those JSON
files. They are not secret stores. `npm start` loads an existing ignored `.env`;
development loads only selected server variables from it, so export other server
settings before starting development (see [deployment.md](deployment.md)).

The [shared AI agent resources](.claude/README.md) contain optional App Builder
recipes, not additional Folio features or the active deployment configuration.
Claude Code and OpenCode both discover `.claude/skills/`; `AGENTS.md` holds the
shared project instructions, imported by `CLAUDE.md` for Claude Code.

The Render Blueprint is defined in [`render.yaml`](render.yaml). **Render Free storage is temporary:** articles and job history can be lost on sleep, restart, or redeployment. Collections are best-effort and do not automatically resume after interruption. Archive important output separately.

See [deployment.md](deployment.md) for deployment setup, resource limits, history import, and release verification.
