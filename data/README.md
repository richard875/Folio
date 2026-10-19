# Feed catalog

Edit **`feeds.json`** to configure feed collection. It is bundled into the server;
rebuild/redeploy production after changes. Research documents are not data sources.

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
validation. Duplicate site/section/URL entries keep their first position.
`format` describes the source; the XML parser still detects its actual structure.
`editorial` preserves curated order, `newest`/`google-ranked` use freshness and
coverage ranking, and `feed` uses the existing publisher-profile fallback.

## Current coverage

The catalog has **599 feeds across ten publishers**: **35 WSJ feeds**, **556 NY
Times feeds**, and one `Main feed` for each of the other eight publishers.
`RSS_LINKS_PER_SECTION` caps each publisher/section, not each publisher. With a
limit of 1, up to 599 entries can be returned, of which up to 35 are WSJ and 556
are NY Times. Empty, stale, failed or filtered feeds
can yield fewer. Identical articles can recur in different sections: deduplication
and the cap are section-scoped, so agents should deduplicate URLs before saving.

### WSJ article feeds

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
included. The existing article/media/sponsored-content filters still apply to all
feeds; Japanese text extraction and publisher access are not newly guaranteed.
Adding feeds increases collection requests and potential proxy traffic; it does
not increase publisher diversity, and repeated WSJ coverage does not count as
independent cross-publisher corroboration.

### NY Times article feeds

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

Every exact URL and section label is in [`feeds.json`](feeds.json). Section feeds
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
as What to Watch and Graphics remain subject to the existing per-item media filter.
`slowing` is not proof a feed is permanently stopped; it is conservatively left
out of this active catalog. NYT Open is in that group. No row status proves that
Folio can successfully fetch or extract that source.

#### Collection cost and downstream limits

Every collection now attempts 599 feeds; `RSS_LINKS_PER_SECTION=1` reduces output,
**not feed-request count**. Repeated coverage does not increase publisher diversity.
More feeds increase proxy traffic, memory and collection/ranking time. There is no
new scheduler, quota control or timeout increase: synchronous `/api/links` clients
need long timeouts, and background collection retains its ten-minute internal
links-request cap and one-hour job budget. This catalog has not been load-tested
against live feeds on Render Free; collection completion is not guaranteed.

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
