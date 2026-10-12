/** The attachment's feed columns are the only source of feed URLs. */
export type Feed = {
  site: string;
  section: string;
  url: string;
  description?: string;
  edition?: string;
  evidence?: string;
  homepageScore?: number;
  ordering?: "editorial" | "newest" | "google-ranked" | "feed";
  format?: "rss" | "news-sitemap";
};

export function parseFeedCatalog(markdown: string): Feed[] {
  const feeds: Feed[] = [];
  const seen = new Set<string>();
  let site = "";
  let ignored = false;
  let table: "sites" | "sections" | null = null;
  let columns: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      ignored = ["At a glance", "Sources"].includes(heading[1]);
      site = ignored ? "" : heading[1];
      table = null;
      continue;
    }
    if (!line.trim().startsWith("|")) {
      table = null;
      continue;
    }
    if (ignored) continue;
    const cells = line
      .trim()
      .replace(/\\\|/g, "\u0000")
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replaceAll("\u0000", "|"));
    const headers = cells.map((cell) => cell.toLowerCase());
    if (headers.some((header) => ["feed url", "url"].includes(header)) || headers[1] === "feed") {
      columns = headers;
      if (headers.includes("site")) table = "sites";
      else if (["section", "nav section", "feed"].includes(headers[0]) && site) table = "sections";
      else table = null;
      continue;
    }
    const label = cells[table === "sites" ? columns.indexOf("site") : 0];
    const explicitUrlIndex = columns.findIndex((header) => ["feed url", "url"].includes(header));
    const urlIndex = explicitUrlIndex >= 0 ? explicitUrlIndex : columns.indexOf("feed");
    const column = cells[urlIndex] || "";
    if (!table || !label || /^:?-+:?$/.test(label)) continue;
    const website = table === "sites" ? label : site;
    const section = table === "sites" ? "Main feed" : label;
    for (const match of column.matchAll(/`(https?:\/\/[^`]+)`/g)) {
      const raw = match[1];
      // Templates are not actual URLs. Do not expand them or inspect notes.
      if (/[<>]|\.\.\./.test(raw)) continue;
      try {
        const url = new URL(raw);
        if (url.username || url.password) continue;
        const key = JSON.stringify([website, section, url.href]);
        if (seen.has(key)) continue;
        seen.add(key);
        const field = (name: string) => cells[columns.indexOf(name)] || "";
        const description = field("what it actually is");
        const primaryDescription =
          /\*\*(.+?)\*\*/.exec(description)?.[1] ?? description.split(/[.!?]/)[0];
        const homepageScore = Number.parseFloat(field("score (0–10)"));
        const ordering =
          /editor order|page order|homepage, in order|exact homepage|lead and story river, in order/i.test(
            primaryDescription,
          )
            ? "editorial"
            : url.hostname === "news.google.com"
              ? "google-ranked"
              : /newest first|sorted by last update/i.test(description)
                ? "newest"
                : "feed";
        feeds.push({
          site: website,
          section,
          url: url.href,
          ...(description
            ? {
                description,
                ordering,
                format: /sitemap/i.test(description) ? "news-sitemap" : "rss",
              }
            : {}),
          ...(field("edition") ? { edition: field("edition") } : {}),
          ...(field("how i know") ? { evidence: field("how i know") } : {}),
          ...(Number.isFinite(homepageScore) ? { homepageScore } : {}),
        });
      } catch {
        /* Skip malformed feed URLs. */
      }
    }
  }
  return feeds;
}
