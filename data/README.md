# Feed catalog

The inventory is split into **ten publisher JSON files**, bundled into the server
through [`sources.ts`](../src/lib/rss/sources.ts). Rebuild/redeploy production
after changes. The former combined `feeds.json` is removed. Research documents
are not runtime data sources.

## Main-feed-only operation

**Only the single `section: "Main feed"` entry in each file is operational.**
`GET`/`POST /api/links`, `GET`/`POST /api/collect`, and their downstream automatic
article-saving workflows use exactly these ten sources. The other 638 entries
are inactive reference inventory: never fetched, ranked, used for corroboration,
or used as fallback feeds. Query parameters and POST bodies cannot enable them.
An unavailable main feed is reported as failed; no subsection is promoted.

| Publisher | File | Stored entries | Active entries |
| --- | --- | ---: | ---: |
| WSJ | [wsj.json](wsj.json) | 35 | 1 |
| NY Times | [nyt.json](nyt.json) | 556 | 1 |
| Washington Post | [wapo.json](wapo.json) | 50 | 1 |
| Bloomberg | [bloomberg.json](bloomberg.json) | 1 | 1 |
| The Economist | [economist.json](economist.json) | 1 | 1 |
| Financial Times | [ft.json](ft.json) | 1 | 1 |
| Foreign Policy | [foreignpolicy.json](foreignpolicy.json) | 1 | 1 |
| CNBC | [cnbc.json](cnbc.json) | 1 | 1 |
| Reuters | [reuters.json](reuters.json) | 1 | 1 |
| Business Insider | [businessinsider.json](businessinsider.json) | 1 | 1 |
| **Total** | | **648** | **10** |

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

The stored inventory has **648 feeds across ten publishers**: **35 WSJ feeds**,
**556 NY Times feeds**, **50 Washington Post feeds**, and one `Main feed` for each
of the other seven publishers.
`RSS_LINKS_PER_SECTION` caps each active publisher's `Main feed`. With a limit
of 1, up to ten article entries can be returned (one per publisher); with the
default of 5, up to 50. Empty, stale, failed or filtered main feeds can yield
fewer. The research inventories below are preserved for reference, not enabled.

### WSJ stored article-feed inventory

The existing Flipboard `Main feed` is retained. The 34 additions below come from
the user-supplied *WSJ RSS Feeds: Complete Verified List* dated 19 October 2026:
15 standard English sections, eight unlisted English feeds, seven Japanese
feeds, and four legacy feeds reported as updating. This records the research's
status, not a new live availability audit or extraction guarantee.

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

The existing HomePage `Main feed` is retained unchanged. The 555 additions were
selected offline from the user-supplied `nyt_rss_feeds.xlsx` (both `Summary` and
all 858 records in `All feeds`) and accompanying `nyt_rss.md`, dated 19 October
2026. The workbook's cached total is 858 (637 live, 46 slowing, 175 stale);
intermediate Markdown progress counts are not the final inventory.

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
| Columns and recurring text features | 40 |
| Writers | 50 |
| Newsletters/series | 2 |
| Spotlights | 7 |
| News events | 2 |
| Topics: subjects | 103 |
| Topics: places | 87 |
| Topics: companies | 15 |
| Topics: organizations | 15 |
| Topics: people | 2 |
| Athletic: leagues/sports (excluding Podcasts) | 34 |
| Athletic: teams (NFL/NBA/MLB/NHL/soccer/college football) | 79 |
| Athletic: cities | 13 |
| Athletic: writers | 9 |
| Athletic: newsletters/tags | 2 |
| Other products: Chinese simplified/traditional, Cooking, Wirecutter | 4 |
| **Total NY Times** | **556** |

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
names: `Style.xml` is Fashion; `FashionandStyle.xml` is Style.

All remain under publisher `NY Times`, including Athletic and sister products;
they are not independent corroborating publishers. They inherit the publisher's
`homepageScore: 8` and `format: rss`. **Only HomePage retains `ordering: editorial`**;
all additions use `newest` (date/coverage ranking), not a claim of editorial or
popularity order. Spanish and the two Chinese feeds have explicit language edition
labels; other NY Times entries retain `US`. Edition is informational, not a language
filter or a publication location inferred from a topic name. Extraction of recipes,
Chinese/Spanish articles, and Athletic/Wirecutter pages is not newly guaranteed.

#### NY Times exclusions

Of the 858 workbook rows, 302 were not added as separate feeds:

