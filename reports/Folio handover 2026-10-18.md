# Folio — Detailed handover for a new AI chat

**Prepared:** October 18, 2026  
**Repository:** `git@github.com:richard875/Folio.git`  
**Working directory:** `<PROJECT_ROOT>`  
**Branch:** `main`  
**Latest committed change:** `bb5535a` — `Isolate tests from Render deployment proxy settings`  
**Live app:** `https://folio-6rcf.onrender.com`

This is a standalone continuation handover. It supersedes the October 17 opening
handover wherever the two disagree. It records implemented behavior, user decisions,
Git history, validation, and the subsequent live article-content audit. It contains
**no real access hashes, proxy usernames, or proxy passwords**.

## 1. Executive summary

Folio is a private, file-backed article-reading and news-collection application/API
deployed on Render Free. The user wanted an ordinary outbound proxy, not a scraping
API, because publishers and retrieval services often reject Render's outbound IPs.

Work completed during this chat:

1. Added optional HTTP(S) forward-proxy routing through the existing Undici dependency.
2. Added a proxy on/off switch, safe per-request logs, and Webshare rotating mode.
3. Raised the article-response limit from 3 MB to 8 MB, configurable up to 16 MB.
4. Reverted two earlier publisher-removal commits at the user's explicit request.
5. Diagnosed poor all-proxy extraction results and improved retry/deadline handling.
6. Added explicit exact-host proxy bypasses, with only `freedium-mirror.cfd` bypassed
   in the user's latest configuration.
7. Removed broken `freedium.cfd` extraction methods while preserving the mirror.
8. Removed **only The Hill and Axios** from current integrations, including reader-side
   mappings, configuration, docs, and tests. Ten providers remain.
9. Fixed a Render build failure caused by tests inheriting production proxy settings.
10. Committed and pushed all implementation work through `bb5535a`.
11. Read all ten files from a real Render collection through the agent API and verified
    their hashes, lengths, and chunk completion.
12. Discovered that the nominally successful WSJ save contains Wayback Machine
    boilerplate, not the requested article. Nine files contain substantive article text.
13. Summarized those nine readable articles and identified their original publishers.

**Most important remaining issue:** saving a file is not equivalent to successfully
extracting the intended article. The next quality improvement should address false
positive extraction, noisy formatting, and unreliable `partial` classification.
These improvements have **not** been implemented or newly authorized by the latest
handover request.

## 2. User instructions and scope boundaries

### 2.1 Root `reader/` is no longer excluded for the relevant work

The opening handover said to ignore root `reader/`. That instruction was later
superseded in this conversation:

- The user permitted inspection while discussing proxy integration.
- Subsequent fixes explicitly concerned reader fetching and extraction.
- When requesting removal of The Hill and Axios, the user explicitly said to check
  `reader/` for related code as well.

The folder is important and actively used. Relevant changes have been made there.
Do not continue treating it as globally off-limits under the obsolete opening context.
This permission is not a reason to rewrite unrelated reader functionality.

### 2.2 Preserve saved output

Publisher-removal scope remained code/configuration/documentation/tests, not historic
data. Do not delete or rewrite `output/` without new authorization. Historical articles,
reports, and jobs may still mention removed providers.

The live reading audit used authenticated read-only API requests and temporary local
copies outside the repository. It did not repair or overwrite the saved Render files.

### 2.3 Preserve unrelated changes and infrastructure

- Inspect the current working tree before editing; user changes may have appeared.
- Do not reset, discard, or overwrite unrelated work.
- Keep existing async collection, save-batch, agent reading, authentication, and docs.
- Keep the existing file-backed model; do not introduce database/accounts/cloud storage
  merely because their scaffolding exists.
- Do not enable `DATABASE_URL` or account authentication for this deployment.
- Keep secrets server-side; never put them in `VITE_` variables or committed files.

### 2.4 Publisher restoration/removal decisions changed during the chat

The user explicitly authorized reverting both earlier removal commits. Therefore the
opening prohibition against restoring WSJ, Reuters, and Business Insider no longer
describes current requirements. Those three are now retained intentionally.

The subsequent, narrower removal request was **The Hill and Axios only**. Do not
remove the other ten providers or restore these two without permission.

### 2.5 Proxy requirements

- Use a conventional proxy service; the user rejected scraping APIs as the solution.
- Provider selected: Webshare.
- Connection type selected: Rotating Proxy Endpoint.
- Protocol selected: HTTP, used for HTTPS destinations through CONNECT tunneling.
- Keep TLS certificate verification and private-network protections enabled.
- No hidden direct fallback when a configured proxy fails.
- Bypass only explicitly configured exact hosts.
- Do not recommend direct archive access on Render based on local-only tests.
- Random IP selection does **not** guarantee a different IP on every request.

### 2.6 Commit/push authorization is per request

The user sometimes requested a commit without a push and later authorized pushing.
Do not treat prior push permission as authorization to push every future change.
At the end of implementation, the user explicitly requested commit and push, and it
was completed. This handover file itself has not been committed or pushed.

### 2.7 Exposed credentials

The user pasted proxy credentials in chat/a screenshot and later provided an agent
API URL containing an access hash. They were used only within authorized tasks and
are omitted here. Credential rotation was recommended. Whether rotation happened
has not been independently verified. Never recover/reprint them from chat history,
logs, or local configuration just to populate this handover.

## 3. Repository, environment, and Git state

### 3.1 Actual environment

This session runs against a **local macOS repository**, not a Linux `/workspace`.
Root `AGENTS.md` contains the original app-builder sandbox contract; respect its
safety and project rules, but verify real paths and runtime rather than blindly
assuming the sandbox descriptions are literal.

- Working directory: `<PROJECT_ROOT>`.
- Node requirement: `>=24.20.0 <25`; `.node-version` specifies `24.20.0`.
- In this tool shell, default PATH did not expose Node/npm. The installed binary was
  available under `$HOME/.nvm/versions/node/v24.20.0/bin`.
- Commands were run with that directory prepended to PATH.
- Dependencies are installed; do not reinstall or upgrade them unnecessarily.

### 3.2 Git state verified while preparing this handover

```text
## main...origin/main
?? "reports/Folio handover 2026-10-18.md"
```

Interpretation:

- Latest committed implementation is `bb5535a`.
- `main` matches the locally recorded `origin/main`.
- All implementation changes were committed and pushed.
- No tracked-file modifications were present when this document was started.
- The only untracked item is this newly created handover document.
- No fresh remote fetch or hosting commit-SHA inspection was performed just to write
  the handover; recheck if newer work may exist.

