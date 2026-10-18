# Reader: detailed guide for AI agents and maintainers

For the concise human overview, see [README.md](README.md). This guide contains
the implementation map, complete method list, configuration instructions and
operational caveats. Executable configuration remains the source of truth.

## What to edit

| File | Purpose |
| --- | --- |
| **`retrieval.config.ts`** | **Fetch order for each publisher. Start here.** |
| **`methods.ts`** | **Service URL templates, names, user agents, headers and timeouts.** |
| `targets.ts` | Turns those two configurations into an ordered list. No publisher-specific priority logic. |
| `plan.ts` | Prints the effective orders without making network requests. |
| `fetch.ts` | Executes a method: transport, redirects, retries and bounded response buffering. |
| `read.ts` | Coordinates the cascade, URL passes, article caches and candidate selection. |
| `extract.ts` | Parses HTML, extracts metadata/text/images, checks partial content and renders Markdown. |
| `auth.ts` | Verifies the server access hash. |
| `save.ts`, `save-api.ts` | Safe file persistence and save-request handling. |
| `types.ts` | Article response types. |

These configuration files organize the existing retrieval behavior; editing their
orders/templates changes future requests, not historical saved data.

## Publisher order at a glance

**P** = publisher HTML (`direct`), **W** = WallHop (`wallhop`),
**M** = Freedium Mirror (`freedium-mirror`), **F** = the full fallback list below.

| Publisher | Proxy enabled + URL/pool configured | Proxy disabled / neither configured |
| --- | --- | --- |
| The Wall Street Journal | W → P → M → F | W → M → F |
| The New York Times | P → W → M → F | M → W → F |
| The Washington Post | P → W → M → F | M → W → F |
| Bloomberg | P → W → M → F | M → W → F |
| The Economist | P → W → M → F | M → W → F |
| Financial Times | P → W → M → F | M → W → F |
| Foreign Policy | W → P → M → F | W → M → F |
| CNBC | W → P → M → F | W → M → F |
| Reuters | P → W → M → F | M → W → F |
| Business Insider | P → W → M → F | M → W → F |
| Other manually supplied sites | P → M → F | M → F |

Host matching is exact, case-insensitive, and ignores one leading `www.`.
Other subdomains do not inherit a publisher's configuration. These are reader
rules, not the RSS catalog: adding a publisher here does not subscribe to its feed.

### Shared fallback list (F), in order

| Step | Method ID | Destination / variant |
| --- | --- | --- |
| 1 | `freedium-mirror-encoded` | `freedium-mirror.cfd`, encoded article URL |
| 2 | `archive.is-newest` | `archive.is/newest/…` |
| 3 | `archive.today` | `archive.today/latest/…` |
| 4 | `archive.ph` | `archive.ph/…` |
| 5 | `archive.is` | `archive.is/…` |
| 6 | `removepaywalls` | `removepaywalls.com/…` |
| 7 | `removepaywall` | `removepaywall.com/…` |
| 8 | `removepaywall-co` | `removepaywall.co/…` |
| 9 | `wayback` | `web.archive.org/web/…` |
| 10 | `wayback-id` | `web.archive.org/web/id_/…` |
| 11 | `jina-http` | `r.jina.ai/http://…` |
| 12 | `jina-https` | `r.jina.ai/https://…` |
| 13 | `jina-enc` | Legacy encoded Jina URL |
| 14 | `textise-dot-iitty` | Legacy Bing-cache lookup via Jina |
| 15 | `smry` | `smry.ai/…` |
| 16 | `12ft` | `12ft.io/…` |
| 17 | `googlebot` | Publisher URL, Googlebot user agent |
| 18 | `direct-bingbot` | Publisher URL, Bingbot user agent |
| 19 | `direct-facebook` | Publisher URL, Facebook user agent |
| 20 | `direct-twitter` | Publisher URL, Twitter user agent |

These are attempted methods, not guarantees that each service works. The existing
parser accepts HTML; plain-text/Markdown responses from services such as Jina
are still rejected. Those legacy probes are preserved, not repaired by this refactor.
The retired `freedium.cfd` is not scheduled. WallHop uses its normal HTML page,
never `/raw` or `/api`.

## Change a publisher's order

Edit that publisher's arrays in `retrieval.config.ts`. Read them left to right.
For example, WSJ currently has:

```ts
"wsj.com": {
  name: "The Wall Street Journal",
  withProxy: ["wallhop", "direct", "freedium-mirror", ...FALLBACK_METHODS],
  withoutProxy: ["wallhop", "freedium-mirror", ...FALLBACK_METHODS],
},
```

- Move a method ID to move its attempt earlier/later.
- Remove an ID to stop scheduling it in that list.
- Edit both arrays if you want the change in both modes.
- `...FALLBACK_METHODS` expands to the shared list above **at that exact position**.
  Change it once to change all publishers that use it. To customize one publisher's
  tail, replace its spread with an explicit list of the method IDs you want.
- Use only IDs defined in `methods.ts`; TypeScript checks spelling.
- Avoid duplicates. The plan builder keeps only the first occurrence of a method.

Preview the actual configured orders with no article fetching, credentials or writes:

```sh
npm run reader:plan -- 'https://www.wsj.com/economy/example-article'
```

This prints **both** modes; it does not infer your current environment or claim
that every listed method will run before the deadline. After changing configuration,
restart a production process/redeploy to load the rebuilt code. Existing in-memory
article cache hits can avoid fetching altogether.

