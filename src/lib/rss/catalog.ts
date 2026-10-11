/** The attachment's feed columns are the only source of feed URLs. */
export type Feed = { site: string; section: string; url: string };

export function parseFeedCatalog(markdown: string): Feed[] {
  const feeds: Feed[] = [];
  const seen = new Set<string>();
  let site = "";
  let ignored = false;
  let table: "sites" | "sections" | null = null;

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
    const label = cells[0];
    const column = cells[1] || "";
    if (["feed url", "url", "feed"].includes(column.toLowerCase())) {
      if (label.toLowerCase() === "site") table = "sites";
      else if (["section", "nav section", "feed"].includes(label.toLowerCase()) && site)
        table = "sections";
      else table = null;
      continue;
    }
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
        feeds.push({ site: website, section, url: url.href });
      } catch {
        /* Skip malformed feed URLs. */
      }
    }
  }
  return feeds;
}
