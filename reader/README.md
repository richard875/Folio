# Article reader

Try retrieval methods in order, parse their HTML, and return the best article text.
Incomplete results allow later attempts, within a 48-second total budget.

## Fetch order

| Publishers | Proxy enabled and configured | Proxy disabled / unset |
| --- | --- | --- |
| WSJ, Foreign Policy, CNBC | WallHop → publisher → Freedium Mirror → fallbacks | WallHop → Freedium Mirror → fallbacks |
| NY Times, Washington Post, Bloomberg, The Economist, Financial Times, Reuters, Business Insider | Publisher → WallHop → Freedium Mirror → fallbacks | Freedium Mirror → WallHop → fallbacks |
| Other sites | Publisher → Freedium Mirror → fallbacks | Freedium Mirror → fallbacks |

**Fallbacks, in order:** encoded Freedium Mirror → Archive.is newest →
Archive.today → Archive.ph → Archive.is → RemovePaywalls.com →
RemovePaywall.com → RemovePaywall.co → Wayback (two variants) →
Jina (HTTP, HTTPS, encoded, Bing cache) → Smry → 12ft →
publisher with Googlebot, Bingbot, Facebook, then Twitter user agents.

WallHop uses normal HTML pages, never `/raw` or `/api`. Listed services are
attempts, not guarantees of working or complete articles.
It requests document navigation first; the legacy load header is used only when
advertised by a loading-page script, within the same 25-second method budget.

**Routing is separate from order:** explicitly bypassing `wallhop.io` and
`freedium-mirror.cfd` makes those hosts direct; others use the configured proxy
when enabled. No hosts bypass it by default. Redirects are checked separately.
An optional `OUTBOUND_PROXY_URLS` pool rotates accounts per proxied request;
bypassed requests do not advance it. [Pool setup](../README.md#multiple-accounts-round-robin-pool).

**Configure:** [retrieval.config.ts](retrieval.config.ts) for order;
[methods.ts](methods.ts) for service URLs and settings.
Feed inventories are separate: [publisher JSON files](../data/README.md), with
only one Main feed per publisher active for automatic collection.

[Detailed AI/maintainer guide →](AI-GUIDE.md)
