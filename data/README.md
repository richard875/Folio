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

The catalog has **44 feeds across ten publishers**: **35 WSJ feeds** and one
`Main feed` for each of the other nine publishers. `RSS_LINKS_PER_SECTION` caps
each publisher/section, not each publisher. With a limit of 1, up to 44 entries
can be returned, of which up to 35 are WSJ. Empty, stale, failed or filtered feeds
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

This catalog does not configure article-retrieval services. For those, edit
`reader/retrieval.config.ts` and `reader/methods.ts`.

The catalog is configuration, not a collected report. Link reports are saved and
returned as versioned JSON under `output/links/`; each publisher/section contains
`articles: { url, summary? }[]`. See the [report format and summary rules](../scripts/fetch-links.md).
Saved article files remain Markdown by default, with JSON optional.
