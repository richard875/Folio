import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Feed } from "./catalog.ts";
import { feedSummary } from "./summary.ts";

export type Candidate = {
  url: string;
  title: string;
  summary?: string;
  creator: string;
  categories: string[];
  publishedAt: number | null;
  index: number;
  source: string;
  ordering: "editorial" | "newest" | "google-ranked" | "feed";
  sourceWeight: number;
};

type Node = Record<string, unknown>;
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});
const node = (value: unknown): Node =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Node) : {};
const list = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  return text(node(value)["#text"]);
}

const PROFILES: Record<string, { domains: string[]; editorial?: boolean }> = {
  wsj: { domains: ["wsj.com"] },
  nytimes: { domains: ["nytimes.com"], editorial: true },
  washingtonpost: { domains: ["washingtonpost.com"] },
  bloomberg: { domains: ["bloomberg.com"] },
  theeconomist: { domains: ["economist.com"] },
  financialtimes: { domains: ["ft.com"], editorial: true },
  foreignpolicy: { domains: ["foreignpolicy.com"] },
  cnbc: { domains: ["cnbc.com"], editorial: true },
  reuters: { domains: ["reuters.com"] },
  businessinsider: { domains: ["businessinsider.com", "insider.com"] },
};
const identity = (site: string) => site.toLowerCase().replace(/[^a-z]/g, "");

export function orderingFor(feed: Feed): Candidate["ordering"] {
  if (feed.ordering && feed.ordering !== "feed") return feed.ordering;
  if (PROFILES[identity(feed.site)]?.editorial) return "editorial";
  if (new URL(feed.url).hostname === "news.google.com") return "google-ranked";
  return PROFILES[identity(feed.site)] ? "newest" : "feed";
}

