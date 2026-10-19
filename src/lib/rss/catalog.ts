/** Feed inventory validation and main-feed-only operational selection. */
export type Feed = {
  site: string;
  section: string;
  url: string;
  edition?: string;
  homepageScore?: number;
  ordering?: "editorial" | "newest" | "google-ranked" | "feed";
  format?: "rss" | "news-sitemap";
};

export type CatalogFeed = Feed & {
  ordering: NonNullable<Feed["ordering"]>;
  format: NonNullable<Feed["format"]>;
};

const FIELDS = new Set(["site", "section", "url", "ordering", "format", "homepageScore", "edition"]);

/** Validate explicit JSON data; never infer settings from descriptions/prose. */
export function validateFeedCatalog(catalog: unknown): CatalogFeed[] {
  if (!Array.isArray(catalog)) throw new Error("Feed catalog must be a JSON array.");
  const feeds: CatalogFeed[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of catalog.entries()) {
    const invalid = () => new Error(`Invalid feed catalog entry ${index + 1}.`);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalid();
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).some((key) => !FIELDS.has(key))) throw invalid();
    const field = (name: string): string => {
      if (typeof row[name] !== "string" || !row[name].trim()) throw invalid();
      return row[name].trim();
    };
    const site = field("site");
    const section = field("section");
    let url: URL;
    try { url = new URL(field("url")); } catch { throw invalid(); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw invalid();
    const ordering = row.ordering;
    const format = row.format;
    if (ordering !== "editorial" && ordering !== "newest" && ordering !== "google-ranked" && ordering !== "feed") throw invalid();
    if (format !== "rss" && format !== "news-sitemap") throw invalid();
    const homepageScore = row.homepageScore;
    if (homepageScore !== undefined && (typeof homepageScore !== "number" || !Number.isFinite(homepageScore) || homepageScore < 0 || homepageScore > 10)) throw invalid();
    const edition = row.edition === undefined ? undefined : field("edition");
    const key = JSON.stringify([site, section, url.href]);
    if (seen.has(key)) continue;
    seen.add(key);
    feeds.push({
      site, section, url: url.href, ordering, format,
      ...(homepageScore !== undefined && { homepageScore }),
      ...(edition !== undefined && { edition }),
    });
  }
  return feeds;
}

/** Select before network/ranking work; never promote a reference feed on failure. */
export function selectMainFeeds(catalog: unknown): CatalogFeed[] {
  const feeds = validateFeedCatalog(catalog);
  if (!feeds.length) throw new Error("No feed URLs found in the catalog.");
  const sites = [...new Set(feeds.map(({ site }) => site))];
  // Count raw validated rows: even identical duplicate mains are an error.
  const mainRows = (catalog as Record<string, unknown>[]).filter((row) =>
    (row.section as string).trim() === "Main feed");
  for (const site of sites) {
    if (mainRows.filter((row) => (row.site as string).trim() === site).length !== 1)
      throw new Error("Each publisher must have exactly one Main feed.");
  }
  return feeds.filter(({ section }) => section === "Main feed");
}