## Change or add a retrieval method

Edit `METHODS` in `methods.ts`. URL templates support:

| Placeholder | Meaning |
| --- | --- |
| `{url}` | Article URL unchanged |
| `{encodedUrl}` | `encodeURIComponent(articleUrl)` |
| `{urlWithoutProtocol}` | Article URL with leading `http://` or `https://` removed |

To add a service, define its `name` and `url` there, then insert its ID into the
desired publisher arrays. Optional settings are `userAgent`, `attemptTimeoutMs`,
`totalBudgetMs`, and hostname-scoped `headers`. Changing a template changes the
destination for every publisher using that method. Do not put credentials here.

WallHop's 25-second allowance and `X-Wallhop-Load: 1` header live here. The header
is sent only to `wallhop.io`, not forwarded to another redirect hostname. It loads
article HTML from the same normal page URL rather than its JavaScript loading screen.

## Fetch order is NOT proxy routing

The two arrays select **priority**, not transport:

- `withProxy` applies when a valid proxy URL or pool is configured and the toggle allows it.
  It still applies if WallHop or Freedium Mirror are explicitly bypassed.
- The method named `direct` means **publisher HTML**. It still uses Webshare when
  proxy routing is active, unless that publisher hostname is explicitly bypassed.
- Actual routing is controlled by the existing server environment, not these files.
  With this bypass value, only the two exact hosts below connect directly:

```dotenv
OUTBOUND_PROXY_BYPASS_HOSTS=freedium-mirror.cfd,wallhop.io
```

This is an example of the intended environment value, **not a new hardcoded default**.
Archive hosts remain proxied. Each redirect is validated/routed separately; there
is no error-triggered direct fallback. TLS and private-network checks remain enabled.
Third-party services control their own downstream publisher connections.

Server-only `OUTBOUND_PROXY_URLS` optionally supplies a JSON array of 1–16 distinct
proxy URLs, replacing the legacy `OUTBOUND_PROXY_URL` when nonblank. The shared
transport allocates accounts round robin per proxied request, including retries
and redirects. `outboundProxyActive()` checks the whole configuration without
advancing the cursor, so reader-plan/budget checks do not consume account slots.
Bypassed/direct requests do not advance it. Failures consume their assigned slot;
there is no quota-based skipping or hidden direct fallback. The cursor is local to
one Node process and resets on restart/pool change. Webshare rotating mode still
selects random exit IPs independently. See the [pool setup](../README.md#multiple-accounts-round-robin-pool).

## Why later methods can still run after WallHop succeeds

1. `read.ts` tries the URL without query parameters first, then the original URL
   if needed. Both share the **48-second** budget; two URL variants get roughly
   **24 seconds each** for their normal passes.
2. A parsed candidate marked `partial` does not stop the cascade. The reader keeps
   the longest candidate and tries later methods for something substantial.
3. The existing substantial-content rule is at least **1,400 characters AND four
   paragraphs over 40 characters, separated by blank lines**. Lost paragraph
   breaks can mark long articles partial. This refactor does not change that rule.
4. A non-partial candidate ends the normal cascade. Rate-limited methods may get
   a later retry pass if no candidate exists and the total budget remains.
5. `[read] extracted` reports the chosen result at the end, **not a new fetch**.

Not every configured fallback will run before the budget expires. The ordinary
attempt cap is 15 seconds (10 for legacy text services); when proxy configuration
is active, ordinary methods get six seconds total and at most one retry. WallHop
gets at most 25 seconds total in either mode. Caller/pass deadlines can shorten
any of these, and bypassed services still use the proxy-active budget rules.
`FETCH_RETRY_LIMIT` still controls retries subject to these caps. Response buffering
still defaults to 8 MB, configurable up to 16 MB through `ARTICLE_MAX_RESPONSE_BYTES`.

The direct-mode article fetcher defaults to eight retries when unset (up to ten);
feed collection has a separate default of five. Proxy-active ordinary methods
reduce that to at most one. These are configured budgets, not guarantees every
scheduled method gets time to run. Parsing time can exceed a fetch deadline.

## Auth, cache and persistence boundaries

`reader/auth.ts` reads server `ACCESS_HASH`; there is no hardcoded Folio access
key in the current reader. Account-auth scaffolding is disabled separately.
`readArticle()` enforces a shared 24-requests/minute rate limit before cache lookup
and an extraction concurrency limit (default 1, maximum 10). Cache hits avoid
fetches but still count toward that request rate.

Article cache: ten entries, 8 MiB, roughly 30 minutes. Resolved archive URLs:
up to 500 entries, roughly 24 hours. Both are process memory and reset on restart;
clearing them does not require deleting saved output. `save-api.ts` can use a
cached extraction but still writes a new file with `X-Saved-File` on success.
Markdown is the default; JSON also stores derived Markdown. See
[save/save-batch](../scripts/save-articles.md) and [agent reading](../scripts/agent-reader.md).
Render Free files are temporary; no checksum or successful save proves durable
storage, correct source selection, publisher completeness or factual accuracy.

## Verification

```sh
npm run test:reader
npm run typecheck
```

`targets.test.ts` checks the complete publisher orders, method URLs and plan output.
`read.test.ts` covers extraction, fallback execution, WallHop headers and deadlines.
The full `npm test` command includes both. Do not remove the test-environment
preload: it prevents deployment proxy credentials/settings from leaking into tests.
