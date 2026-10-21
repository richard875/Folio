# Feed catalog

The inventory is split into **ten publisher JSON files**, bundled into the server
through [`sources.ts`](../src/lib/rss/sources.ts). Rebuild/redeploy production
after changes. The former combined `feeds.json` is removed. Research documents
are not runtime data sources.

## Main-feed-only operation

**Only the single `section: "Main feed"` entry in each file is operational for daily collection.**
`GET`/`POST /api/links`, `GET`/`POST /api/collect`, and their downstream automatic
article-saving workflows use exactly these ten sources. The other 1544 entries
are inactive reference inventory in those operations: never fetched, ranked, used
for corroboration, or used as fallback feeds there. Their query parameters and
POST bodies cannot enable them.
An unavailable main feed is reported as failed; no subsection is promoted.

The separate [interactive selective workflow](../scripts/selective-feeds.md)
adds authenticated OR-keyword `/api/feed-catalog` discovery over all entries and
`POST /api/feed-fetch` for bounded explicit catalog-ID selections. This is the
only exception to reference-only sourcing, not a daily fallback or activation of
all inventories. Descriptions derive from catalog labels; formats are detected
from content. Availability and extraction compatibility remain unverified.
In the publisher research sections below, "inactive" refers to daily collection;
explicit selective fetching may attempt those stored references within its limits.

| Publisher | File | Stored entries | Active entries |
| --- | --- | ---: | ---: |
| WSJ | [wsj.json](wsj.json) | 36 | 1 |
| NY Times | [nyt.json](nyt.json) | 714 | 1 |
| Washington Post | [wapo.json](wapo.json) | 53 | 1 |
| Bloomberg | [bloomberg.json](bloomberg.json) | 61 | 1 |
| The Economist | [economist.json](economist.json) | 64 | 1 |
| Financial Times | [ft.json](ft.json) | 427 | 1 |
| Foreign Policy | [foreignpolicy.json](foreignpolicy.json) | 65 | 1 |
| CNBC | [cnbc.json](cnbc.json) | 104 | 1 |
| Reuters | [reuters.json](reuters.json) | 81 | 1 |
| Business Insider | [businessinsider.json](businessinsider.json) | 129 | 1 |
| **Total** | | **1734** | **10** |

Each file must contain only its assigned publisher and exactly one main feed.
Missing, duplicate (even identical), or malformed main-feed configuration fails
closed; there is no first-row fallback. Main feeds retain their existing URLs,
ordering and metadata. `selectMainFeeds()` enforces the rule at both the links
handler and report generator, before network work.

This is a restriction on **automatic RSS/feed sourcing**, not an article-URL
allowlist. Explicit `/api/read`, `/api/save`, and `/api/save-batch` article URLs
and already-saved/imported articles remain usable. Agent read endpoints read
saved files, not these feed inventories. Historical link reports and output are
not rewritten or purged; fresh collections always use only main feeds.

| Field | Values |
| --- | --- |
| `site` | Publisher label, e.g. `WSJ` |
| `section` | Per-publisher collection grouping, e.g. `Main feed`, `World News`, `Japan — Markets` |
| `url` | Complete HTTP(S) feed URL, without credentials |
| `ordering` | `editorial`, `newest`, `google-ranked`, or `feed` |
| `format` | `rss` (RSS/Atom) or `news-sitemap` |
| `homepageScore` | Optional number from 0 to 10; coverage weight, not article importance |
| `edition` | Optional informational label |

The first five fields are required. Unknown fields and invalid entries fail
validation. Duplicate non-main site/section/URL entries keep their first position
in generic validation; duplicate Main feeds are always rejected, even if identical.
`format` describes the source; the XML parser still detects its actual structure.
`editorial` preserves curated order, `newest`/`google-ranked` use freshness and
coverage ranking, and `feed` uses the existing publisher-profile fallback.

## Current coverage

