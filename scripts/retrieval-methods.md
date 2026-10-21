# Retrieval-method verification

Folio's method list is a fallback plan, not a promise that every remote service
can extract every publisher. See [reader configuration](../reader/AI-GUIDE.md).
Publisher orders and the ten daily Main feeds are unchanged.

## Routing and repeatable checks

Use Node 24.20.0. Set the server-only proxy configuration privately and use only:

```text
OUTBOUND_PROXY_BYPASS_HOSTS=freedium-mirror.cfd,wallhop.io
```

Every other destination, including a redirect away from these exact hosts, uses
the configured proxy. Bot user agents change HTTP headers, not routing. Third-party
services control their own downstream requests; Folio cannot configure those.
Never disable certificate validation or silently fall back to direct networking.

The offline planner makes no requests:

```sh
npm run reader:plan -- 'https://www.paulgraham.com/worked.html'
```

The live audit is explicitly opt-in and loads an existing local `.env`. It refuses
missing/disabled proxies, unknown methods, private URLs and a different bypass list:

```sh
npm run reader:audit -- --live 'https://www.paulgraham.com/worked.html'
npm run reader:audit -- --live 'https://medium.com/47670dfb6f25' freedium-mirror,freedium-mirror-encoded
```

It runs two workers, disables automatic retries, and uses the production method
deadlines and byte limits. Each method is tested independently, unlike the API
cascade, which stops at a substantial result and has 48 seconds overall. Ordinary
proxy-active methods have six seconds, Wayback ten, WallHop 25; caller deadlines
can shorten these. No output/articles files are written. Metadata-only results go
to ignored `docs/qa/method-audit/latest.json`, without bodies, target queries,
credentials or arbitrary exception messages. Each run replaces that report.

Exit codes: **0** all selected methods returned substantial candidates; **2** some
failed, were partial, or returned no usable article; **1** invalid configuration.
“Substantial” is a text/paragraph heuristic, not independent completeness proof.

## Observed results — 22 October 2026 local audit

All **23** configured methods were tested independently on a public long-form
control (`https://www.paulgraham.com/worked.html`). The other 22 methods were also
tested on the previously reported WSJ article. Freedium received additional cached
and uncached Medium tests. Three configured rotating proxy accounts were used;
only the two intended service hosts bypassed them. These are local observations,
not Render deployment checks or publisher-wide success rates.

| Methods | Observation |
| --- | --- |
| `wallhop` | Control returned 74,972 extracted characters directly. The earlier WSJ fix remains intact. |
| `direct` | Control returned 74,972 characters through the proxy; WSJ returned 401. |
| `freedium-mirror`, `freedium-mirror-encoded` | Both returned 9,962 characters on the cached Medium example, directly. WSJ explicitly returned `UNSUPPORTED_SITE` in an HTTP 200 page. The uncached Medium example returned `UPSTREAM_BLOCKED`; neither error is an article. |
| `archive.is-newest`, `archive.is`, `archive.ph` | Rate-limited (429) and/or timed out through the proxy. No valid extraction established. |
| `archive.today` | Redirected to a snapshot but timed out, including a separate bounded 20-second diagnostic. |
| `removepaywalls` | Article routes returned 404; homepage advertised a hosting placeholder redirect. |
| `removepaywall` | Its advertised `www.removepaywall.com/search?url=…` route returns an archive-picker UI, not article text. Template now avoids two normalization redirects. |
| `removepaywall-co` | Redirected to a JavaScript reader interface; shell text rejected. No usable static article established. |
| `wayback`, `wayback-id` | Corrected `/web/2/…` and `/web/2id_/…` each returned an actual timestamped snapshot with 74,972 characters through the proxy in diagnostics (about 8.2/5.6 seconds). Subsequent fixed-template retests still suffered timeout/proxy 502. Functional but unreliable on these exits. |
| `jina-http`, `jina-https`, `jina-enc` | Each returned a full Markdown envelope during testing. The old HTML-only parser discarded it; the new scoped parser accepts it (about 77,350 characters). Other requests returned 401 or timed out, so availability varies. |
| `textise-dot-iitty` | Legacy Bing-cache-via-Jina probe returned 401/403; no usable extraction established. |
| `smry` | HTTP 200 but a JavaScript application shell, not static article text. |
| `12ft` | TLS failed with `DEPTH_ZERO_SELF_SIGNED_CERT`; validation remains enabled. |
| `googlebot`, `direct-bingbot`, `direct-facebook`, `direct-twitter` | All four returned the control's 74,972 characters through the proxy. All four received WSJ 401 responses. |

Blocked, unavailable and browser-only services remain explicit fallback entries;
none was silently replaced with a guessed API or given a direct bypass. A full
cascade may run out of time before reaching its later entries.

## Implemented safeguards and regressions

- Accept Jina's default Markdown envelope only for its configured methods and exact
  service hostname; reject malformed envelopes, private/credential-bearing source
  URLs and upstream warning responses. Generic JSON/plain text is not an article.
- Decode Freedium's advertised streamed HTML JSON string without evaluating JavaScript,
  importing scripts, or contacting internal service addresses. Ordinary cached HTML
  remains on the existing Readability path.
- Use actual final URLs for every method's provenance and relative images, not just
  Archive.is. Match Archive.is cache destinations by hostname, not substring.
- A substantial fallback now outranks a longer partial candidate; previously the
  cascade could stop on success but return the older partial candidate instead.
- Wayback's own calendar/JavaScript pages titled “Wayback Machine” are rejected,
  rather than saved as short partial articles.
- Offline tests cover every configured method's dispatcher, exact-host bypasses,
  redirect re-entry to the proxy, method formats, candidate selection and deadlines.
  Live failures are not converted into successful fixtures or completeness claims.