The opening handover mentioned unrelated `test-parse.mjs`. It did not appear in the
working-tree status during this session; this assistant did not delete it. Do not
recreate or remove unrelated files based on stale historical status descriptions.

### 3.3 Local environment file

An existing `.env` is Git-ignored. It was not committed. A narrowly authorized edit
changed its bypass list to just `freedium-mirror.cfd`; other secrets were preserved.
Do not dump the file or use broad searches that print its credentials.

## 4. Application architecture and deployment

### 4.1 What Folio does

- Fetches article pages and tries multiple retrieval methods.
- Extracts readable article text, metadata, and images.
- Returns Markdown or JSON.
- Collects article links from RSS, Atom, and news-sitemap sources.
- Adds feed-provided summaries where available.
- Saves link reports, articles, and background job records.
- Runs background collection and selective async save jobs.
- Exposes snapshot-pinned manifests and checksum-verifiable article chunks to agents.
- Serves authenticated Swagger/OpenAPI documentation.

### 4.2 Stack and important source locations

- React 19, TypeScript, TanStack Start/Router, Tailwind, Nitro.
- `fast-xml-parser` for feed parsing.
- `linkedom` and `@mozilla/readability` for extraction.
- `undici` for direct/proxy dispatchers; it was already a dependency.
- Node's test runner and Playwright-based smoke tests.
- Root `reader/` holds real extraction, fetching, save, and auth logic.
- `@reader/*` maps to root `reader/*` in `tsconfig.json`.
- `src/lib/runtime/` holds shared network/storage/limit helpers.
- `src/lib/rss/` holds catalog, feed selection, summaries, collection, and link API logic.
- HTTP routes are under `src/routes/api/`.

Do not assume `src/lib/reader/` is the extraction source directory. Some old npm
test arguments referenced that obsolete location and were corrected to root `reader/`.

### 4.3 Important API routes to preserve

```text
/api/read
/api/save
/api/links
/api/collect
/api/collect/status
/api/save-batch
/api/save-batch/status
/api/agent/latest
/api/agent/read
/api/docs
/api/openapi
/api/health
/healthz
```

This is not an exhaustive security/API audit. The existing selective save-batch
functionality predated this chat and must not be removed while simplifying code.

### 4.4 File-backed deployment and credentials

- `output/articles/`, `output/links/`, and `output/jobs/` contain saved data.
- API access uses server-side `ACCESS_HASH`, not an account system.
- Agent APIs accept Bearer authentication; supported query-hash authentication remains.
- Keep `VITE_AUTH_ENABLED=false` and `DATABASE_URL` unset.
- Credentials must not be embedded in browser assets or repository content.

### 4.5 Render configuration

`render.yaml` defines one Node web service, Free plan, Singapore, with commit-triggered
deployment and `/healthz` health checks.

Build command:

```sh
NODE_OPTIONS=--max-old-space-size=4096 sh -c 'npm ci --include=dev && npm run lint && npm test && npm run typecheck && npm run build'
```

Runtime uses `scripts/start-production.mjs`, Render-provided `PORT`, all-interface
binding, a 256 MiB old-space limit and 16 MiB semi-space limit. Keep these constraints.
`npm start` supplies the same memory flags and supports the existing local `.env`.

Render Free storage is temporary. Sleep, restart, redeployment, or platform actions
can erase articles and job records. Background jobs are best-effort and do not
automatically resume after interruption. The proxy does not change these limits.

Set new proxy-related environment variables in Render's service environment; the
local `.env` is ignored by Git and is not deployed as a configuration artifact.
The Blueprint does not contain actual proxy credentials.

### 4.6 Development startup

Existing `startup.sh`:

- Changes to its own directory.
- Checks the local development service.
- Starts it only if needed, in the background.
- Uses `npm run dev`, logging to `.grok/dev.log`.

The dev script uses `scripts/with-app-env.mjs` and listens on port 8080. Do not bypass
the wrapper by launching Vite directly. The wrapper carries app flags, not a secret
store. Ensure unprefixed proxy variables actually reach the server environment;
do not assume client-side Vite `.env` processing configures all server code.

## 5. Conversation chronology and commits

| Commit | Description | Meaning/current status |
|---|---|---|
| `8d4cd02` | Include feed-provided article summaries in link reports | Predates this chat; summary feature preserved. |
| `1abad80` | Add async save-batch endpoint | Intervening historical functionality; preserved. |
| `9271327` | Replace Reuters feed with native JSON API | Historical experiment; not the current catalog URL. |
| `6444164` | Revert Reuters feed to Google News RSS | Historical baseline restored by later reverts. |
| `57d99e3` | Remove Reuters feed from catalog | Explicitly reverted in this chat. |
| `79415d4` | Remove retired news providers and repair RSS test coverage | Explicitly reverted in full in this chat. |
| `a024ec2` | Add optional outbound proxy routing with safe logging and toggle | First proxy implementation; committed and pushed. |
| `7b6d65c` | Revert publisher removals from `57d99e3` and `79415d4` | One combined revert, initially committed without pushing as requested; later pushed. |
| `dbe0eba` | Add Webshare rotating mode and configurable article response limits | Includes proxy research documents; initially local-only, later pushed. |
| `48e5637` | Remove The Hill and Axios and improve proxy extraction reliability | Includes reliability fixes, bypass support, broken service removal, and narrow publisher cleanup; pushed. |
| `bb5535a` | Isolate tests from Render deployment proxy settings | Latest implementation commit; fixes build failure caused by inherited runtime proxy config; pushed. |

The combined revert used the full commits:

```text
57d99e3a168a60272eda69fe1e253e47fb673b21
79415d4996ba0a1d506fb257f3b98bb791289ff1
```

It was not a selective provider-only restoration. Affected files were verified to
match their pre-removal state. This restored older selection/test behavior and a
legacy Reuters JSON branch as well. Later proxy code was preserved. An unrelated
save-batch timing test failed on the first revert validation run and passed on the
full rerun; its production code was not altered for that failure.

Do not revert `7b6d65c` or reapply the whole old cleanup to remove just two sources.
That would unintentionally remove providers the user restored intentionally.

## 6. Current news providers and publisher removals

### 6.1 Authoritative catalog: exactly ten

Source: `attachments/News site RSS feeds by section.md`.

