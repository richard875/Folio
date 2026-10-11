import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ArticleResult } from "./types.ts";

export type SaveOptions = {
  format?: string;
  website?: string | null;
  section?: string | null;
  outputDir?: string;
  /** A batch's trusted start timestamp fixes its destination folder. */
  jobStartedAt?: string;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<unknown>;
};

const WEBSITE_NAMES: Record<string, string> = {
  "wsj.com": "WSJ",
  "nytimes.com": "NY Times",
  "washingtonpost.com": "Washington Post",
  "bloomberg.com": "Bloomberg",
  "economist.com": "The Economist",
  "thehill.com": "The Hill",
  "axios.com": "Axios",
  "ft.com": "Financial Times",
  "foreignpolicy.com": "Foreign Policy",
  "cnbc.com": "CNBC",
  "reuters.com": "Reuters",
  "businessinsider.com": "Business Insider",
};

function safePart(value: string, fallback: string, maxLength: number): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, maxLength)
      .replace(/_+$/g, "") || fallback
  );
}

export function articleNames(originalUrl: string, options: SaveOptions = {}) {
  const url = new URL(originalUrl);
  const host = url.hostname.replace(/^www\./, "");
  const domain = Object.keys(WEBSITE_NAMES).find(
    (name) => host === name || host.endsWith(`.${name}`),
  );
  const website = options.website?.trim() || (domain ? WEBSITE_NAMES[domain] : host);
  // Date-based paths may identify a section after YYYY/MM/DD. A lone final
  // slug is an article title, not a section. Opaque content IDs are unclassified.
  const segments = url.pathname.split("/").filter(Boolean);
  while (segments.length && /^\d+$/.test(segments[0])) segments.shift();
  const first = segments[0];
  const inferred =
    segments.length > 1 && first && !["articles", "article", "content", "rss"].includes(first)
      ? first
      : "General";
  return {
    website: safePart(website, "website", 40),
    section: safePart(options.section?.trim() || inferred, "general", 40),
  };
}

/** Save only public article data, never the access key or fetching details. */
export async function saveArticle(
  article: ArticleResult,
  options: SaveOptions = {},
): Promise<string> {
  const root = resolve(options.outputDir ?? resolve(process.cwd(), "output/articles"));
  const format = options.format === "json" ? "json" : "markdown";
  const extension = format === "json" ? "json" : "md";
  const content = format === "json" ? `${JSON.stringify(article, null, 2)}\n` : article.markdown;
  const names = articleNames(article.originalUrl, options);
  const title = safePart(article.title.trim().split(/\s+/).slice(0, 5).join(" "), "untitled", 100);
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? sleep;
  const fixedFolderTimestamp = options.jobStartedAt
    ? new Date(options.jobStartedAt).toISOString()
    : null;
  for (;;) {
    const timestamp = now().toISOString();
    const folderTimestamp = fixedFolderTimestamp ?? timestamp;
    const folder = `${folderTimestamp.slice(0, 10)}_${folderTimestamp.slice(11, 16).replace(":", "-")}`;
    const time = timestamp.slice(11, 19).replace(/:/g, "-");
    const filename = `${names.website}_${names.section}_${title}_${time}.${extension}`;
    const directory = resolve(root, folder);
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(resolve(directory, filename), content, { flag: "wx" });
      return `output/articles/${folder}/${filename}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Keep second-precision naming while preventing concurrent overwrites.
      await wait(1000);
    }
  }
}
