# Free public proxies and free self-hosted relays for Folio Render

## Which publicly listed free proxies are worth considering?

### Takeaway
ProxyScrape and Geonode are useful discovery lists for disposable tests, not production-reliable transport for RSS/article fetching. Neither list makes an unknown endpoint trustworthy or guarantees that a particular publisher will accept it. [ProxyScrape](https://proxyscrape.com/free-proxy-list); [Geonode](https://geonode.com/free-proxy-list)

### Cited Findings
- **ProxyScrape — straightforward programmatic discovery.** Offers HTTP/HTTPS/SOCKS4/SOCKS5, country/anonymity/latency filters, TXT/JSON/CSV export, public API and GitHub mirror. The site says its list refreshes every minute and the mirror every five minutes. Its own FAQ says endpoints constantly go offline, bandwidth is unknown, some endpoints may be banned at the destination, and a public proxy “may be infected.” These explicit caveats matter more than the page's promotional reliability language. [Official list and FAQ](https://proxyscrape.com/free-proxy-list)
- **Geonode — richer visible selection metadata.** Lists protocol, location, uptime, recent check, response-time and anonymity information; offers exports and an API option. It explicitly says there is **no uptime guarantee**, endpoints can disconnect without warning, checks cannot guarantee success for your request, and operators/logging policies may be unknown. Its recommended free-list use is learning and short tests on public data, not dependable repeated workloads. [Official list and explanations](https://geonode.com/free-proxy-list)
- **Do not treat anonymity labels as security endorsements.** Geonode explicitly warns that “elite”/anonymous labels do not guarantee privacy, security or safe handling; it says never send passwords, payment details or private information through unknown servers. [Geonode](https://geonode.com/free-proxy-list)
- **HTTP article/RSS targets are exposed.** With ordinary HTTP forwarding the proxy receives the request and response; without target TLS, it can read or alter feed/article content. For an **HTTPS target through an HTTP proxy**, CONNECT creates a tunnel and the client encrypts and verifies TLS to the publisher; the proxy cannot read or modify that encrypted payload without breaking encryption. An `http://` proxy address therefore does **not** imply that an `https://` target becomes plaintext. [curl project's CONNECT explanation](https://everything.curl.dev/usingcurl/proxies/http.html)
- A free-list “HTTPS” label often describes support for HTTPS websites, not a promise of TLS on the client-to-proxy transport: Geonode's HTTPS example uses an `http://IP:PORT` proxy, and says the website connection provides encryption. Distinguish **CONNECT support** from **TLS-to-proxy**; keep publisher certificate verification enabled. [Geonode protocol table/example](https://geonode.com/free-proxy-list); [curl CONNECT](https://everything.curl.dev/usingcurl/proxies/http.html)

### Inferences
- **Recommendation:** if a list must be offered, list ProxyScrape first for convenient API/mirror access and Geonode second for metadata, but do not rank either as faster, safer or more reliable: that would require target-specific measurements. Neither should be Folio's default fetch path. [ProxyScrape caveats](https://proxyscrape.com/free-proxy-list); [Geonode caveats](https://geonode.com/free-proxy-list)
- CONNECT protects HTTPS content, not availability or anonymity: the proxy still learns the requested tunnel host/port and connection metadata and can refuse/drop traffic. Public feed URLs may also contain private tokens, so “RSS” does not automatically mean safe-to-share public data. This is protocol/security reasoning, not a measured provider finding. [CONNECT mechanics](https://everything.curl.dev/usingcurl/proxies/http.html)

### Gaps
- No independent or Folio-specific success-rate/latency benchmark was performed. Do not repeat Geonode's promotional uptime/speed comparison figures as established benchmarks; the page does not establish a methodology applicable to Folio. [Geonode comparison](https://geonode.com/free-proxy-list)

## Is Cloudflare Workers Free a good self-managed fetching relay?

### Takeaway
Workers is technically attractive for a small application-specific fetch service, but **not a residential proxy or dependable cure for datacenter-IP blocks**. Crucially, Cloudflare's self-serve agreement expressly restricts VPN or similar proxy services: do not recommend a general-purpose free proxy Worker as unconditionally permitted. [Limits](https://developers.cloudflare.com/workers/platform/limits/); [Terms §2.2.1(j)](https://www.cloudflare.com/terms/); [Worker identification](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-worker)

### Cited Findings
- Free allowance: **100,000 requests/day**, **10 ms CPU/request**, **128 MB memory**, **50 subrequests/invocation**. Network waiting does not count as CPU; redirect hops count toward subrequests. This can suit lightweight RSS/HTML relay work, but is not a free full browser/rendering service. [Official limits](https://developers.cloudflare.com/workers/platform/limits/)
- A Worker is an application HTTP endpoint using outbound fetch, not a drop-in conventional forward proxy: Workers' Request API does not support the CONNECT method. [Request documentation](https://developers.cloudflare.com/workers/runtime-apis/request/)
- Worker fetch traffic is identifiable: Cloudflare adds `CF-Worker` to all fetch subrequests and documents WAF expressions for blocking a specific Worker's zone or essentially all Worker subrequests. Cross-zone Cloudflare requests also have documented special client-IP behavior. Thus, using Cloudflare does not imply publisher bot/block exemptions. [Official HTTP headers reference](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- **Material ToS restriction:** self-serve agreement §2.2.1(j), unless expressly permitted in writing, forbids using Services “to provide a virtual private network or other similar proxy services.” §2.2.1(c) also forbids circumventing Cloudflare's own usage limits. [Self-serve agreement](https://www.cloudflare.com/terms/)
- Developer Platform terms separately require compliance with applicable third-party terms, allow throttling for undue network burden and suspension for suspected agreement violations. They do not provide an explicit blanket exception to the proxy restriction for Folio's proposed relay. [Developer Platform service-specific terms, clauses 1–4](https://www.cloudflare.com/service-specific-terms-developer-platform/)

### Inferences
- **Recommendation: conditional, not top unconditional recommendation.** A narrowly scoped Folio feed-fetching application differs from selling an open VPN/proxy, but the cited agreement does not settle that boundary. Obtain Cloudflare clarification before depending on a relay whose central purpose is proxying arbitrary third-party URLs. Do not describe “private/authenticated” as automatically curing the contractual issue. [Agreement](https://www.cloudflare.com/terms/); [Developer terms](https://www.cloudflare.com/service-specific-terms-developer-platform/)
- Workers may help if the current host's particular egress IP is blocked, but it substitutes Cloudflare infrastructure rather than residential identity. It may fail just as readily when the publisher blocks cloud traffic or Workers specifically; there is no sourced success guarantee. [Cloudflare's documented Worker blocking](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-worker)

### Gaps
- No written Cloudflare determination for Folio's exact use case and no publisher-specific acceptance tests. Technical feasibility is not contractual approval. [Relevant contract](https://www.cloudflare.com/terms/)

## Which free self-hosted alternative is the best shortlist choice?

### Takeaway
**Oracle Always Free VM is the clearest free-infrastructure candidate in this shortlist for an operator-controlled relay**, if capacity is available and the maintenance/reclamation risks are acceptable. It still supplies cloud/datacenter egress, not a free residential unblocker. [Oracle official Always Free documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

### Cited Findings
- Oracle documents up to **two AMD E2.1.Micro VMs**, each with 1 GB memory, and Always Free eligible Arm compute. Resources must be provisioned in the tenancy's **home region**. It also documents **200 GB combined block/boot storage** and **10 TB/month outbound transfer**. This is an ongoing free allocation, distinct from trial credits. [Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- **Check current Arm limits, not stale guides:** the official page retrieved for this research states **1,500 OCPU-hours and 9,000 GB-hours/month**, equivalent to **2 OCPUs/12 GB** for Always Free tenancies. Do not confidently repeat older 4-OCPU/24-GB figures. [Oracle current page](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- Oracle explicitly warns about “out of host capacity” errors and says idle Always Free instances **may be reclaimed**. Idle classification evaluates a seven-day period and utilization thresholds; a low-volume news relay may therefore be vulnerable to reclamation. [Oracle capacity and idle-instance sections](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

### Inferences
- **Practical shortlist:** (1) Oracle free VM for controlled infrastructure, with operational caveats; (2) Workers only with contractual clarification and no claim of residential unblock capability; (3) ProxyScrape and Geonode only for temporary non-sensitive experiments. This ranking is a suitability judgment, **not** an empirical performance ranking. [Oracle caveats](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm); [Cloudflare restriction](https://www.cloudflare.com/terms/); [ProxyScrape](https://proxyscrape.com/free-proxy-list); [Geonode](https://geonode.com/free-proxy-list)
- Owning the relay removes the arbitrary public-proxy operator from the trust path, but means owning patching, access control and monitoring. Never expose an unrestricted open relay; a private relay is not equivalent to permission to bypass publisher restrictions. Oracle's described cloud infrastructure does not establish residential egress or publisher acceptance. [Oracle infrastructure description](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

### Gaps
- Oracle signup eligibility, live regional capacity, and publisher-specific policies were not tested; its free-resource page is not a proxy-use authorization or an uptime promise. No free option here is evidenced as dependable production-grade residential access. [Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