| Provider label | Configured source | Format |
|---|---|---|
| WSJ | `https://flipboard.com/@WSJ.rss` | RSS via WSJ's Flipboard account |
| NY Times | `https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml` | RSS |
| Washington Post | `https://www.washingtonpost.com/arcio/rss/` | RSS |
| Bloomberg | `https://www.bloomberg.com/sitemaps/news/latest.xml` | News sitemap |
| The Economist | `https://www.economist.com/latest/rss.xml` | RSS |
| Financial Times | `https://www.ft.com/?format=rss` | RSS |
| Foreign Policy | `https://foreignpolicy.com/feed/` | RSS |
| CNBC | `https://www.cnbc.com/id/100003114/device/rss/rss.html` | RSS |
| Reuters | `https://news.google.com/rss/search?q=when:24h+site:reuters.com&ceid=US:en&hl=en-US&gl=US` | Google News RSS |
| Business Insider | `https://www.businessinsider.com/sitemap/google-news.xml` | News sitemap |

All catalog rows collect under `Main feed`. With `RSS_LINKS_PER_SECTION=1`, a fully
populated collection can contain one selected article per provider, hence ten total.
This is a limit, not a guarantee every feed always yields an eligible item.

### 6.2 The Hill and Axios cleanup

Removed:

- Both catalog rows and associated descriptions/source links/examples.
- RSS publisher profiles/domain mappings.
- Publisher-name ranking stop words.
- Their publisher-rule documentation.
- Publisher-specific fixtures, source maps, and editorial-order expectations.
- Root reader archive/cloud-blocked domain entries.
- Root reader save-name mappings.
- The corresponding reader test example, replaced with a retained publisher.

Remaining-provider collection tests now assert the exact ten configured source URLs.

A final audit scanned **258 tracked text files**, including root `reader/`, docs,
hidden tracked material, and lockfile metadata. No meaningful references remained
in the scanned scope. Saved `output/`, screenshots, binary/generated/dependency
content, credentials, and opaque package integrity digests were excluded appropriately.

This is **not** a global domain ban on manually supplied article URLs, a purge of
historical data, or a rewrite of Git history.

### 6.3 Retained provider-specific behavior

- WSJ: Flipboard integration, tracking cleanup, Buyside/media filtering remain.
- NYT/FT/CNBC: curated editorial order remains.
- Washington Post: sports/AP byline filtering remains.
- Bloomberg/Business Insider: news-sitemap publication-date handling remains.
- Economist: podcast/media and dated-backlog filtering remains.
- Reuters: Google wrapper resolution, bare-publisher/stock-title filtering remain.
- Generic Google News support is intentionally retained.
- CNBC Investing Club text articles remain eligible; shopping/media/AP filters remain.

### 6.4 Critical freshness change versus the original handover

**Do not repeat the obsolete claim that undated non-editorial entries are excluded.**

Current `src/lib/rss/selection.ts`, rechecked for this handover, applies freshness
rejection only when `publishedAt !== null`:

- Dated non-editorial entries: roughly 72-hour horizon.
- Dated editorial entries: roughly 168-hour horizon.
- Dated entries over 24 hours in the future: rejected.
- **Undated entries can remain eligible**, including non-editorial entries.

This behavior was restored by the user's explicit full revert. Do not silently
change it back under the assumption it is a new regression introduced by proxy work.
If changing it later, explain the trade-off and adjust deterministic fixtures properly.

### 6.5 Reuters JSON code nuance

`src/lib/rss/links.ts` currently contains `parseReutersJson()` and a branch detecting
a Reuters source URL containing `/pf/api/v3/`. They returned with the full revert.
The current catalog uses Google News RSS, so this branch is not the configured path.
Do not describe the native Reuters JSON API as the active production integration.

### 6.6 Feed summary compatibility to preserve

The pre-existing feature remains:

- Use feed-provided text, not AI-generated summaries.
- Do not fetch full pages just to invent feed summaries.
- Markdown keeps `- <URL>` lines and optionally adds an indented `Summary:` line.
- JSON keeps `links: string[]` and adds `articles: { url, summary? }[]`.
- Missing summaries remain omitted; no invented placeholders.
- RSS preference: `description`, `summary`, then namespace-stripped `encoded`.
- Atom preference: `summary`, then inline `content`.
- HTML cleanup and headline/short-stub rejection live in `src/lib/rss/summary.ts`.
- Main helper rejects excerpts under 40 characters and caps text at 1,000 characters.
- Sitemaps are not assumed to supply summaries.
- Generic Google resolution retains summary metadata with the resolved URL.
- Saved Markdown and background task parsing remain compatible.

The restored, inactive Reuters JSON branch is older code and has its own metadata
handling; do not assume every hypothetical branch applies the same summary helper.

## 7. Outbound proxy configuration and implementation

### 7.1 Latest intended settings

The user supplied these settings, and non-secret local values were rechecked while
preparing this handover:

```dotenv
ACCESS_HASH=<private>
FETCH_RETRY_LIMIT=2
RSS_LINKS_PER_SECTION=1
SAVE_CONCURRENCY=1
READ_CONCURRENCY=1
OUTBOUND_PROXY_URL=<private HTTP Webshare gateway URL>
OUTBOUND_PROXY_ENABLED=true
OUTBOUND_PROXY_MODE=rotating
OUTBOUND_PROXY_BYPASS_HOSTS=freedium-mirror.cfd
```

Local `FEED_CONCURRENCY` and `ARTICLE_MAX_RESPONSE_BYTES` were unset at recheck:
effective defaults are 2 and 8,000,000 respectively. Render's actual current
environment has not been independently exported; the user reported using the same
configuration and supplied a successful collection result.

Inline comments are valid in a dotenv file. In Render's environment UI, values must
be just `true`, `rotating`, etc., not the inline explanatory comment.

### 7.2 Environment variable semantics

| Variable | Behavior |
|---|---|
| `OUTBOUND_PROXY_URL` | Server-only HTTP(S) proxy URL; blank/unset means no proxy. Credentials must be URL-encoded as necessary. Non-root paths, query strings, fragments, unsupported protocols, or malformed escapes are rejected. |
| `OUTBOUND_PROXY_ENABLED` | `false` forces direct transport without deleting the URL. `true`, unset, or blank permits URL-based proxy opt-in. A URL is still needed. Values are trimmed/case-normalized; other values fail rather than silently bypassing. |
| `OUTBOUND_PROXY_MODE` | `configured` uses URL credentials unchanged. `rotating` requires `p.webshare.io` and username/password, adding `-rotate` to the decoded username if missing. Unset/blank defaults to `configured`. Invalid modes fail. |
| `OUTBOUND_PROXY_BYPASS_HOSTS` | Comma-separated exact hostnames. Unset/blank bypasses nothing. No URLs, ports, or wildcards. Each redirect destination is checked separately. |

The current example configuration explicitly supplies rotating mode and the mirror
bypass. The runtime defaults are still those in the table; do not conflate an example
file's values with unconditional defaults in code.

Placeholder shape only:

