# Homepage RSS feeds, one per site

Oct 12, 2026 · @Richard Everley

Only 4 of the 12 sites still publish a homepage (top stories) feed: NY Times, FT, Axios and CNBC. Seven others get their broadest official feed instead, and Reuters, which has no official feed, comes through Google News RSS. All are RSS 2.0, US edition unless noted.

| Site | Feed URL | Edition | What you get |
| --- | --- | --- | --- |
| WSJ | `https://feeds.content.dowjones.io/public/rss/RSSUSnews` | US | No homepage or all-stories feed. U.S. News is the broadest US feed: about 40 items mixing national news, politics, economy and editorials, grouped by editors rather than strictly newest first. |
| NY Times | `https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml` | US | **Homepage feed.** Top stories from nytimes.com. |
| Washington Post | `https://www.washingtonpost.com/arcio/rss/` | US | The homepage feed stopped in July 2026; this replaced it. Every story newest first, wire-service copy included. |
| Bloomberg | `https://www.bloomberg.com/feeds/news.rss` | Only one | No homepage feed. The 20 newest stories across all sections, about 7 hours on a weekday. |
| The Economist | `https://www.economist.com/latest/rss.xml` | Only one | No homepage feed. Every new article, newest first, up to 300. |
| The Hill | `https://thehill.com/news/feed/` | US | No homepage feed. The homepage's "Just In" list: newest news stories plus some opinion. |
| Axios | `https://api.axios.com/feed/top/` | US | **Top stories feed.** The 100 newest stories Axios marks as top, about a week, with about 480 words of text each. |
| Financial Times | `https://www.ft.com/?format=rss` | International | **Homepage feed.** The international edition's homepage stories; `https://www.ft.com/rss/home/international` is the same feed. |
| Foreign Policy | `https://foreignpolicy.com/feed/` | Only one | No homepage feed. Every new article, newest first. |
| CNBC | `https://www.cnbc.com/id/100003114/device/rss/rss.html` | US | **Homepage feed (Top News).** CNBC's top U.S. stories, 30 items. |
| Reuters | `https://news.google.com/rss/search?q=when:24h+site:reuters.com&ceid=US:en&hl=en-US&gl=US` | US | No official RSS since June 2020. Google News: the last 24 hours of Reuters stories, ranked by Google, up to 100. |
| Business Insider | `https://www.businessinsider.com/rss` | US | No homepage feed found. Main site feed; the site blocks automated checks, so I couldn't confirm whether it is ranked or newest first. |

- **Polling:** Bloomberg keeps only 20 items, so fetch it at least hourly. The others hold a day or more.
- **WSJ clean-up:** the feed repeats some items and includes a few `/buyside/` shopping articles; dedupe by `guid` and drop `/buyside/` links.
- **Reuters via Google News:** Google picks and orders the stories rather than listing them strictly by time. Items have a headline and a Google redirect link, no summary.
- **Checked:** I fetched WSJ U.S. News and The Hill live on 11 October 2026; both had stories from that day or the day before. The rest were posting on Feeder's checks between 27 September and 11 October 2026.

## Sources

- [WSJ](https://feeder.co/knowledge-base/rss-content/wall-street-journal-rss-feeds/), [NY Times](https://feeder.co/knowledge-base/rss-content/new-york-times-rss-feeds/), [Washington Post](https://feeder.co/knowledge-base/rss-content/washington-post-rss-feeds/), [Bloomberg](https://feeder.co/knowledge-base/rss-content/bloomberg-rss-feeds/), [The Economist](https://feeder.co/knowledge-base/rss-content/the-economist-rss-feeds/), [Axios](https://feeder.co/knowledge-base/rss-content/axios-rss-feeds/), [CNBC](https://feeder.co/knowledge-base/rss-content/cnbc-rss-feeds/), [Reuters](https://feeder.co/knowledge-base/rss-content/reuters-rss-feeds/) – Feeder feed guides
- [ft.com](https://feeder.co/discover/site/ft.com), [businessinsider.com](https://feeder.co/discover/site/businessinsider.com), [thehill.com](https://feeder.co/discover/site/thehill.com) – Feeder feed trackers
- [Foreign Policy feeds](https://rss.feedspot.com/foreignpolicy_rss_feeds/) – Feedspot