| Reason | Rows |
| --- | ---: |
| `slowing` (outside the research's 30-day live window) | 46 |
| `stale` (more than a year without an indexed update) | 175 |
| Audio podcast feeds, including legacy podcast feeds | 38 |
| Podcast/video/quiz/game-focused collection feeds | 16 |
| Redundant legacy redirects or placeholder URL patterns | 18 |
| Duplicate section aliases | 7 |
| Corporate news/investor releases (`nytco.com`) | 2 |

The seven omitted section aliases are `Books.xml` (prefer `Books/Review.xml`),
`InternationalBusiness.xml` (Business), `Environment.xml` (Climate), `Circuits.xml`
(PersonalTech), `InternationalHome.xml`/`GlobalHome.xml` (HomePage), and
`Washington.xml` (Politics). These are deduplication choices based on the supplied
research, not new claims that their current responses are identical.

The 16 focused collections omitted are Hard Fork, Interesting Times, Matter of
Opinion, Op-Docs, Popcast, The Book Review Podcast, The Daily, The Ezra Klein Show,
The Headlines, The Interview, The Opinions, Student News Quiz, Wordplay (Gameplay),
Shows (podcasts), News Quiz, and Athletic Podcasts. Some may include transcripts,
but they are not treated as general text-news feeds. Mixed text collections such
as What to Watch and Graphics remain stored references, not operational feeds.
`slowing` is not proof a feed is permanently stopped; it is conservatively left
out of the stored inventory. NYT Open is in that group. No row status proves that
Folio can successfully fetch or extract that source.

### Washington Post stored article-feed inventory

The existing Arc front-page `Main feed` is retained unchanged. The 49 reference
additions come from the user-supplied `wapo_rss_feeds.xlsx` (`Summary` and all 499
records in `All feeds`) and `wapo_rss.md`. The research is dated 19 October 2026;
the file additions were made on 20 October. The Markdown refers to a different
workbook filename, but the supplied `wapo_rss_feeds.xlsx` is the actual source read.

**These are research-indexed URLs, not newly verified working feeds.** The
researcher could not directly access the main WaPo site and used third-party
Feedly/Apple records. Its old-host 502 observations are historical reports, not tests run by
Folio. `live` means a new indexed item within the research's 30-day window;
low-subscriber feeds may have lagging dates. No live fetch or extraction audit
was performed, and none of these additions is enabled for API collection.

| Stored group | Feeds | Operational feeds |
| --- | ---: | ---: |
| Arc front page (`Main feed`) | 1 | 1 |
| Arc sections/subsections | 13 | 0 |
| Arc writers | 33 | 0 |
| Older writer pages | 2 | 0 |
| Legacy George F. Will XML feed | 1 | 0 |
| **Total Washington Post** | **50** | **1** |

Section URLs use `https://www.washingtonpost.com/arcio/rss/category/` plus:

| Section | Exact suffix |
| --- | --- |
| Capital Weather Gang | `local/weather/` |
| D.C., Md. & Va. | `local/` |
| Elections | `elections/` |
| Europe | `world/europe/` |
| Local Crime & Public Safety | `local/public-safety/` |
| Maryland | `local/maryland/` |
| Middle East | `world/middle-east/` |
| Opinions | `opinions/` |
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

Of the workbook's 499 rows, 50 text-feed URLs are stored and 449 are excluded:

| Exclusion | Rows |
| --- | ---: |
| `host down` (old-host feeds reported as returning 502) | 46 |
| `slowing` (31–365 days without an indexed item) | 112 |
| `stale` (over a year without an indexed item) | 284 |
| `unknown` (Arc Editorials; no last-item date) | 1 |
| `live` audio podcasts | 6 |

All podcast categories, including ended/sponsored/co-produced shows, are excluded;
non-live podcasts are counted under their status above, not counted twice.
Slowing is not proof of permanent closure, and a host outage may recover. Both
remain excluded from this research-based inventory addition.

The 70 cached Summary formula counts match the 499 source rows, but its four
status columns total only 498 because they omit the one `unknown` row. The
workbook specifically marks the pre-2014 Will XML URL `live`, with a last item
dated 16 October, contradicting the Markdown's blanket claim that all pre-2014
feeds are dead. This specific row is retained as an explicitly labelled,
unverified legacy reference. No claims about newsroom events in the research
were used to infer feed statuses, invent URLs, or change publisher behavior.

## Collection cost and downstream limits

Each fresh collection attempts **ten main feed sources**, not all 648 stored
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