```text
http://USERNAME:YOUR_PRIVATE_PASSWORD@p.webshare.io:80/
```

Rotating mode accepts either the base username or an already suffixed `USERNAME-rotate`
without duplicating the suffix. Do not infer connection type from hostname alone.

### 7.3 HTTP versus SOCKS5

Folio supports HTTP/HTTPS proxy endpoints through Undici `ProxyAgent`, not SOCKS5.
HTTPS publisher content travels through a CONNECT tunnel with certificate validation
and TLS to the publisher. An HTTP proxy endpoint does not encrypt the outer connection
carrying proxy authentication to the proxy; prefer an HTTPS endpoint only if Webshare
actually supports it. Do not simply change the URL scheme and assume it works.

### 7.4 Fresh connections and random IPs

Each `publicFetch()` creates a short-lived dispatcher and destroys it after the
response is buffered or an error occurs. Consequently repeated same-site requests,
retries, and redirect hops use fresh proxy tunnels.

Webshare chooses a random exit from the user's pool. A fresh connection allows
rotation; it does not guarantee uniqueness or prohibit consecutive repeats. No
IP-history tracker, strict round-robin allocator, or no-repeat guarantee was added.

### 7.5 Shared transport and safety

Main implementation: `src/lib/runtime/network.ts`.

- `publicUrl()` rejects non-HTTP(S), URL credentials, obvious local/private/metadata
  destinations, and excessive URL length.
- `publicLookup()` validates the addresses actually used for direct sockets.
- Proxy destinations are resolved locally and validated before CONNECT.
- A composed dispatcher pins CONNECT to the validated public IP/port.
- Publisher origin, Host, TLS SNI and certificate validation retain the publisher name.
- The proxy is not allowed to perform a second destination lookup that bypasses the
  local DNS/private-address check.
- Credentials are passed as proxy authentication, not publisher request headers.
- Proxy username/password are removed from the endpoint URI supplied to the dispatcher.
- Redirects are manual and validated anew.
- Response buffering is bounded; dispatchers are destroyed on completion/failure.

Do not remove IP pinning or disable certificate checks just to make a blocked service
appear to work. Local DNS choice and proxy egress geography can still affect results;
the implementation does not prove identical local and Render paths.

### 7.6 Scope and bypass policy

Shared proxy transport covers publisher/feed fetches, Google wrapper resolution, and
existing third-party retrieval-service fetches. Internal Folio API calls and unrelated
platform connector/auth traffic are not globally proxied.

**Only `freedium-mirror.cfd` is intentionally bypassed in the latest setup.**

- The user confirmed it works from Render's IP.
- `archive.is`, `archive.today`, and `archive.ph` must remain proxied unless the user
  later changes this after verifying Render-side access.
- An early suggestion to bypass archive hosts was based on local tests and was
  explicitly corrected after the user pointed out Render blocks.
- Local `.env` once listed the archive hosts; it was narrowed to just the mirror.
- A bypass is explicit direct routing, not error-triggered fallback.
- Subdomains do not inherit an exact-host bypass automatically.
- If a bypassed host redirects elsewhere, the new hostname may go back through the proxy.
- A publisher can still see a retrieval service's own IP, not the Webshare IP, when
  that third-party service fetches the article downstream. Folio cannot control that hop.

### 7.7 Safe logs

Example proxied response:

```json
{"event":"outbound_proxy_request","site":"https://www.example.com","proxy":"http://p.webshare.io","status":200,"outcome":"response","connectionMode":"rotating","durationMs":420}
```

Failure logs may include `errorCode`, `errorType`, and `proxyStatus`. These are
allowlisted diagnostics, not raw exceptions. For example, an origin status of null
with proxyStatus 407 indicates a CONNECT authentication failure, not an HTTP 407
article response. `status:null` alone is not evidence of an incorrect password.

Bypass example:

```json
{"event":"outbound_proxy_bypass","site":"https://freedium-mirror.cfd","proxy":"http://p.webshare.io","reason":"configured_hostname"}
```

Logs omit proxy credentials and destination path/query strings. Retries and redirects
produce separate entries. `outcome=response` can include HTTP 403/404/429 and does not
mean valid article text. Logs do not identify the actual Webshare exit IP. Cache hits
can return articles without a network/proxy event. Literal URL/configuration rejection
before transport setup may not produce the same per-request event.

### 7.8 Research history

Initial research compared Webshare with public proxy lists and managed-fetch APIs.
The user clarified they wanted only a proxy. No scraping API was integrated and no
separate self-hosted proxy server was deployed. Webshare's published free allowance
was reported as ten shared datacenter proxies and 1 GB/month; this is historical
research, not a permanent pricing guarantee. Recheck official terms if needed.

## 8. Extraction reliability and response limits

### 8.1 Original all-proxy failure pattern

The user reported one collection with 36 selected articles, 18 saved and 18 failed,
compared with their earlier direct result of 33 saved/3 failed. Logs showed many
repeated `freedium.cfd` connection failures and archive timeouts/rate limits.

The inspected local settings then included `FETCH_RETRY_LIMIT=8`, extraction/save
concurrency 2, and rotating proxy enabled. Repeated early-method failures consumed
much of the overall extraction budget before later methods were attempted.

Bounded live checks established:

- Webshare authentication worked and returned different exit IPs on sample requests.
- `freedium.cfd` failed certificate verification directly as well, with
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.
- `archive.is` responded directly in a local check but timed out through one tested
  proxy route; a separate hostname-based proxy sample responded. Those small samples
  were not a reliable causal benchmark or evidence of Render direct availability.
- The certificate failure stopped after one request after the retry fix.

No blanket proxy availability or full-article success guarantee was made.

### 8.2 Broken service removed

`freedium.cfd` and the `freedium` / `freedium-encoded` generated probes were removed
from `reader/targets.ts` at the user's request.

**Do not restore them. Do not remove `freedium-mirror.cfd` by confusing the domains.**
Both `freedium-mirror` and `freedium-mirror-encoded` remain. A regression test checks
that the mirror variants are kept and the retired service is not scheduled.

### 8.3 Fetch retry/deadline behavior

`reader/fetch.ts` now:

- Uses the existing caller's article deadline.
- When proxy configuration is active, caps each method invocation at **6 seconds total**
  across its redirects and retries, further bounded by the caller deadline.
- Caps retries to `min(FETCH_RETRY_LIMIT, 1)` in proxy-active extraction: at most two
  attempts, or one if retries are disabled.
- Applies that proxy-active budget based on enabled proxy configuration, even when a
  particular retrieval hostname is explicitly bypassed.
- Leaves direct-only extraction's existing retry/deadline budget in place, except for
  the added fail-fast rules for permanent failures.