The stored inventory has **1734 entries across ten publishers**: **36 WSJ feeds**,
**714 NY Times feeds**, **53 Washington Post feeds**, **61 Bloomberg feeds/sitemaps**,
**64 Economist feeds**, **427 Financial Times feeds**, **65 Foreign Policy feeds**,
**104 CNBC feeds**, **81 Reuters feeds**, **129 Business Insider feeds**, and exactly one `Main feed` per publisher.
`RSS_LINKS_PER_SECTION` caps each active publisher's `Main feed`. With a limit
of 1, up to ten article entries can be returned (one per publisher); with the
default of 5, up to 50. Empty, stale, failed or filtered main feeds can yield
fewer. The research inventories below are preserved for reference, not enabled.

### WSJ stored article-feed inventory

The existing Flipboard `Main feed` is retained. The 35 additions below come from
the user-supplied *WSJ RSS Feeds: Complete Verified List* dated 21 October 2026:
15 standard English sections, eight unlisted English feeds, eight Japanese
feeds (including the new Personal Technology feed), and four legacy feeds
reported as updating. This records the research's status, not a new live
availability audit or extraction guarantee.

All WSJ feeds use `ordering: newest`, `format: rss`, and the existing publisher
weight `homepageScore: 8`; no new per-section importance scores or curated homepage
order are inferred. Japanese entries use `edition: Japan` and distinct `Japan — …`
section names under the same `WSJ` publisher; all other WSJ entries use `US`.
Edition is informational: it does not filter language or create a new publisher.

Current-server URLs use `https://feeds.content.dowjones.io/public/rss/` plus the
exact feed name below, **without `.xml`**. Markdown's escaped underscores have
been restored to literal underscores in the JSON URLs.

| Section | Current-server feed name |
| --- | --- |
| World News | `RSSWorldNews` |
| U.S. News | `RSSUSnews` |
| Politics | `socialpoliticsfeed` |
| Economy | `socialeconomyfeed` |
| U.S. Business | `WSJcomUSBusiness` |
| Technology | `RSSWSJD` |
| Markets | `RSSMarketsMain` |
| Personal Finance | `RSSPersonalFinance` |
| Real Estate | `latestnewsrealestate` |
| Health | `socialhealth` |
| Opinion | `RSSOpinion` |
| Arts & Culture | `RSSArtsCulture` |
| Lifestyle | `RSSLifestyle` |
| Style | `RSSStyle` |
| Sports | `rsssportsfeed` |
| Markets briefs | `rssmarkets` |
| Markets (social) | `socialmarketsfeed` |
| Tech (social) | `socialtechfeed` |
| Central Banking | `socialcentralbankingfeed` |
| Lifestyle (public) | `wsj_lifestyle` |
| Food & Drink | `wsj_food_drink` |
| Homepage (partner) | `wsj_homepage` |
| World News (email) | `wsj_world_news` |
| Japan — World | `RSSJapanNewsWorld` |
| Japan — Markets | `RSSJapanMarket` |
| Japan — Business | `RSSJapanBusiness` |
| Japan — Technology | `RSSJapanTechnology` |
| Japan — Opinion | `RSSJapanOpinion` |
| Japan — Life | `RSSJapanLife` |
| Japan — Heard on the Street | `RSSJapanHeardonTheStreet` |
| Japan — Personal Technology | `RSSJapanPersonalTechnology` |

Legacy URLs use `https://feeds.a.dj.com/rss/` plus the case-sensitive filename:

| Section | Legacy filename |
| --- | --- |
| Opinion (legacy latest) | `LatestNewsOpinion.xml` |
| Real Estate (legacy latest) | `LatestNewsRealEstate.xml` |
| Sports (legacy latest) | `LatestNewsSports.xml` |
| What's News (legacy) | `RSSWhatsNews.xml` |

The partner homepage and internal email feeds may disappear without notice;
social feeds can contain short blurbs. The public lifestyle feed may include
share-token article links. Legacy feeds can return HTTP 200 but have no eligible
recent articles: the supplied research's latest What's News item was 6 October,
outside the existing 72-hour non-editorial window on 19 October. Sports can also
age out. A configured feed is not a promise of a fresh article on each run.

