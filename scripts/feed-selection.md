# Article-only feed selection

`data/feeds.json` is the source of truth for **which URLs are fetched**.
Each entry explicitly sets `site`, `section`, `url`, `ordering` and `format`,
with optional numeric `homepageScore` and `edition`. No Markdown table, description,
bold text, research note or reference URL is parsed. Unknown fields and invalid
entries are rejected; duplicate site/section/URL entries are collapsed.
The score is only a bounded weight for cross-publisher coverage, not a claim that
an individual article has that importance score. Edition is informational.

## Publisher rules

| Source              | Filtering and priority                                                                                                                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WSJ Flipboard       | Keep WSJ article links, strip `mod=Flipboard` before deduplication, exclude Buyside shopping pages and media. Use publication/posted time and cross-publisher support; this is **not** editor order. No extra Opinion feed is added.                                                                                         |
| NY Times            | Keep NYT articles, including image-bearing entries and valid opinion articles. Correctly handle RSS `link` plus `atom:link` in one item. Preserve top-story editor order after filtering.                                                                                                                                    |
| Washington Post     | Drop Associated Press bylines, bylines ending in `\| AP` (including thin spaces), sports URLs, standalone media and puzzle-answer posts. Rank remaining Post journalism using its available date and cross-publisher coverage. The feed cannot reveal its true homepage order.                                               |
| Bloomberg           | Parse Google News sitemap URL entries and `news:publication_date`, not its update ordering. Exclude non-article/media/quote pages. Keep text newsletters, opinion and graphics journalism. Rank using publication time and coverage.                                                                                         |
| The Economist       | Remove podcasts/media and older backlog. Keep text articles, newsletters and opinion. Rank recent candidates using date and coverage.                                                                                                                                                                                        |
| Financial Times     | Preserve homepage order. Keep leads, related articles, editor picks, opinion and Spotlight articles; filter media and non-articles.                                                                                                                                                                                          |
| Foreign Policy      | Keep recent articles and opinion; exclude media-only pages. Rank using publication time and coverage rather than pretending the first entry is the homepage lead.                                                                                                                                                            |
| CNBC                | Preserve top-news editor order. Remove standalone video/audio, AP wire bylines if present, and Select shopping pages. Keep Investing Club/paywalled **text** articles.                                                                                                                                                       |
| Reuters Google News | Remove titles containing Stock Price and bare Reuters titles. Rank eligible headlines using time and cross-publisher coverage rather than Google's raw position. Resolve only selected candidate wrappers; reject media/quote/company-directory destinations, then refill from the next candidate before applying the limit. |
| Business Insider    | Parse its Google News sitemap, using publication time instead of update/list order. Remove media/non-articles; keep genuine text reporting, features and paywalled articles. Rank using time and coverage.                                                                                                                   |

Every source also rejects standalone media by URL, MIME/enclosure, media type,
category or an explicit Video/Podcast/Watch/Listen headline prefix. It excludes
quote pages, feed files, downloads, homepages/section indexes, games/puzzles,
explicitly sponsored/advertorial entries, and credential-bearing
URLs. Known publishers cannot silently supply off-publisher links. A legitimate
text article **about** videos or video games is not rejected merely for that
word, and images do not make a text article a video. An article may still have
embedded media; the filter targets media-first pages, not all multimedia reporting.

## Freshness and importance

- Publication metadata is preferred: RSS `pubDate`, Atom `published`, or sitemap
  `news:publication_date`. Updated/lastmod is only a fallback. Missing dates are
  not invented.
- Latest/Google-ranked sources exclude entries older than 72 hours; curated
  homepage feeds allow 7 days so editors' weekend/explainer choices can remain.
  Dates more than 24 hours in the future are rejected. Undated entries can remain
  eligible; dates are not required or invented.
- Curated sources preserve original feed position; filtering simply promotes
  the next eligible editorial item.
- Other sources combine exponentially decaying freshness (36-hour scale),
  distinct-publisher headline overlap, prominence in corroborating feeds, explicit
  breaking/urgent categories, and a small original-position tie-breaker. Common
  words and duplicate coverage from the same publisher cannot inflate support.
- All feeds are parsed and filtered **before** cross-source ranking. The cap is
  applied only after filtering, canonicalization and deduplication; removed items
  do not consume `RSS_LINKS_PER_SECTION` slots.

This is a deterministic estimate, not AI-generated importance or an exact
reconstruction of unranked homepages. Different headlines about the same event
can escape lexical matching. No homepage scraping or external AI calls were
added. Published editor order is preferred whenever the supplied source has it.

Google resolution has a one-minute budget per feed and a 20-second per-candidate
timeout. Candidate URLs are resolved only until the selection is filled, not
all 100 entries by default. Failed candidates are skipped and the next candidate
is tried. The existing background save resolver remains for older reports that
still contain Google wrappers. Article outputs still contain no internal fetch
method/ranking diagnostics.