- Preserves ordinary per-attempt caps of 15 seconds, or 10 seconds for text services,
  with the proxy-active six-second total normally being the tighter bound.
- Stops immediately for certificate validation errors, DNS `ENOTFOUND`, proxy 407/402,
  non-transient HTTP 4xx, unsupported content, private URLs, oversized bodies, and 429.
- HTTP 408 remains potentially retryable. Some 429 handling exists at the extraction
  cascade's later second-pass level, not repeated immediate fetch attempts.

These reader caps do not redefine the feed collector's retry policy. Feed collection
still uses its own configured retry limit and backoff, so high global retry values
can still create excessive feed traffic. User's current value is 2.

### 8.4 Probe order

With enabled, nonblank proxy configuration, `reader/targets.ts` first schedules the
original publisher URL with extraction method `direct`. **That method name means
publisher HTML, not a direct network bypass; the transport still uses the proxy.**

Next come the mirror variants, then the existing archive/text/other fallback cascade.
With proxy disabled/unconfigured, the mirror-first behavior remains. Publisher-specific
archive prioritization for retained providers was not broadly rewritten.

### 8.5 Response size fix

The user reported a `Response too large` failure for an FT archive lookup.
The old article cap was 3,000,000 bytes. Current behavior:

```text
ARTICLE_MAX_RESPONSE_BYTES default: 8,000,000
Accepted override: positive integer <= 16,000,000
Invalid/zero/negative/too-large value: fallback to 8,000,000
```

The chosen limit applies to article fetch buffering, including decoded compressed
bodies; streaming overflow cancels the body rather than silently truncating it.
Logs identify the configured article limit and setting name. Oversize errors are not
repeatedly retried. This does not increase feed limits or prove any particular live
archive URL is now complete. HTML parsing can consume much more memory than raw bytes.

### 8.6 Overall extraction and current quality heuristics

`reader/read.ts` currently uses:

- Overall extraction budget: about **48 seconds**.
- Clean URL first, then original query-bearing URL, sharing the total budget.
- A best candidate tracked largely by extracted text length.
- A possible later retry pass for rate-limited probes.
- An in-memory article cache: ten entries, 8 MiB, about 30 minutes.
- Archive-resolution cache: up to 500 entries, about 24 hours.

`reader/extract.ts` currently:

- Uses Readability and JSON-LD/HTML metadata.
- Rejects parsed body text under 280 characters.
- Uses a shell-pattern regex against the title and first 900 body characters.
- Marks text substantial only if length is at least 1,400 characters **and** there
  are at least four paragraphs over 40 characters, split on blank lines.

That paragraph rule can mark long, coherent text partial when paragraph boundaries
are single newlines or lost. Conversely, whitespace/noisy boilerplate can distort
quality checks. The shell regex matches some Wayback failure phrases but does not
reject the generic Wayback description found in the audited WSJ file.

Do not equate a large text length, HTTP 200, `partial=false`, or a successful write
with verified source coverage. Candidate ranking and shell detection need careful
follow-up tests, not blanket removal of all archive-related words from genuine articles.

## 9. Test isolation and Render build repair

### 9.1 Observed Render failure

After `48e5637` was pushed, Render's build failed during `npm test`:

```text
proxy configuration is optional, validated, and errors never echo secrets
Error: OUTBOUND_PROXY_MODE=rotating requires the p.webshare.io gateway with username/password authentication.
```

Cause: a generic unit fixture such as `https://user:password@proxy.example/` called
the URL helper without an explicit mode. Render exposes service variables during
builds, so it inherited `OUTBOUND_PROXY_MODE=rotating` and was correctly rejected.
This was a test-fixture isolation issue, not grounds to weaken runtime validation.

The supplied failure showed 188/189 source tests passing; one failed. Generic
runtime tests could also inherit real proxy settings and perform unnecessary DNS
lookups even when fetch itself was mocked.

### 9.2 Fix in `bb5535a`

Added `scripts/test-env.mjs`, a test-only preload that removes:

```text
OUTBOUND_PROXY_URL
OUTBOUND_PROXY_ENABLED
OUTBOUND_PROXY_MODE
OUTBOUND_PROXY_BYPASS_HOSTS
```

Updated `npm test`, `npm run test:proxy`, and `npm run test:production` to preload it.
It clears only the child test processes' environment; Render's service variables and
the application runtime are unchanged. `start`, `dev`, and `build` do not load it.

Generic fixtures now explicitly request mode `configured`. Regression tests cover
environment-selected rotation, explicit fixture independence, child environment
cleanup, preservation of unrelated variables, and test-only command wiring.

### 9.3 Validation

The full suite passed with inherited proxy variables deliberately present, including
a dummy URL that would be invalid for rotating mode without isolation. This prevented
the test success from depending on whether a developer happened to export proxy vars.

Latest completed counts:

- **223 script tests**.
- **190 source tests**.
- **413 total; zero failures**.
- Focused proxy suite: 17 tests.
- Typecheck and production build passed.
- Production smoke passed with inherited proxy configuration present.
- Lint: zero errors, seven existing warnings.

Do not remove proxy validation or change Render runtime configuration just to make
the old generic fixture pass. Preserve the isolation fix in future test refactors.

## 10. Live Render collection results

### 10.1 Evidence progression

The user supplied several runs, not controlled identical benchmarks:

1. Earlier direct run: user reported 33 saved/3 failed out of 36.
2. Early all-proxy run: 18 saved/18 failed out of 36, many partial saves.
3. After reliability changes with one article per source: 9 saved/3 failed out of 12;
   failures were WSJ, The Hill, and Axios. Seven saved files were marked partial.
4. After removing The Hill/Axios and repairing the Render build: user reported 10
   saved/0 failed out of ten on Render. The subsequent live API reading audited that run.

Do not describe this as a proven 100% extraction-success rate. Sample sizes differed,
URLs changed, cached content may differ, and one final file is demonstrably wrong.

### 10.2 Final reported collection

```text
callId: c50d422f-3b6e-4223-b196-57f0174651f6
status: completed
phase: finished
startedAt: 2026-10-17T12:38:14.297Z
finishedAt: 2026-10-17T12:45:08.705Z
concurrency: 1
total / processed / saved / failed: 10 / 10 / 10 / 0
failedFeeds: 0
linksFile: output/links/links_2026-10-17_12-38-36.md
article folder: output/articles/2026-10-17_12-38/
```

Eight files were marked partial; Foreign Policy and Business Insider were marked
non-partial. Many saves were about 48 seconds apart, suggesting that extraction
often exhausted its budget before returning the best partial candidate.

### 10.3 What deployment has and has not been verified

