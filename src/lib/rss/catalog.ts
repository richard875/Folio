/** Read the feed tables, not the summary table or source/reference links. */
export type Feed = { site: string; section: string; url: string };

export function parseFeedCatalog(markdown: string): Feed[] {
  const feeds: Feed[] = [];
  const seen = new Set();
  let site = "";
  const add = (section: string, url: string) => {
    if (!/^https?:\/\//.test(url) || /[<>]|\.\.\./.test(url)) return;
    const normalized = new URL(url).href;
    const key = `${site}\n${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    feeds.push({ site, section, url: normalized });
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      site = ["At a glance", "Sources"].includes(heading[1]) ? "" : heading[1];
      continue;
    }
    if (!site || !line.startsWith("|")) continue;
    const cells = line
      .replace(/\\\|/g, "\u0000")
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replaceAll("\u0000", "|"));
    const section = cells[0];
    const codes = [...(cells[1] || "").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    for (const code of codes) {
      const choices = /<([^>]+)>/.exec(code);
      if (choices && choices[1].includes("|")) {
        for (const choice of choices[1].split("|")) {
          add(
            `${section.split(" › ")[0]} › ${choice[0].toUpperCase()}${choice.slice(1)}`,
            code.replace(choices[0], choice),
          );
        }
      } else {
        add(section, code);
      }
    }
    if (site === "NY Times") {
      for (const match of (cells[2] || "").matchAll(/`([^`]+\.xml)`/g)) {
        const name = match[1];
        add(
          `${section} › ${name.replace(/\.xml$/, "")}`,
          `https://rss.nytimes.com/services/xml/rss/nyt/${name}`,
        );
      }
    }
  }

  // Concrete shorthand URLs in the research; generic templates and dead feeds
  // are intentionally excluded. Each subsection gets its own output heading.
  const extras: Record<string, string[][]> = {
    "NY Times": [
      ...["nfl", "nba", "football"].map((league) => [
        `Sports › ${league.toUpperCase()}`,
        `https://www.nytimes.com/athletic/rss/${league}/`,
      ]),
    ],
    "Washington Post": [
      ["Politics › White House", "politics/whitehouse"],
      ["World › Europe", "world/europe"],
      ["World › Middle East", "world/middle-east"],
      ["Style / Entertainment › TV", "entertainment/tv"],
      ["Lifestyle › Travel", "lifestyle/travel"],
      ["Lifestyle › Food", "lifestyle/food"],
    ].map(([section, path]) => [section, `https://feeds.washingtonpost.com/rss/${path}`]),
    Axios: ["denver", "chicago", "washington-dc"].map((city) => [
      `Local › ${city}`,
      `https://api.axios.com/feed/audience/${city}`,
    ]),
    "Financial Times": [
      ["Tech › Artificial intelligence", "artificial-intelligence"],
      ["World › Europe", "europe"],
      ["World › Asia Pacific", "asia-pacific"],
      ["World › China", "china"],
      ["World › Americas", "world/americas"],
      ["World › Middle East", "world/mideast"],
      ["World › Africa", "world/africa"],
      ["World › UK", "world-uk"],
    ].map(([section, path]) => [section, `https://www.ft.com/${path}?format=rss`]),
    CNBC: [
      ["Asia", "19832390"],
      ["Europe", "19794221"],
      ["Cybersecurity", "100807029"],
      ["Autos", "10000101"],
      ["Make It", "103395579"],
    ].map(([section, id]) => [
      section,
      `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=${id}`,
    ]),
    Reuters: [
      "world/europe",
      "world/china",
      "world/asia-pacific",
      "business/energy",
      "business/finance",
    ].map((path) => [
      path
        .split("/")
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" › "),
      `https://news.google.com/rss/search?q=when:7d+site:reuters.com/${path}&ceid=US:en&hl=en-US&gl=US`,
    ]),
    "Business Insider": [
      [
        "AI",
        "https://news.google.com/rss/search?q=when:7d+site:businessinsider.com+intitle:AI&hl=en-US&gl=US&ceid=US:en",
      ],
    ],
  };
  const sites = [...new Set(feeds.map((feed) => feed.site))];
  for (site of sites) {
    for (const [section, url] of extras[site] || []) add(section, url);
  }
  // Keep all sections of a website together and retain the research order.
  return sites.flatMap((name) => feeds.filter((feed) => feed.site === name));
}
