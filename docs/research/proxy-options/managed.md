# Managed free proxy services for Folio

## Which ongoing free managed proxies are actually verified?

### Takeaway
Webshare is the strongest verified conventional managed-proxy free plan in this research: 10 shared datacenter IPs and 1 GB/month, indefinitely, without a card. ProxyScrape's genuinely free offering is an unmanaged public-proxy list, not a comparable managed free tier. [Webshare free plan](https://www.webshare.io/features/free-proxy); [Webshare help](https://help.webshare.io/en/articles/8375287-do-you-offer-proxies-for-free); [ProxyScrape free list](https://proxyscrape.com/free-proxy-list)

### Cited Findings
- **Webshare — recommended first conventional-proxy option:** 10 free proxies, 1 GB monthly traffic, no credit card; described as free forever and renewed bandwidth each month. Signup required. The help center explicitly identifies the IPs as **datacenter, shared with multiple users**, warns some sites may block them, and says they never expire. This is not free residential access. [Official free product](https://www.webshare.io/features/free-proxy); [official help](https://help.webshare.io/en/articles/8375287-do-you-offer-proxies-for-free)
- **Webshare protocols/auth:** free product explicitly supports HTTP and SOCKS5. HTTP feature page says SSL proxy support is included in every plan. Official connection examples show an `http://` proxy fetching an `https://` destination (HTTPS tunneling / CONNECT use case); this should not be confused with a guarantee of TLS encryption on the client-to-proxy connection. Direct connections support username/password or authorized source IPs. API management uses a separate `Authorization: Token …` credential. [Free protocols](https://www.webshare.io/features/free-proxy); [HTTP/SSL](https://www.webshare.io/features/http-proxy); [connection documentation](https://apidocs.webshare.io/proxy-connection); [management API auth](https://apidocs.webshare.io/)
- **ProxyScrape — not an ongoing managed free plan:** official shared-datacenter product offers a **free trial**, with paid service starting at $25/month. No recurring free managed allocation is established by this page. It documents username/password authentication and gives HTTP-proxy-to-HTTPS-target examples. Its free-list page advertises HTTP/SOCKS5 for the paid datacenter product. [Premium product](https://proxyscrape.com/premium); [free-list product comparison](https://proxyscrape.com/free-proxy-list)
- **ProxyScrape public list:** free download/API supplies HTTP, HTTPS, SOCKS4 and SOCKS5 entries aggregated from public sources, not a managed customer allocation. Provider explicitly says bandwidth is unknown, endpoints repeatedly go offline, some may be banned, and a proxy may be infected. The unauthenticated public API URL is published on the page. No provider-guaranteed residential pool, traffic allowance, or uptime applies. [Official list and FAQ](https://proxyscrape.com/free-proxy-list)

### Inferences
- For Render, Webshare username/password authentication is conceptually preferable to maintaining source-IP allowlists: it authenticates the application rather than its outbound IP. Compatibility is inferred from standard proxy protocols; **no Render deployment or publisher success test was performed**. [Connection auth modes](https://apidocs.webshare.io/proxy-connection)
- Webshare may solve a block against Render's particular egress IP, but it cannot be presented as a reliable fix for a publisher blocking datacenter networks generally: the replacement IPs are still shared datacenter addresses and Webshare itself warns of site blocks. [Free-plan limitations](https://help.webshare.io/en/articles/8375287-do-you-offer-proxies-for-free)
- Do not rank ProxyScrape's public list beside Webshare as an equivalent managed service; its own reliability/security warnings make it a poor production news-fetch dependency. [Public-list FAQ](https://proxyscrape.com/free-proxy-list)

### Gaps
- Webshare free-tier concurrency, precise country selection, replacement limits, blocked target categories/ports, and byte-accounting details were not established from the retrieved pages. Do not inherit the paid-plan table's 250 GB/unlimited bandwidth or thread counts for the free tier.
- ProxyScrape trial duration, traffic quota and card requirement were not established from its public premium page. Do not invent a 7-day trial or treat it as recurring free traffic.
- No verified ongoing free residential **conventional proxy** plan was found. Search integration returned no results for three discovery queries; direct official-page retrieval provided the evidence above. This is not an exhaustive market-wide claim.
- Verification was of publicly fetched official pages only, not account issuance, actual free proxy endpoints, HTTPS CONNECT handshakes, or publisher access. Do not claim a dated availability test or a publisher success rate.

## Are managed fetch APIs relevant free alternatives?

### Takeaway
If a fetch API rather than a conventional HTTP/SOCKS endpoint is acceptable, Scrapingdog's current official table explicitly offers a tiny recurring free plan. ScraperAPI also acknowledges a free allocation, but its pricing page alone leaves renewal frequency unclear. [Scrapingdog pricing](https://www.scrapingdog.com/pricing/); [ScraperAPI pricing](https://www.scraperapi.com/pricing/)

### Cited Findings
- **Scrapingdog:** pricing table labels Free as **$0 forever**, **100 monthly credits**, **1 concurrent request**, no card. Rotating-proxy fetch costs 1 credit/request; premium proxy 10; JS 5; JS plus premium 25. Thus 100 basic fetches or 10 premium fetches monthly, not 100 premium/article-unblocking requests. All APIs are included; failed requests are refunded. The page says residential and datacenter pools are built in, but does not guarantee that every free basic request exits residential. It is an API-key-based managed-fetch alternative, not evidence of free SOCKS/CONNECT endpoints. [Official pricing table, features and FAQ](https://www.scrapingdog.com/pricing/)
- **ScraperAPI:** official pricing headline offers a **7-day, 5,000-credit no-card trial**; separately its FAQ says a **free plan with 1,000 credits, maximum 5 concurrent connections** exists. That same page does not explicitly say those free-plan credits renew monthly. It also notes variable domain/protection credit costs, so credits are not necessarily pages. Report the distinction rather than merging trial and free quotas. [Official pricing and FAQ](https://www.scraperapi.com/pricing/)

### Inferences
- Scrapingdog is worth listing as a small-volume backup for blocked articles, but its 100-credit allowance is too small to call a general high-volume free news-fetch solution. Residential/anti-bot features may help where shared datacenter proxies do not, without any guarantee for particular publishers. [Credit multipliers and network description](https://www.scrapingdog.com/pricing/)

### Gaps
- Scrapingdog page mixes “free trial” marketing with the explicit “$0 forever / Monthly credits 100” table; the latter supports a recurring plan, but no account was created to verify renewal behavior. Detailed API auth/proxy-mode protocols were outside this conventional-proxy research pass.
- ScraperAPI recurring free reset period and free-tier access to residential/advanced features require documentation/account confirmation before ranking it as an ongoing monthly option.