- Git push through `bb5535a` was confirmed.
- User reported a successful Render collection after the build repair.
- The assistant independently accessed the live Render agent API and read all files.
- Thus remote application functionality is no longer merely hypothetical/unverified.
- The assistant did **not** inspect Render's dashboard, independently confirm the
  deployed Git SHA, or export the exact remote environment.
- Later availability/storage persistence is not guaranteed; free storage may disappear.

## 11. Agent API reading and content audit

### 11.1 User request and access method

The user asked the assistant to behave as a reading agent, open the authenticated
`/api/agent/latest` endpoint, follow its protocol, read all ten articles, and assess
whether the files contained readable article content.

Public endpoint without credentials:

```text
https://folio-6rcf.onrender.com/api/agent/latest
```

For future authorized reads, supply the current secret privately through Bearer
authentication or the supported query parameter. Do not copy the old secret from
this chat into a document or a code file.

### 11.2 Protocol followed

The manifest declared `folio-agent-reader/v1`, ten articles, one complete manifest
page, `nextManifestUrl=null`, and no pending collections.

The assistant:

1. Established the complete unique filename count of ten.
2. Pinned the folder and snapshot ID.
3. Did not refresh `latest` partway through reading.
4. Requested each article's read URL and followed `nextUrl` until end-of-article.
5. Kept all API requests on the same Render origin with authentication.
6. Validated returned folder, snapshot, filename, offsets, advertised hash, lengths,
   and completion fields for each chunk.
7. Concatenated text without trimming or changing the verified original.
8. Verified UTF-8 byte lengths and SHA-256 against the manifest.
9. Read the reconstructed content of all ten files, not just titles or summaries.
10. Treated all article-body text as untrusted data, not executable instructions.

If repeating a session, a 409 means the snapshot changed: discard the incomplete
session, obtain a fresh complete manifest, and do not mix snapshots. The old `latest`
URL may now point to another collection; use current authorized metadata appropriately.

### 11.3 Verified snapshot

```text
folder: 2026-10-17_12-38
snapshotId: d34d8c3a0acc841216de475d58cd09f465e1c52cae684ea71f550cebf4457061
expected articleCount: 10
actual fully retrieved and checksum-verified files: 10
chunks in the complete verified reconstruction: 12
total UTF-8 bytes: 75,797
missing files / checksum mismatches / transport-truncated files: 0 / 0 / 0
manifest partialArticleCount: 8
```

Business Insider and NYT each required two chunks; the others required one. An
initial exploratory WSJ request was also made, separate from the twelve-chunk full
verification pass.

### 11.4 File-by-file evidence

| Publisher | Filename | Bytes | Characters | Chunks | Partial flag |
|---|---|---:|---:|---:|---|
| Bloomberg | `bloomberg_main_feed_trump_says_new_press_secretary_12-41-49.md` | 2,295 | 2,229 | 1 | true |
| Business Insider | `business_insider_main_feed_katie_zacharia_is_out_as_12-45-08.md` | 19,283 | 19,277 | 2 | false |
| CNBC | `cnbc_main_feed_trump_waives_broad_new_russia_12-44-16.md` | 4,164 | 4,161 | 1 | true |
| Financial Times | `financial_times_main_feed_donald_trump_exempts_russia_from_12-43-25.md` | 4,691 | 4,622 | 1 | true |
| Foreign Policy | `foreign_policy_main_feed_israeli_settlers_launch_a_coordinated_12-43-27.md` | 10,578 | 10,428 | 1 | false |
| NY Times | `ny_times_main_feed_how_pennsylvania_explains_the_forces_12-40-13.md` | 18,865 | 18,569 | 2 | true |
| Reuters | `reuters_main_feed_pope_leo_to_leave_hospital_12-45-04.md` | 2,265 | 2,225 | 1 | true |
| The Economist | `the_economist_main_feed_it_s_not_just_commerzbank_italians_12-42-37.md` | 5,144 | 5,079 | 1 | true |
| Washington Post | `washington_post_main_feed_katie_zacharia_out_as_white_12-41-01.md` | 7,851 | 7,721 | 1 | true |
| WSJ | `wsj_main_feed_wayback_machine_12-39-24.md` | 661 | 661 | 1 | true |

All ten reached `endOfArticle=true` and passed checksum verification. The detailed
temporary `audit.json` contains all ten SHA-256 values; its path is in section 14.

### 11.5 Main finding: one false-positive save

**WSJ did not yield the requested article.**

Original URL:

```text
https://www.wsj.com/tech/personal-tech/a-five-day-tour-for-katie-zacharia-75b0107b
```

Saved filename/title:

```text
wsj_main_feed_wayback_machine_12-39-24.md
Title: Wayback Machine
```

Its body contains only the Internet Archive's generic explanation of the Wayback
Machine, Open Library/archive-it projects, and terms of use. It contains none of the
requested WSJ article reporting. Its SHA-256 is:

```text
6c53a51b6725ec35b5f00487ddebc0a5b6846708b1f27c013639453559677f69
```

The API faithfully served the saved file; extraction selected the wrong content.
This should be rejected as a shell/false positive rather than counted as an article.
No corrective code or saved-file replacement was implemented during the reading audit.

### 11.6 Quality assessment of the other nine files

| Publisher | Assessment |
|---|---|
| NY Times | Substantial coherent reporting covering all four Pennsylvania districts and a concluding quote. Marked partial; author and publication metadata missing. |
| Washington Post | Coherent report ending with contributor credit. Marked partial; author/date metadata missing. |
| Bloomberg | Readable short report with coherent ending. Marked partial; author/date missing. |
| The Economist | Coherent article through its concluding paragraph/end marker. Marked partial; author/date missing. |
| Financial Times | Substantial coherent sanctions report. Marked partial; author/date missing. |
| Foreign Policy | Readable newsletter; the introduction and opening paragraph are duplicated, and newsletter sections/related items remain. Marked non-partial. |
| CNBC | Substantive readable reporting, but paragraph boundaries and photo captions run together. Marked partial. |
| Reuters | Readable short report with coherent ending. Marked partial; author/date missing. |
| Business Insider | Substantive profiles covering all six subjects; excessive whitespace, author-follow interface text, and repeated promotional blocks remain. Marked non-partial. |

**Accurate outcome:** zero file-reading failures, nine usable article texts, one
definite content-extraction failure. Seven of the nine genuine article texts are
marked partial. Two marked non-partial still have cleanup defects.

Some partial flags look conservative, but completeness was not independently checked
against publisher originals. Do not declare all nine complete. Checksums prove
faithful transfer of the stored text, not publisher authenticity, source completeness,
or the factual truth of claims made in the saved reporting.

