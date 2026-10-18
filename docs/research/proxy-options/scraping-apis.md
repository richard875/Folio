# Free scraping APIs for Folio on Render

Research checked 17 October 2026 against official public pages. Research only: no implementation or publisher tests; reader/ and output/ were not inspected.

## 1. Which offers really renew for free?

### Takeaway
ScrapingAnt, ZenRows, and ScraperAPI currently advertise recurring free allowances; ScrapingBee offers signup testing credits, not a documented recurring free allowance. **ZenRows is the strongest documented free option for residential/protected access; ScrapingAnt has the largest basic-request allowance.** [ZenRows pricing](https://www.zenrows.com/pricing), [ScrapingAnt pricing](https://scrapingant.com/#pricing), [ScraperAPI billing](https://docs.scraperapi.com/resources/faq/plans-and-billing), [ScrapingBee trial](https://help.scrapingbee.com/en/article/do-you-offer-larger-trial-plans-1t3zlg2/)

### Cited Findings

| Service | Recurring free allowance | Trial / expiry / card / limits |
|---|---|---|
| ScraperAPI | **1,000 credits/month**, 5 concurrent connections | First **7 days: 5,000 credits**; no credit card required. Trial and ongoing free tier are distinct, not 5,000 free every month. Unused credits do not roll over. [Billing](https://docs.scraperapi.com/resources/faq/plans-and-billing), [pricing](https://www.scraperapi.com/pricing/), [rollover FAQ](https://docs.scraperapi.com/resources/faq/general) |
| ScrapingBee | **No recurring free grant documented** | **1,000 credits when registering**, no credit card required. Official help calls these trial credits. The reviewed official pages do **not specify a calendar expiry**; do not claim either a 7-day expiry or that they never expire. [Pricing](https://www.scrapingbee.com/pricing/), [trial help](https://help.scrapingbee.com/en/article/do-you-offer-larger-trial-plans-1t3zlg2/) |
| ScrapingAnt | **10,000 credits every month**, no credit card | Homepage repeats monthly free allowance, despite retaining some “free trial” / “to start” wording. Unused credits do not transfer to next subscription period. Advertises no concurrency cap on any plan. [Homepage / pricing](https://scrapingant.com/#pricing), [credit rules](https://docs.scrapingant.com/credits-cost) |
| ZenRows | **5,000 credits/month**, no card, 5 concurrent requests | Explicitly **“Free, not a trial”**; monthly refresh, no rollover or free-plan top-ups. Free response limit **5 MB**. Everything unlocked except **standalone** residential proxy product; premium residential routing inside Fetch remains available. [Pricing](https://www.zenrows.com/pricing), [pricing docs](https://docs.zenrows.com/first-steps/pricing) |

### Inferences
- Prefer these current official pages to older comparison articles calling ZenRows merely a 14-day trial. Its live pricing page explicitly says recurring free, and structured page metadata reports modification on **2026-10-13**. [Current pricing](https://www.zenrows.com/pricing)
- ScrapingBee is useful for a one-off comparison, not a sustainable zero-cost fallback based on the published signup offer. [Trial help](https://help.scrapingbee.com/en/article/do-you-offer-larger-trial-plans-1t3zlg2/)

### Gaps
- ScrapingBee's exact trial calendar expiry is unstated in reviewed official sources. ScrapingAnt does not clearly describe free-account monthly reset date or any separate inactivity expiry. [Bee pricing](https://www.scrapingbee.com/pricing/), [Ant pricing](https://scrapingant.com/#pricing)

## 2. How far do free credits go against publisher IP blocks?

### Takeaway
Credits are not requests: residential routes and browser rendering sharply reduce the allowance. ZenRows gives approximately **500 residential-only fetches/month or 200 residential+JS fetches/month**; ScrapingAnt gives approximately **400 residential-only or 80 residential+JS**. These are arithmetic maxima, not measured publisher success rates. [ZenRows costs](https://docs.zenrows.com/first-steps/pricing), [Ant costs](https://docs.scrapingant.com/credits-cost)

### Cited Findings

| Service | Basic / datacenter | JavaScript | Residential / premium without JS | Premium + JS | Stronger tier / caveat |
|---|---:|---:|---:|---:|---|
| ScraperAPI | 1 | 10 | 10 | 25 | Ultra-premium 30; ultra+JS 75, **paid plans only**. Certain domains have separate weights; bypassing Cloudflare, Turnstile, Datadome, PerimeterX or Akamai carries a 10-credit bypass cost. Do not assume flat costs across all publishers. [Official cost table](https://docs.scraperapi.com/getting-started/quick-start/credits-and-requests-costs) |
| ScrapingBee | 1 | 5 (**default**) | 10 | 25 | Stealth+JS 75. Auto-mode can escalate through 1/5/10/25/75 and charges only successful configuration. [HTML API pricing and parameters](https://www.scrapingbee.com/documentation/#Pricing) |
| ScrapingAnt | 1 | 10 (**browser defaults on**) | 25 | 125 | Browser fetching original source without JS: 2 datacenter / 50 residential. [Costs](https://docs.scrapingant.com/credits-cost), [defaults](https://docs.scrapingant.com/request-response-format) |
| ZenRows | 1 | 5 | 10 | 25 | Same feature weights on every plan; Fetch premium proxies use residential IPs. Standalone residential service unavailable on Free is a different product restriction. [Pricing docs](https://docs.zenrows.com/first-steps/pricing), [Fetch reference](https://docs.zenrows.com/fetch/api-reference) |

- Successful-result billing caveats: ScraperAPI charges 200/404 and prematurely client-cancelled requests; ScrapingBee and ZenRows count 200/404/410 results rather than only useful article bodies. ScrapingAnt advertises failed requests cost zero. [ScraperAPI costs](https://docs.scraperapi.com/getting-started/quick-start/credits-and-requests-costs), [Bee FAQ](https://www.scrapingbee.com/faq/), [ZenRows pricing](https://docs.zenrows.com/first-steps/pricing), [Ant pricing](https://scrapingant.com/#pricing)

### Inferences
- **Rank for Folio: 1) ZenRows, 2) ScrapingAnt, 3) ScraperAPI; ScrapingBee trial-only comparison.** ZenRows has the best recurring premium+JS yield (200 vs Ant's 80, ScraperAPI's nominal 40), while Ant wins unrendered datacenter capacity (10,000 vs 5,000 vs 1,000). Derived from official grants and cost tables above, not from an access benchmark. [ZenRows](https://docs.zenrows.com/first-steps/pricing), [Ant](https://docs.scrapingant.com/credits-cost), [ScraperAPI](https://docs.scraperapi.com/getting-started/quick-start/credits-and-requests-costs)
- A quota of 500 residential-only fetches is roughly 16/day shared between feed refreshes and article fetches, so free APIs fit a selective fallback, not indiscriminate frequent feed polling. Arithmetic based on [ZenRows pricing](https://docs.zenrows.com/first-steps/pricing).

### Gaps
- No target publisher URLs or accounts were tested. Marketing bypass claims do not establish success for Folio's blocked publishers. ScraperAPI also does not make its current free-tier feature entitlements as explicit as ZenRows; ultra-premium is explicitly paid-only. [ScraperAPI costs](https://docs.scraperapi.com/getting-started/quick-start/credits-and-requests-costs)

## 3. Do they return raw RSS XML / article HTML rather than extracted text?

### Takeaway
All four expose general fetching APIs with HTML responses, separate from optional extraction products. For RSS, unrendered source fetching is the relevant mode; reviewed documentation does not provide an explicit byte-for-byte RSS XML preservation guarantee for every vendor, so XML compatibility remains a specific test requirement, not a verified result. [ScraperAPI FAQ](https://docs.scraperapi.com/resources/faq/general), [Bee HTML API](https://www.scrapingbee.com/documentation/), [Ant response format](https://docs.scrapingant.com/request-response-format), [ZenRows Fetch](https://docs.zenrows.com/fetch/api-reference)

### Cited Findings
- **ScraperAPI:** REST / proxy / async interfaces return target HTML (or JSON for selected domains); raw fetching is distinct from structured-data/autoparse features. [General FAQ](https://docs.scraperapi.com/resources/faq/general)
- **ScrapingBee:** HTML API explicitly returns **raw HTML**; `render_js=false` avoids headless rendering. Extraction rules, AI queries, Markdown/text conversion and JSON wrapping are optional; `return_page_source` returns original HTML before JS. [HTML API](https://www.scrapingbee.com/documentation/)
- **ScrapingAnt:** general endpoint returns **plain HTML**, with separate JSON response/extraction options. `browser=false` disables browser use; `return_page_source=true` with browser enabled returns server data unaltered by browser and disables JS rendering. [Response/parameters](https://docs.scrapingant.com/request-response-format)
- **ZenRows:** Fetch is separate from Extract; JS defaults false, premium routing defaults false, extraction/output transformations are opt-in parameters. Premium proxies specifically route through residential IPs to address datacenter-IP blocking. [Fetch API reference](https://docs.zenrows.com/fetch/api-reference)

### Inferences
- These hosted HTTP APIs can move publisher-facing requests away from Render's IP, without requiring Folio to host a browser; changing source IP is useful against an IP block but is not a guarantee against publisher policy, authentication requirements or anti-bot systems. This is an architectural inference from their hosted fetching/proxy model, not a tested Render integration. [ScraperAPI model](https://docs.scraperapi.com/resources/faq/general), [ZenRows premium routing](https://docs.zenrows.com/fetch/api-reference)
- Prefer raw-source rather than Markdown/extraction for RSS and Folio's existing HTML parsing. Rendering RSS can change its representation, and paying for JS where it is unnecessary shrinks quotas. Inference from documented source/rendering distinction and costs. [Bee](https://www.scrapingbee.com/documentation/), [Ant](https://docs.scrapingant.com/request-response-format)

### Gaps
- Must verify actual RSS XML body, encoding/content type and non-HTML handling per vendor; reviewed official pages mainly promise HTML, not arbitrary HTTP byte passthrough. No claims made about bypassing paywalls or publisher permission.