Podcasts (including active shows), sponsored series, frozen/empty feeds, Japanese
Barron's/Capital Journal, JSON mirrors, dead URLs and unverified YouTube are not
included in the stored inventory. The existing article/media/sponsored-content
filters apply to active Main feed candidates; stored Japanese feeds are not
executed, and their text extraction or publisher access is not newly guaranteed.
Adding reference inventory alone does not create collection requests or proxy
traffic. Only the selected Main feed participates; the other WSJ feeds do not
contribute candidates or cross-publisher corroboration.

### NY Times stored article-feed inventory

The existing HomePage `Main feed` is retained unchanged. The inventory was first
assembled from `nyt_rss_feeds.xlsx` and then corrected using the replacement
`nyt_rss_feeds_new.xlsx` and the updates documented in `economist_rss.md` (both
workbooks contain `Summary` and `All feeds` sheets, with 858 feed rows). The
corrected workbook counts 624 live, 53 slowing and 181 stale feeds. The 21 October
2026 re-check (`nyt_rss_feeds.xlsx`) added **205 Athletic feeds** (team, city,
league and section feeds from The Athletic), 6 YouTube channels and 3 Athletic
podcasts, bringing the workbook to 1,074 rows. Of those, **172 new live Athletic
feeds** were added to `nyt.json`. The final stored NYT inventory has 715
text-feed entries; prior Markdown progress counts and the superseded workbook are
not current totals.

**These URLs were not directly verified.** The supplied research could not access
NYT feeds; statuses come from Feedly's newest indexed item and Apple Podcasts.
Some modern collection/Athletic URLs are inferred replacements for older URLs,
not confirmed redirect destinations. `live` means updated within 30 days in that
research, not that a URL currently works, contains text articles, or has an item
within Folio's 72-hour window. No new live network audit was performed.

| Included group | Feeds |
| --- | ---: |
| Section feeds (`rss.nytimes.com`), including HomePage and Spanish | 66 |
| Sub-sections/sections (collection URLs) | 26 |
| Columns and recurring text features | 37 |
| Writers | 49 |
| Newsletters/series | 2 |
| Spotlights | 6 |
| News events | 2 |
| Topics: subjects | 99 |
| Topics: places | 85 |
| Topics: companies | 14 |
| Topics: organizations | 15 |
| Topics: people | 2 |
| Athletic: leagues/sports (excluding Podcasts) | 43 |
| Athletic: teams (NFL/NBA/MLB/NHL/soccer/college football) | 166 |
| Athletic: cities | 39 |
| Athletic: writers | 9 |
| Athletic: newsletters/tags | 2 |
| Other products: Chinese simplified/traditional, Cooking, Wirecutter | 4 |
| **Total NY Times** | **543** |

Every exact NY Times URL and section label is in [`nyt.json`](nyt.json). Section feeds
use `https://rss.nytimes.com/services/xml/rss/nyt/<Name>.xml`; collection URLs use
`https://www.nytimes.com/svc/collections/v1/publish/https://www.nytimes.com/<path>/rss.xml`.
Athletic URLs use `https://www.nytimes.com/athletic/rss/<path>/`. Only explicit URLs
from the workbook's URL column were added, not alternate-URL cells or templates.
The research Markdown's Spanish `/es/feed/` alternate is not an additional feed.

Section names distinguish `Column — …`, `Writer — …`, `Topic (subject/place/…) — …`,
`Spotlight — …`, and `Athletic — …`; similar titles in different categories are
not assumed to be identical. MostEmailed/MostShared/MostViewed retain distinct
labels despite sharing the title Most Popular. Preserve the source's swapped
names: `Style.xml` is labelled Fashion and `FashionandStyle.xml` is labelled Style;
the corrected inventory uses the canonical `Fashion.xml` row, not its duplicate
`Style.xml` address.

All remain under publisher `NY Times`, including Athletic and sister products;
they are not independent corroborating publishers. They inherit the publisher's
`homepageScore: 8` and `format: rss`. **Only HomePage retains `ordering: editorial`**;
all additions use `newest` (date/coverage ranking), not a claim of editorial or
popularity order. Spanish and the two Chinese feeds have explicit language edition
labels; other NY Times entries retain `US`. Edition is informational, not a language
filter or a publication location inferred from a topic name. Extraction of recipes,
Chinese/Spanish articles, and Athletic/Wirecutter pages is not newly guaranteed.

