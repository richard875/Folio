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

## Getting started

Use **Node.js 24.20.0** (see `.node-version`) and npm.

```sh
npm ci
export ACCESS_HASH="$(openssl rand -hex 32)"
npm run dev
```

Open `http://localhost:8080`, enter an article URL, and use the generated `ACCESS_HASH` as the access key. Keep the same key configured across restarts if you want clients to continue working.

See [`.env.example`](.env.example) for configuration options. Keep `VITE_AUTH_ENABLED=false` and leave `DATABASE_URL` unset for the current file-backed deployment. Never commit access keys or expose them through `VITE_` variables.

### Optional outbound proxy (Webshare)

Set the server-only `OUTBOUND_PROXY_URL` environment variable to your proxy URL,
for example `http://USERNAME:PASSWORD@p.webshare.io:80/`. Use your current credentials
privately; never commit them or put them in a `VITE_` variable. Percent-encode special
characters in the username/password. HTTP and HTTPS proxy endpoints are supported.

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

Private-network filtering, TLS verification, deadlines and response-size limits remain
enabled. Publisher hostnames are resolved locally and CONNECT tunnels use validated
public IPs, preventing a second DNS resolution at the proxy from changing the target.
HTTP proxies receive proxy credentials over an unencrypted connection; HTTPS publisher
content still uses verified end-to-end TLS. Prefer an HTTPS proxy endpoint if your
provider supports one. Plain HTTP publisher traffic is not encrypted.

Use a fixed Webshare exit IP for representative local/Render comparisons; a gateway
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
| `/api/agent/latest` | Retrieve a saved-article manifest |
| `/api/agent/read` | Retrieve checksum-verifiable article content |

Most endpoints authenticate through the `hash` query parameter; agent endpoints also accept Bearer authentication. Treat URLs containing the key as secrets. `/healthz` is public; `/api/health` is authenticated.

### Feed summaries

`/api/links` includes an indented `Summary:` line below an article URL when its RSS description or Atom summary contains useful text. RSS `content:encoded` and Atom inline content are fallbacks. HTML is converted to plain text; short stubs (under 40 characters) and headline/publisher-only descriptions are omitted. Summaries are capped at 1,000 characters with an ellipsis; they are feed excerpts, not generated summaries or full-article extractions. Missing summaries leave the existing URL-only entry unchanged, including news sitemaps without descriptions.

With `format=json`, each section keeps its existing `links` string array and adds an `articles` array of `{ "url": "…", "summary": "…" }` objects. `summary` is omitted when unavailable. Saved Markdown reports include the same summaries, and background article collection continues to use the URL lines only.

## Development and deployment

```sh
npm run lint
npm test
npm run typecheck
npm run build
npm start
```

`npm start` serves the production build on `PORT` (default `3000`) and requires an `ACCESS_HASH` of at least 32 characters. `npm run test:production` runs a disposable production smoke test; browser checks require Playwright Chromium.

Source routes live in `src/routes/`, extraction and collection logic in `src/lib/`, and operational tools in `scripts/`. Generated articles, link reports, and job records are written under `output/`.

The Render Blueprint is defined in [`render.yaml`](render.yaml). **Render Free storage is temporary:** articles and job history can be lost on sleep, restart, or redeployment. Collections are best-effort and do not automatically resume after interruption. Archive important output separately.

See [deployment.md](deployment.md) for deployment setup, resource limits, history import, and release verification.