export function articleUrl(raw: string, feed: Feed): string | null {
  try {
    const url = new URL(raw, feed.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    let path = url.pathname.toLowerCase();
    try {
      path = decodeURIComponent(path);
    } catch {
      /* Keep encoded path if malformed. */
    }
    if (
      path === "/" ||
      /^\/(?:(?:section|topic|topics|category)\/)?(?:world|business|markets|politics|us|news|opinion|technology|sports|latest|health|science|lifestyle)\/?$/i.test(
        path,
      ) ||
      /\/(?:videos?|podcasts?|audio|listen|watch|quote|quotes|symbol)(?:\/|$)/i.test(path) ||
      /^\/(?:crosswords?|puzzles?|games)(?:\/|$)/i.test(path) ||
      /\.(?:mp[34]|m4[av]|webm|m3u8|wav|ogg|pdf|jpg|jpeg|png|gif|svg|xml|rss|zip)$/i.test(path) ||
      (/\/(?:feed|rss|sitemap)(?:\/|$)/.test(path) && url.hostname !== "news.google.com")
    )
      return null;
    const site = identity(feed.site);
    if (site === "wsj" && /\/buyside(?:\/|$)/.test(path)) return null;
    if (site === "washingtonpost" && /\/sports(?:\/|$)/.test(path)) return null;
    if (site === "cnbc" && /\/select(?:\/|$)/.test(path)) return null;
    if (site === "reuters" && /\/markets\/companies(?:\/|$)/.test(path)) return null;
    const domains = PROFILES[site]?.domains;
    if (
      domains &&
      url.hostname !== "news.google.com" &&
      !domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
    )
      return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        /^utm_/i.test(key) ||
        /^(?:fbclid|gclid)$/i.test(key) ||
        (site === "wsj" &&
          key.toLowerCase() === "mod" &&
          url.searchParams.get(key)?.toLowerCase() === "flipboard")
      )
        url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function media(item: Node): boolean {
  return (
    list(item.enclosure)
      .concat(list(item.content), list(node(item.group).content))
      .some((value) => {
        const entry = node(value);
        return (
          /^(?:video|audio)(?:\/|$)/i.test(text(entry["@_type"])) ||
          /^(?:video|audio)$/i.test(text(entry["@_medium"]))
        );
      }) || Boolean(item.video)
  );
}

function cleanTitle(value: unknown): string {
  return text(value)
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (match, hex, decimal) => {
      const point = Number.parseInt(hex || decimal, hex ? 16 : 10);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCandidates(xml: string, feed: Feed, now = Date.now()): Candidate[] {
  if (
    Buffer.byteLength(xml) > 8_000_000 ||
    XMLValidator.validate(xml) !== true ||
    /<!DOCTYPE/i.test(xml)
  )
    throw new Error("Invalid or oversized feed XML");
  const document = parser.parse(xml) as Node;
  let items: unknown[];
  let sitemap = false;
  let atom = false;
  if (document.rss) items = list(node(node(document.rss).channel).item);
  else if (document.feed) {
    items = list(node(document.feed).entry);
    atom = true;
  } else if (document.urlset) {
    items = list(node(document.urlset).url);
    sitemap = true;
  } else if (document.RDF) items = list(node(document.RDF).item);
  else throw new Error("Not an RSS, Atom or news sitemap document");
  if (items.length > 2000) throw new Error("Feed exceeds the 2000-entry safety limit");
  const ordering = orderingFor(feed);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const [index, value] of items.entries()) {
    const item = node(value);
    const news = node(item.news);
    const title = cleanTitle(sitemap ? news.title : item.title);
    let raw = sitemap ? text(item.loc) : list(item.link).map(text).find(Boolean) || "";
    if (atom)
      raw = text(
        node(
          list(item.link).find(
            (link) => !node(link)["@_rel"] || node(link)["@_rel"] === "alternate",
          ),
        )["@_href"],
      );
    if (!raw) continue; // A GUID is not an article URL.
    const url = articleUrl(raw, feed);
    if (
      !url ||
      media(item) ||
      /^(?:\[?(?:video|audio|podcast)\]?\s*[:|–—-]|watch\s*:|listen\s*:)/i.test(title)
    )
      continue;
    if (
      /^(?:solution to .*crossword|crossword (?:answers|solution)|daily (?:horoscope|crossword)|(?:wordle|connections|sudoku) (?:hints|answers))/i.test(
        title,
      )
    )
      continue;
    const categories = list(item.category).map(
      (category) => text(category) || text(node(category)["@_term"]),
    );
    if (
      categories.some((category) =>
        /^(?:videos?|podcasts?|audio|sponsored|sponsored content|advertisement|advertorial|promoted)$/i.test(
          category.trim(),
        ),
      )
    )
      continue;
    const creators = list(item.creator)
      .concat(list(item.author))
      .map((value) => text(value) || text(node(value).name))
      .filter(Boolean);
    const creator = creators.join(", ");
    const site = identity(feed.site);
    if (
      (site === "washingtonpost" || site === "cnbc") &&
      creators.some((name) => /associated\s+press/i.test(name) || /\|\s*AP\s*$/iu.test(name))
    )
      continue;
    if (
      site === "reuters" &&
      (/stock price/i.test(title) || /^Reuters(?:\s*[-|–—]\s*Reuters)?$/i.test(title))
    )
      continue;
    const date =
      text(sitemap ? news.publication_date : item.pubDate || item.published || item.date) ||
      text(item.updated || item.lastmod);
    const timestamp = Date.parse(date);
    const publishedAt = Number.isFinite(timestamp) ? timestamp : null;
    // Curated feeds may intentionally feature older weekend/explainer pieces.
    const horizonHours = ordering === "editorial" ? 168 : 72;
    if (
      publishedAt !== null &&
      (now - publishedAt > horizonHours * 3600000 || publishedAt - now > 24 * 3600000)
    )
      continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const reutersDescription = !sitemap && !atom && site === "reuters" &&
      new URL(feed.url).hostname === "news.google.com";
    candidates.push({
      url,
      title,
      ...(!sitemap && {
        summary: feedSummary(
          reutersDescription ? [item.description] :
            atom ? [item.summary, item.content] : [item.description, item.summary, item.encoded],
          title,
          feed.site,
          { filterStubs: !reutersDescription },
        ),
      }),
      // Bloomberg's news sitemap supplies headlines, not descriptions. Preserve
      // its news:title as the requested summary, including short headlines.
      ...(sitemap && site === "bloomberg" && title && {
        summary: title.length > 1000 ? `${title.slice(0, 999)}…` : title,
      }),
      creator,
      categories,
      publishedAt,
      index,
      source: feed.site,
      ordering,
      sourceWeight: Math.max(0, Math.min(1, (feed.homepageScore ?? 7) / 10)),
    });
  }
  return candidates;
}

const STOP = new Set(
  "this that with from have will their after before about over into says said news latest update updates report reports analysis opinion world business more what why how amid could would should live today yesterday exclusive breaking story stories reuters times post bloomberg economist cnbc financial insider america american people first year years week weeks markets market stock stocks price prices".split(
    " ",
  ),
);
function tokens(title: string): Set<string> {
  return new Set(
    (
      title
        .normalize("NFKD")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) || []
    )
      .filter((word) => word.length > 3 && !STOP.has(word) && !/^\d+$/.test(word))
      .map((word) =>
        word.length > 5 && word.endsWith("ies")
          ? `${word.slice(0, -3)}y`
          : word.length >= 5 && word.endsWith("s") && !word.endsWith("ss")
            ? word.slice(0, -1)
            : word,
      ),
  );
}

/** Editorial order is authoritative. Unranked sources use bounded, explainable signals. */
export function rankCandidates(
  candidates: Candidate[],
  pool: Candidate[] = candidates,
  now = Date.now(),
): Candidate[] {
  const tokenized = pool.map((candidate) => ({ candidate, words: tokens(candidate.title) }));
  const index = new Map<string, number[]>();
  for (const [position, { words }] of tokenized.entries()) {
    for (const word of words) {
      const positions = index.get(word) || [];
      positions.push(position);
      index.set(word, positions);
    }
  }
  const score = (candidate: Candidate) => {
    if (candidate.ordering === "editorial" || candidate.ordering === "feed") return 0;
    if (candidate.publishedAt === null) return 5 / (1 + candidate.index);
    const ageHours = Math.max(0, (now - candidate.publishedAt) / 3600000);
    const words = tokens(candidate.title);
    const corroboration = new Map<string, number>();
    const overlaps = new Map<number, number>();
    if (words.size >= 2) {
      for (const word of words) {
        for (const position of index.get(word) || []) overlaps.set(position, (overlaps.get(position) || 0) + 1);
      }
      // Preserve source iteration order so scoring remains deterministic.
      for (const position of [...overlaps.keys()].sort((a, b) => a - b)) {
        const { candidate: other, words: otherWords } = tokenized[position];
        if (other.source === candidate.source || otherWords.size < 2) continue;
        const overlap = overlaps.get(position)!;
        const similarity = overlap / (words.size + otherWords.size - overlap);
        if (overlap < 2 || similarity < 0.22) continue;
        const prominence =
          other.ordering === "editorial" ? 1 / (1 + other.index / 5) : 0.5 / (1 + other.index / 15);
        const strength = similarity * prominence * other.sourceWeight;
        corroboration.set(other.source, Math.max(corroboration.get(other.source) || 0, strength));
      }
    }
    const coverage = Math.min(
      30,
      [...corroboration.values()].reduce((sum, value) => sum + value * 40, 0),
    );
    const urgent =
      candidate.categories.some((category) =>
        /^(?:breaking|breaking news|urgent|top stories)$/i.test(category),
      ) || /^breaking\s*:/i.test(candidate.title);
    return 60 * Math.exp(-ageHours / 36) + coverage + (urgent ? 10 : 0) + 3 / (1 + candidate.index);
  };
  const ranked = candidates.map((candidate) => ({ candidate, score: score(candidate) }));
  return ranked
    .sort((a, b) => {
      if (a.candidate.ordering === "editorial" || a.candidate.ordering === "feed")
        return a.candidate.index - b.candidate.index;
      return (
        b.score - a.score ||
        (b.candidate.publishedAt ?? 0) - (a.candidate.publishedAt ?? 0) ||
        a.candidate.index - b.candidate.index
      );
    })
    .map(({ candidate }) => candidate);
}
