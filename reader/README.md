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

**Routing is separate from order:** with the configured bypass list,
`wallhop.io` and `freedium-mirror.cfd` connect directly; other hosts use Webshare
when enabled. Redirect destinations are checked separately.

**Configure:** [retrieval.config.ts](retrieval.config.ts) for order;
[methods.ts](methods.ts) for service URLs and settings.

[Detailed AI/maintainer guide →](AI-GUIDE.md)