Images were listed in some Markdown files, but external image URLs were not fetched
or visually verified. Do not imply image availability was audited.

### 11.7 Summaries already delivered to the user

The user next asked for summaries and original publishers. The assistant summarized
the saved texts, not independently verified current events:

- **NY Times:** Four Pennsylvania House races illustrate suburban opposition to Trump,
  Latino vote shifts, working-class concerns, and stock-trading controversies.
- **Washington Post:** Zacharia's departure after five days, her appointment/briefing
  controversies, internal White House issues, and possible successors.
- **Bloomberg:** Trump's earlier encouragement that Zacharia reconsider the role after
  a difficult start, preceding her reported departure.
- **The Economist:** Italian acquisitions/expansion in Germany across banking, rail,
  broadcasting, technology, and manufacturing, and proposed takeover restrictions.
- **Financial Times:** Trump's waiver of additional Russia sanctions and associated
  Ukrainian/congressional criticism and wider diplomatic tensions.
- **Foreign Policy:** West Bank settler attacks and an injured journalist, followed by
  other international developments in a World Brief newsletter.
- **CNBC:** The sanctions/tariff waiver, retained existing restrictions, and contrasting
  Russian, Democratic, and Ukrainian reactions.
- **Reuters:** The saved report's account of Pope Leo's expected hospital discharge,
  return to public activity, and uncertainty over health/scheduling.
- **Business Insider:** Profiles of six Trump press secretaries across two terms.
- **WSJ:** No article summary was supplied because the saved content was boilerplate.

These are summaries of stored material. Do not present this handover as independently
corroborating the article claims, dates, quotations, or reported political events.

## 12. Known limitations and next priorities

### 12.1 Recommended priorities if the user requests more implementation

1. **Reject false-positive archive/interface pages.** Add a representative Wayback
   boilerplate fixture and assert it is rejected without banning genuine archive text.
2. **Improve extraction-quality classification.** Separate readable partial text,
   complete-looking content, and invalid/non-article responses. Do not simply suppress
   `partial` warnings to make statistics look better.
3. **Clean extracted formatting.** Preserve paragraph boundaries; remove BI interface/
   promotional text; deduplicate FP lead material; separate CNBC captions from prose.
4. **Improve metadata retention.** Six readable audited files lack author and date;
   FP also lacks publication date. Never invent metadata to fill gaps.
5. **Review candidate ranking.** Raw text length can favor noisy or irrelevant content;
   a shorter but valid article should not lose to a larger shell or boilerplate block.
6. **Make job success meaningful.** Distinguish file persistence from valid article
   extraction and source completeness while preserving API compatibility.
7. **Reassess time spent per article.** Many saves still consumed the 48-second budget.
   Any early-exit improvement must not worsen source coverage or hide partial results.

These are recommendations, **not an active implementation request**. The current
user request is to prepare this handover.

### 12.2 Operational caveats

- A cloud/datacenter proxy may still be blocked.
- Rotation can repeat IPs; no per-request uniqueness guarantee exists.
- Local direct access says nothing definitive about Render direct access.
- Origin requests through third-party retrieval services have another uncontrolled hop.
- One successful Render job does not guarantee future jobs or all article URLs.
- Temporary Render storage can erase the audited snapshot.
- Historical output may include removed providers or old extraction behavior.
- Cached articles can mask network-path changes; controlled comparisons must account
  for cache state without destructive blanket cleanup.
- An 8 MB response limit does not imply 8 MB total parsing memory.
- The current restored feed freshness behavior allows undated entries.
- User access hashes and proxy passwords have been shared in chat; rotate privately.

## 13. Validation and operating procedures

### 13.1 Last implementation validation

Latest full validation was performed for the test-isolation repair, before it was
committed/pushed. It was **not rerun solely to write this document**:

```text
npm test: 413 passed, zero failed
npm run test:proxy: 17 passed
npm run typecheck: passed
npm run build: passed
npm run test:production: passed
npm run lint: zero errors, seven existing warnings
```

The full tests and production smoke were explicitly run with inherited proxy settings
present to reproduce the Render environment issue safely using dummy credentials.
Production smoke used disposable synthetic storage and extraction fixtures, not
publisher fetching or real saved-output writes.

Earlier validation after the two-provider cleanup passed 410 tests, desktop/mobile
development and production rendering, and the source-reference audit. Counts rose
to 413 with the test-isolation regression tests; do not mix these with older 357-test
figures from the opening handover.

Existing lint warnings involve unused variables/arguments in:

```text
reader/targets.ts
scripts/fetch-links.test.mjs
src/lib/batch/save-batch.test.ts
src/lib/batch/save-batch.ts
src/lib/rss/links.ts
src/routes/api/save-batch.ts
```

Two warnings are in one file, for seven total. They are not new build-blocking errors.

### 13.2 Browser checks

Development and production were verified at desktop 1280×800 and mobile 390×844:
visible content, no horizontal overflow, no uncaught browser errors. Screenshots
were visually inspected. The existing utility-app share-card placeholder note was
not treated as a request to change branding.

Relevant paths:

```text
screenshots/two-provider-cleanup-dev.png
screenshots/two-provider-cleanup-dev-mobile.png
screenshots/two-provider-cleanup-dev.json
screenshots/render-production.png
screenshots/render-production-mobile.png
screenshots/render-production.json
```

Generic production screenshot names are overwritten by later smoke runs. A source
change after building requires a new build before relying on production smoke.

### 13.3 Safe follow-up workflow

1. Re-read repository instructions and current Git state.
2. Confirm the actual Node version and environment.
3. Do not print or stage `.env`; use sanitized checks for non-secret configuration.
4. Keep production runtime proxy settings separate from test fixture settings.
5. Test locally with mocks/fixtures before consuming proxy bandwidth or writing output.
6. For deployment issues, compare runtime and build-test behavior explicitly.
7. Do not silently route archive hosts directly or disable TLS as a workaround.
8. Preserve source APIs, saved-output formats, checksum behavior, and async jobs.
9. Obtain commit/push authorization when needed; do not assume it from history.

## 14. File map and supporting artifacts

### 14.1 Main implementation files