#### NY Times corrections and exclusions

The corrected workbooks supersede the earlier research workbooks. **Corrected 20 October
2026** against actual newest article dates, with **23 of 858** row statuses changed:
15 previously stored reference URLs are now slowing/stale and were removed. Two live
text URLs were added (Soccer and Tripp Mickle), three slowing/stale feeds became live
again (Fashion, Jobs, Soccer), and Fashion now uses `Fashion.xml` instead of the
`Style.xml` alias. The live `JobMarket.xml` URL is not duplicated because `Jobs.xml`
is already stored. The corrected inventory therefore contains 543 entries; the
HomePage Main feed is unchanged. The live `JobMarket.xml` URL is not
duplicated because `Jobs.xml` is already stored. The corrected inventory therefore
contains 543 entries; the HomePage Main feed is unchanged. The corrected file marks every one of these 543 stored URLs live.

Of the 858 corrected workbook rows, the following categories remain excluded from
the stored text inventory:

| Reason | Rows |
| --- | ---: |
| `slowing` (outside the research's 30-day live window) | 53 |
| `stale` (more than a year without an indexed update) | 181 |
| Audio podcast feeds, including legacy podcast feeds | 38 |
| Podcast/video/quiz/game-focused collection feeds | 15 |
| Redundant legacy redirects or placeholder URL patterns | 18 |
| Duplicate section aliases | 8 |
| Corporate news/investor releases (`nytco.com`) | 2 |

The eight omitted live section aliases are `Books.xml` (prefer `Books/Review.xml`),
`InternationalBusiness.xml` (Business), `Environment.xml` (Climate), `Style.xml`
(Fashion, prefer `Fashion.xml`), `JobMarket.xml` (Jobs, prefer `Jobs.xml`),
`Circuits.xml` (PersonalTech), `GlobalHome.xml` (HomePage) and `Washington.xml`
(Politics). `InternationalHome.xml` is now stale and is counted under that status,
not in this live-alias table. These are deduplication choices based on the supplied
research, not new claims that their current responses are identical.

The 15 live focused collections omitted are Hard Fork, Interesting Times, Op-Docs,
Popcast, The Book Review Podcast, The Daily, The Ezra Klein Show,
The Headlines, The Interview, The Opinions, Student News Quiz, Wordplay (Gameplay),
Shows (podcasts), News Quiz, and Athletic Podcasts. Some may include transcripts,
but they are not treated as general text-news feeds. Mixed text collections such
as What to Watch and Graphics remain stored references, not operational feeds.
`slowing` is not proof a feed is permanently stopped; it is conservatively left
out of the stored inventory. NYT Open is in that group. No row status proves that
Folio can successfully fetch or extract that source.

### Corrected NY Times and Washington Post research

The Economist research included corrected replacements for the earlier NYT and WaPo
workbooks. The corrected NYT workbook is the supplied `nyt_rss_feeds_new.xlsx`:
it rechecked Feedly-indexed rows against actual newest article dates. It reports
**624 live rows**, with 23 status changes from the earlier workbook. The 543-entry
NYT inventory removes 15 newly non-live stored references, adds live Soccer and
Tripp Mickle, corrects the Fashion URL to `Fashion.xml`, and avoids duplicating
the live `JobMarket.xml` alias. The NYT Main feed is unchanged. The workbook's
cached category formulas reconcile all 858 rows. Actual article dates were verified
against Feedly's newest indexed item for each feed.

The corrected WaPo workbook is `washington_post_rss_feeds_new.xlsx`. It rechecks
Feedly dates against newest article dates, reports **56 live rows**, and records
four status changes. All 50 stored text-feed URLs remain live and unchanged — WaPo
is unchanged at 56 — so `wapo.json` required no URL changes. Its Summary formulas
reconcile all 499 rows.
Both updated lists remain third-party research rather than fresh Folio network
audits; only each publisher's Main feed is operational.

### Economist stored article-feed inventory

The existing `latest/rss.xml` Main feed is unchanged. The 63 reference additions
come from `economist_rss_feeds.xlsx` (both sheets, 262 rows) and `economist_rss.md`,
dated 20 October 2026. The workbook reports 69 live, 45 slowing, 144 stale and
four unconfirmed rows; its cached Summary formulas reconcile all 262 records.
The research did not open Economist feeds because its robots.txt bars automated
fetching; dates come from Feedly except Acast/EIU checks. No fresh Economist audit
was performed, and none of these additions is operational.

Stored text-oriented references include the current weekly-edition sections,
1843, 17 older RSS aliases, 15 numbered print-section feeds, one older section
feed, two live graphic-detail blog addresses, and six EIU feeds. Podcasts,
discontinued/stale/slowing/unconfirmed feeds, video, and the podcast-page feed
are excluded. HTTP legacy URLs are preserved as inactive references exactly as
researched; they are not silently upgraded. The fixed weekly/print/archive URLs
do not create a rolling discovery mechanism. All 64 Economist entries retain
`ordering: newest`, `homepageScore: 5`, and RSS/news-sitemap formats matching
their source; the Main feed alone remains operational.

Every exact added URL and section is in [economist.json](economist.json). The
Economist's Main feed is a normal RSS latest feed; unlike Bloomberg, this inventory
does not add a sitemap replacement.

### Washington Post stored article-feed inventory

The existing Arc front-page `Main feed` is retained unchanged. The 52 reference
additions come from the user-supplied `wapo_rss_feeds_2.xlsx` (`Summary` and all 503
records in `All feeds`) and `new-research-2.md`. The research is dated 21 October
2026; the file additions were made on 21 October. The Markdown refers to a
different workbook filename, but the supplied `wapo_rss_feeds_2.xlsx` is the
actual source read.

**These are research-indexed URLs, not newly verified working feeds.** The
researcher could not directly access the main WaPo site and used third-party
Feedly/Apple records. Its old-host 502 observations are historical reports, not tests run by
Folio. `live` means a new indexed item within the research's 30-day window;
low-subscriber feeds may have lagging dates. No live fetch or extraction audit
was performed, and none of these additions is enabled for API collection.

Three feeds were added on WaPo's official RSS page (updated 21 May 2026) that
were not in the previous inventory:

| Section | Added URL | Status |
| --- | --- | --- |
| George F. Will | `https://www.washingtonpost.com/arcio/rss/author/George%20F%20-Will/` | live |
| The Optimist | `https://www.washingtonpost.com/arcio/rss/category/lifestyle/inspired-life/` | slowing |
| Going Out Guide | `https://www.washingtonpost.com/arcio/rss/category/entertainment/going-out-guide/` | unconfirmed |

George F. Will's previous `feeds.washingtonpost.com` address stopped in 2023; the
new Arc address is live as of 16 October 2026.

| Stored group | Feeds | Operational feeds |
| --- | ---: | ---: |
| Arc front page (`Main feed`) | 1 | 1 |
| Arc sections/subsections | 13 | 0 |
| Arc writers | 34 | 0 |
| Older writer pages | 2 | 0 |
| Legacy George F. Will XML feed | 1 | 0 |
| **Total Washington Post** | **53** | **1** |

Section URLs use `https://www.washingtonpost.com/arcio/rss/category/` plus:

| Section | Exact suffix |
| --- | --- |
| Capital Weather Gang | `local/weather/` |
| D.C., Md. & Va. | `local/` |
| Elections | `elections/` |
| Europe | `world/europe/` |
| Going Out Guide | `entertainment/going-out-guide/` |
| Local Crime & Public Safety | `local/public-safety/` |
| Maryland | `local/maryland/` |
| Middle East | `world/middle-east/` |
| Opinions | `opinions/` |
| The Optimist | `lifestyle/inspired-life/` |
| Politics | `politics/` |
| Technology | `technology/` |
| U.S. News | `national/` |
| Virginia | `local/virginia/` |
| Washington Capitals | `sports/capitals/` |

Every exact writer/legacy URL and section label is in [wapo.json](wapo.json).
Arc writers use `Writer — …`; the two older pages use `Writer (legacy page) — …`,
and the XML entry uses `Writer (legacy XML) — George F. Will`. Preserve source
case, trailing slashes and percent escapes; notably R. Eric Thomas's supplied
suffix is `R%20%20Eric%20-Thomas/`. Do not guess a corrected endpoint. Distinct
Carolyn Hax/Will URL formats are retained as references, not assumed identical
responses or extra independent sources. Alternate-URL cells and unconfirmed
patterns (such as Arc World/Business) were not expanded into extra entries.

All entries retain publisher `Washington Post`, `ordering: newest`, `format: rss`,
`homepageScore: 6`, and `edition: US`. No new importance scores or editorial-order
claims are inferred. The stored Capitals section does **not** change the existing
WaPo sports/AP/media filters. The ten active Main feeds and their metadata are
unchanged; adding these references creates no feed fetches or proxy traffic.

#### Washington Post exclusions and source discrepancies

Of the workbook's 503 rows, 53 text-feed URLs are stored and 450 are excluded:

| Exclusion | Rows |
| --- | ---: |
| `host down` (old-host feeds reported as returning 502) | 46 |
| `slowing` (31–365 days without an indexed item) | 113 |
| `stale` (over a year without an indexed item) | 284 |
| `unknown` (Arc Editorials; no last-item date) | 1 |
| `live` audio podcasts | 6 |

All podcast categories, including ended/sponsored/co-produced shows, are excluded;
non-live podcasts are counted under their status above, not counted twice.
Slowing is not proof of permanent closure, and a host outage may recover. Both
remain excluded from this research-based inventory addition.

The 90 cached Summary formula counts match the 503 source rows, but its four
status columns total only 502 because they omit the one `unknown` row. The
workbook specifically marks the pre-2014 Will XML URL `live`, with a last item
dated 16 October, contradicting the Markdown's blanket claim that all pre-2014
feeds are dead. This specific row is retained as an explicitly labelled,
unverified legacy reference. No claims about newsroom events in the research
were used to infer feed statuses, invent URLs, or change publisher behavior.

### Bloomberg stored article-feed inventory

The existing `https://www.bloomberg.com/sitemaps/news/latest.xml` remains the sole
Bloomberg `Main feed`, with its `format: news-sitemap` and all metadata unchanged.
The 60 reference additions come from `bloomberg_rss_feeds.xlsx` (both `Summary`
and all 217 records in `All feeds`) and `bloomberg_rss.md`, dated 20 October 2026.

The workbook reports 126 live, 12 slowing, 58 stale, seven empty and 14 gone
entries; all 60 cached Summary formula values reconcile with the source rows.
The researcher reports direct checks of the selected URLs; other workbook rows
use Feedly, as indicated in their `How checked` column. These are **supplied
research results, not fresh verification by Folio**. `live` is the research's
30-day freshness window, not a guarantee of current access, extraction quality,
or an article within Folio's 72-hour window. No live network audit was performed.

| Stored group | Entries | Operational entries |
| --- | ---: | ---: |
| Latest-news sitemap (`Main feed`) | 1 | 1 |
| All-news/section RSS feeds | 10 | 0 |
| Writers/editorial board | 37 | 0 |
| October 2026 news sitemap | 1 | 0 |
| Other Bloomberg feeds (NEF/Professional) | 3 | 0 |
| Licensed partner editions | 9 | 0 |
| **Total Bloomberg** | **61** | **1** |

**RSS is not the same as a news sitemap.** The added all-news RSS URL,
`https://www.bloomberg.com/feeds/news.rss`, is labelled `All Bloomberg news (RSS)`;
it does not replace the sitemap Main feed or become its fallback. The sitemap
has no RSS description/byline fields; Folio's existing Bloomberg `news:title`
summary fallback remains unchanged. Its summaries are titles, not full-text
excerpts. Added RSS references use `format: rss`, not the sitemap format.

The ten RSS references use `https://www.bloomberg.com/feeds/` plus:

| Section | Exact suffix |
| --- | --- |
| All Bloomberg news (RSS) | `news.rss` |
| Business | `business/news.rss` |
| Businessweek | `businessweek/news.rss` |
| Economics | `economics/news.rss` |
| Industries | `industries/news.rss` |
| Markets | `markets/news.rss` |
| Opinion | `bview/news.rss` |
| Politics | `politics/news.rss` |
| Technology | `technology/news.rss` |
| Crypto | `crypto/news.rss` |

All exact author IDs, slugs, URLs and labels are in [bloomberg.json](bloomberg.json).
Writer labels use `Writer — …`; preserve the source's ID case and punctuation,
and its `/authors/` versus `/opinion/authors/` path. Alternate cells, older
`feeds.bloomberg.com` aliases and guessed section/writer patterns are not added.
The dated `/sitemaps/news/2026-10.xml` reference is a fixed October archive, not
an automatically rolling monthly feed. No index crawling or monthly URL generation
is introduced; sitemap indexes are not supported feed inputs for this purpose.

Other references include BloombergNEF, Professional Services insights, Professional
Brazil, Bloomberg HT, Línea (Spanish and Brazilian editions), Technoz, TV Bulgaria,
and BNN Bloomberg all-stories/Business/Investing/Markets. Partner records have
`Partner — …` labels and informational edition labels; all remain filed under
`site: Bloomberg`, not new operational publishers. These can contain overlapping,
licensed, promotional, local-language or media-heavy material. The text-oriented
RSS endpoints are stored, not a guarantee every item is a suitable article.

Every entry inherits `ordering: newest` and `homepageScore: 4`, without inferring
editorial order or new importance scores. Core entries retain the existing
informational `edition: Only one` label; it is not a count of stored URLs. Region/
language labels on partner/Brazil records are informational, not language filters.
The supplied Professional Brazil URL is HTTP and is preserved verbatim as an
inactive reference; it was not silently changed to an unverified HTTPS endpoint.
No publisher-domain allowlists, retrieval orders, proxy policies or summary rules
were expanded for partner domains. They are never fetched through collection.

#### Bloomberg exclusions

Of 217 workbook rows, 61 are retained and 156 are excluded:

| Exclusion | Rows |
| --- | ---: |
| All current/partner/Law/Tax podcast feeds and old podcast addresses | 128 |
| Slowing writer feeds | 4 |
| Stale writer feeds | 13 |
| Empty section/writer feeds | 5 |
| Gone section feeds (Green and CityLab) | 2 |
| Discovery/media sitemap indexes and section fronts | 4 |

Podcast exclusions include 61 live URL rows, some redirecting to the same shows;
they are excluded for being audio, not called dead merely for exclusion. The four
non-article sitemap references omitted are the news archive index, section fronts,
audio index and video index. Empty Gadfly/Wealth and empty Christopher Balding,
Eli Lake and Jonathan Bernstein writer feeds are not stored. Slowing is not proof
of permanent closure; the inventory conservatively follows the research's live
classification. Unverified YouTube feeds and unlisted regional/subsection guesses
are not added. All 60 additions remain inactive: only the original sitemap Main
feed participates in APIs, ranking, corroboration or automatic downstream saving.

### CNBC stored feed inventory

The updated `cnbc_rss_feeds_new.xlsx` (`Summary` and all **201 records** in
`All feeds`) and `cnbc_rss_new.md` were reviewed in full. The workbook is dated
**21 October 2026**; its 90 cached Summary formulas reconcile with the source
rows: **134 live**, **16 slowing**, **48 stale**, **3 empty**, zero unconfirmed.
The Markdown calls the updated workbook `cnbc_rss_feeds.xlsx`; the supplied
`cnbc_rss_feeds_new.xlsx` is the actual source used here.

Only **one URL is new** relative to the previous 103-entry inventory:

| Section | Added URL | Daily operational feeds |
| --- | --- | ---: |
| Cybersecurity | `https://www.cnbc.com/id/100807029/device/rss/rss.html` | 0 |

The research upgraded Cybersecurity from unconfirmed to live after a user-saved
20 October copy showed 30 stories, newest dated 20 October. **This is supplied
research evidence, not a new live availability or extraction audit by Folio.**
Most other CNBC dates come from Feedly's newest indexed article because the
researcher could not open CNBC feeds. The research's 30-day `live` classification
does not imply an eligible article within Folio's 72-hour window.

All **103 existing entries are retained unchanged**. The resulting **104 CNBC
entries** comprise:

| Workbook group | Stored entries |
| --- | ---: |
| Top news (including the existing Main feed) | 9 |
| Business and industries | 26 |
| Markets, investing and finance | 16 |
| Economy and politics | 4 |
| Personal finance, Make It and Select | 5 |
| Countries, people and other topic pages | 2 |
| Opinion, columns and blogs | 6 |
| TV shows | 11 |
| Video | 4 |
| Industry and market feeds (older address style) | 20 |
| Other CNBC feeds (partner news feed) | 1 |
| **Total CNBC** | **104** |

The sole Main feed remains
`https://www.cnbc.com/id/100003114/device/rss/rss.html`, with
`ordering: editorial`, `format: rss`, `homepageScore: 9`, and `edition: US`.
Cybersecurity inherits the existing non-main metadata: `ordering: newest`,
`format: rss`, `homepageScore: 9`, `edition: US`. No new editorial score or
publisher identity is inferred. The alternate-address column and Summary URL
patterns are not expanded into extra records; only explicit selected URL cells
are stored. Existing distinct IDs and older `rssCmp` URLs remain distinct.

The supplied official RSS-page copy identifies **54 listed feeds** (23 News,
3 Investing, 6 Blogs, 17 Video and TV, 3 Europe TV, 2 Asia TV); the other **147**
workbook rows are unlisted. Of the 54, the workbook marks 42 live, 11 stale and
one slowing. Official listing is therefore not proof of freshness. Cybersecurity
is unlisted; no AI or Internet feed URL is invented from Feedspot labels.

For TV/video sources, the research confirms `search.cnbc.com` addresses: the
user-saved `www.cnbc.com` Squawk Box response was valid but empty. The existing
show/video URL choices are retained, not replaced with those empty alternates.
The four video references and mixed TV feeds are inventory, not a promise of
text articles: CNBC media/AP/Select and general article filters remain unchanged.

Of 201 source rows, **97 are excluded**: all 67 non-live rows (16 slowing,
48 stale, 3 empty), 21 live podcast feeds, five live YouTube feeds, three live
old podcast addresses, and one live smart-speaker audio feed. Separately owned
CNBC-branded outlets are outside the supplied workbook and were not added.
Neither workbook nor Markdown is a runtime dependency.

There is exactly **one CNBC Main feed** and **ten Main feeds overall**. Adding
Cybersecurity does not expand GET/POST `/api/links`, GET/POST `/api/collect`,
their ranking pool or downstream automatic saving. No fallback, proxy policy,
retrieval order or extraction-domain rule changes. The separately authorized
selective workflow remains opt-in and unchanged.

## Collection cost and downstream limits

Each fresh collection attempts **ten main feed sources**, not all 1554 stored
entries. Retries and Google News resolution may require additional requests;
ten sources does not mean exactly ten outbound requests. `RSS_LINKS_PER_SECTION`
controls article output, not which feed sources are active. There is no new
scheduler, quota control or timeout increase: synchronous `/api/links` clients
need suitable timeouts, and background collection retains its ten-minute internal
links-request cap and one-hour job budget. No live publisher availability or
Render capacity audit is implied by fixture tests.

Agents should deduplicate and select before saving. `/api/save-batch` still accepts
at most 100 URLs per request; larger selections need sequential batches. Each batch
has its own call ID and may save to a different minute folder. `/api/agent/latest`
does not combine all those jobs automatically: verify/read each batch's snapshot
before proceeding, rather than assuming the final latest folder contains them all.

This catalog does not configure article-retrieval services. For those, edit
`reader/retrieval.config.ts` and `reader/methods.ts`.

The catalog is configuration, not a collected report. Link reports are saved and
returned as versioned JSON under `output/links/`; each publisher/section contains
`articles: { url, summary? }[]`. See the [report format and summary rules](../scripts/fetch-links.md).
Saved article files remain Markdown by default, with JSON optional.
