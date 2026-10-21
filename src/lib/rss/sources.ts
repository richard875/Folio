import wsj from "../../../data/wsj.json" with { type: "json" };
import nyt from "../../../data/nyt.json" with { type: "json" };
import wapo from "../../../data/wapo.json" with { type: "json" };
import bloomberg from "../../../data/bloomberg.json" with { type: "json" };
import economist from "../../../data/economist.json" with { type: "json" };
import ft from "../../../data/ft.json" with { type: "json" };
import foreignpolicy from "../../../data/foreignpolicy.json" with { type: "json" };
import cnbc from "../../../data/cnbc.json" with { type: "json" };
import reuters from "../../../data/reuters.json" with { type: "json" };
import businessinsider from "../../../data/businessinsider.json" with { type: "json" };
import { selectMainFeeds, validateFeedCatalog } from "./catalog.ts";

// Explicit imports bundle data into Nitro; no runtime filesystem discovery,
// client-supplied file names, glob expansion or source-file deployment dependency.
export const publisherCatalogs = [
  { site: "WSJ", file: "wsj.json", entries: wsj },
  { site: "NY Times", file: "nyt.json", entries: nyt },
  { site: "Washington Post", file: "wapo.json", entries: wapo },
  { site: "Bloomberg", file: "bloomberg.json", entries: bloomberg },
  { site: "The Economist", file: "economist.json", entries: economist },
  { site: "Financial Times", file: "ft.json", entries: ft },
  { site: "Foreign Policy", file: "foreignpolicy.json", entries: foreignpolicy },
  { site: "CNBC", file: "cnbc.json", entries: cnbc },
  { site: "Reuters", file: "reuters.json", entries: reuters },
  { site: "Business Insider", file: "businessinsider.json", entries: businessinsider },
] as const;

/** Discovery inventory. Only explicitly selected IDs may reach selective transport. */
export const feedInventory = publisherCatalogs.flatMap(({ site, entries }) => {
  const feeds = validateFeedCatalog(entries);
  if (!feeds.length || feeds.some((feed) => feed.site !== site))
    throw new Error("Publisher feed file contains missing or mismatched publisher data.");
  selectMainFeeds(entries);
  return feeds;
});

/** Daily links/collect catalog: ten main feeds in stable publisher order. */
export const mainFeeds = selectMainFeeds(feedInventory);