| Path | Responsibility |
|---|---|
| `src/lib/runtime/network.ts` | URL/address checks, direct/proxy dispatch, rotation credentials, exact-host bypass, bounded bytes, safe diagnostics/logging, redirect helper. |
| `src/lib/runtime/network.test.ts` | Proxy auth/tunneling, no credential leaks, fresh connections, redirects, bypass, cancellation, DNS safety, configuration/mode behavior, environment regression coverage. |
| `reader/fetch.ts` | Article fetch/retry/redirect handling, proxy-active method budgets, response limits, fail-fast permanent errors. |
| `reader/read.ts` | Extraction cascade orchestration, whole-article budget, caching, best-candidate selection, partial status. |
| `reader/targets.ts` | Publisher/retrieval probe lists and order. Broken original Freedium service removed; mirror retained. |
| `reader/extract.ts` | Readability/JSON-LD parsing, metadata, shell detection, substantial-content heuristic, Markdown rendering. |
| `reader/save.ts` | Safe filenames/directories, publisher names, file persistence. |
| `reader/read.test.ts` | Reader behavior, response-size tests, retry/budget tests, retained/retired extraction service catalog. |
| `src/lib/rss/selection.ts` | Publisher profiles, filtering, freshness, ranking, summary candidates. |
| `src/lib/rss/links.ts` | Feed fetching/collection/report generation, Google resolution, legacy Reuters JSON branch. |
| `src/lib/rss/summary.ts` | Feed-excerpt cleanup and summary rules. |
| `src/lib/agent/articles.ts` | File enumeration, snapshot metadata, safe storage access, checksum-verifiable reading. |
| `scripts/test-env.mjs` | Test-only removal of inherited deployment proxy variables. |
| `scripts/test-env.test.mjs` | Environment isolation and test-command wiring checks. |
| `scripts/fetch-links.test.mjs` | Exact ten-provider catalog and collection/report/API tests. |
| `scripts/feed-selection.md` | Remaining-provider selection policy documentation. |
| `attachments/News site RSS feeds by section.md` | Authoritative current feed catalog and historical research notes for retained sources. |
| `.env.example`, `README.md`, `deployment.md` | Public configuration/setup documentation; placeholders only. |
| `render.yaml`, `startup.sh`, `package.json` | Build/start/test/deploy wiring. |

### 14.2 Research artifacts already committed

```text
reports/Free proxy options for Folio.md
research_notes/Free proxy options for Folio/managed.md
research_notes/Free proxy options for Folio/public-and-hosted.md
research_notes/Free proxy options for Folio/scraping-apis.md
```

These were intentionally included in `dbe0eba` when the user asked to commit all
remaining changes. They are historical comparisons, not integrated scraping services.

### 14.3 Temporary reading audit

Verified content copies and metadata were written outside the repository:

```text
/private/var/folders/l3/39t_9vvx0mscq3wkwxvjd28r0000gn/T/opencode/folio-reading-audit-kLpNX2/
```

Contents include the ten reconstructed `.md` files, `audit.json` with hashes and
verification results, and `.wrapped.txt` presentation copies used to avoid tool line
truncation while reading very long paragraphs. Original verified files were unchanged
by wrapping. No credentials are intentionally stored in those audit artifacts.

This is temporary local storage, not a durable archive or a file guaranteed to exist
in a new session. If unavailable, use the evidence above or re-read the authorized
API snapshot if it still exists. Do not assume the new chat can access temporary
files merely because a path is listed.

### 14.4 This handover

```text
reports/Folio handover 2026-10-18.md
```

It was created for the user's new-chat context and left untracked. No application
code was changed while preparing it. No new test/build run or remote collection
was initiated solely for the handover.

## 15. Suggested opening context for the next chat

The user can paste the following along with this document:

> Continue work on Folio at `<PROJECT_ROOT>`, repo
> `richard875/Folio`, branch `main`. Read project instructions and verify current
> Git state; preserve any new user work. Latest implementation commit at handover
> was `bb5535a`, pushed to `origin/main`.
>
> Root `reader/` is relevant and may be inspected; the old blanket exclusion was
> superseded. Leave historical `output/` untouched unless I ask. Keep the existing
> file-backed Render deployment, `ACCESS_HASH`, no database/accounts, and all API
> features including async save-batch and checksum-verifiable agent reading.
>
> Ten configured providers remain: WSJ, NY Times, Washington Post, Bloomberg,
> The Economist, Financial Times, Foreign Policy, CNBC, Reuters, Business Insider.
> The Hill and Axios were removed intentionally; do not restore them. WSJ/Reuters/
> Business Insider were restored intentionally by a full revert of old removals.
> Current selection code allows undated entries; the previous handover's opposite
> rule is obsolete after that explicit revert.
>
> Webshare HTTP rotating proxy support is implemented. Use `OUTBOUND_PROXY_ENABLED`,
> `OUTBOUND_PROXY_URL`, `OUTBOUND_PROXY_MODE=rotating`, and exact-host bypass list
> `OUTBOUND_PROXY_BYPASS_HOSTS=freedium-mirror.cfd`. Archive hosts remain proxied.
> Do not disable TLS checks, expose secrets, introduce a scraping API, or silently
> fall back to Render's IP. `freedium.cfd` is removed; the mirror is retained.
>
> Proxy-active article methods have a six-second total budget/one-retry cap; overall
> article extraction is about 48 seconds. Article response limit defaults to 8 MB,
> configurable up to 16 MB. Latest tests passed 413 total. Test commands clear
> inherited deployment proxy variables; preserve that Render build fix.
>
> A real Render job reported ten saves/zero failures, but a full authenticated audit
> read all ten files and verified their checksums: nine contain usable article text,
> while the WSJ file is only Wayback Machine boilerplate. Eight files were flagged
> partial. Some genuine long articles likely fail the paragraph heuristic; BI/CNBC/FP
> have cleanup issues. Do not mistake a saved file or matching checksum for successful
> full article extraction. No fixes to those content-quality findings have been made.
>
> The latest request was only this handover. Ask/act on my next request; do not assume
> permission to implement suggested next priorities, commit, push, purge saved data,
> or repeat broad remote collections. Never paste access hashes or proxy passwords.

## 16. Final state and authorization boundaries

**Completed and pushed:** proxy routing/logging/toggle/rotation, bounded larger article
responses, requested historical reversions, retry/deadline diagnostics, explicit
mirror bypass support, broken service removal, The Hill/Axios cleanup, and the Render
test-environment build fix.

**Completed without application changes:** full live agent reading/checksum audit,
content-quality assessment, and publisher-attributed summaries of nine usable texts.

**Not completed or claimed:** fixing the WSJ false-positive save, proving completeness
of all nine article texts, cleaning every formatting defect, independently fact-checking
the stored reporting, verifying images, guaranteeing different IPs every time, durable
Render storage, or inspecting the exact remote deployed commit SHA.

**Pending working-tree item:** this handover document only, unless the user changes
the repository after this check. Do not commit or push it without authorization.

**No unfinished implementation task is implicitly active.** The user asked for a
detailed handover to feed into a new AI chat; wait for their next concrete request.
