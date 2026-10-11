import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ArticleImage } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

export function userAgentFor(method: string): string {
  return method === "googlebot" ? GOOGLEBOT_UA : BROWSER_UA;
}

function meta(doc: Document, sel: string): string {
  const el = doc.querySelector(sel);
  return (el?.getAttribute("content") || "").trim();
}

function ldArticle(doc: Document): { body: string; headline: string; author: string; date: string } | null {
  const nodes = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  for (const node of nodes) {
    const raw = node.textContent || "";
    if (!raw.includes("articleBody") && !raw.includes("Article")) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        const found = findArticleNode(item);
        if (found?.body) return found;
      }
    } catch {
      /* ignore broken json-ld */
    }
  }
  return null;
}

function findArticleNode(node: unknown): { body: string; headline: string; author: string; date: string } | null {
  if (!node || typeof node !== "object") return null;
  const rec = node as Record<string, unknown>;
  if (typeof rec.articleBody === "string" && rec.articleBody.trim().length > 200) {
    const authorRaw = rec.author;
    let author = "";
    if (typeof authorRaw === "string") author = authorRaw;
    else if (authorRaw && typeof authorRaw === "object" && "name" in authorRaw) {
      author = String((authorRaw as { name?: unknown }).name ?? "");
    } else if (Array.isArray(authorRaw) && authorRaw[0] && typeof authorRaw[0] === "object") {
      author = String((authorRaw[0] as { name?: unknown }).name ?? "");
    }
    return {
      body: rec.articleBody.trim(),
      headline: typeof rec.headline === "string" ? rec.headline : "",
      author,
      date: typeof rec.datePublished === "string" ? rec.datePublished : "",
    };
  }
  if (Array.isArray(rec["@graph"])) {
    for (const child of rec["@graph"]) {
      const hit = findArticleNode(child);
      if (hit) return hit;
    }
  }
  return null;
}

function absUrl(src: string, base: string): string {
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}

function imagesFrom(root: ParentNode, base: string): ArticleImage[] {
  const out: ArticleImage[] = [];
  const seen = new Set<string>();
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
    if (!src || src.startsWith("data:")) continue;
    const href = absUrl(src, base);
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ alt: (img.getAttribute("alt") || "").trim(), src: href });
    if (out.length >= 12) break;
  }
  return out;
}

export type ParsedPage = {
  title: string;
  author: string;
  published: string;
  text: string;
  images: ArticleImage[];
};

const CHALLENGE = /just a moment|enable javascript|cf-browser-verification|access denied|captcha|are you a robot/i;

export function parseArticleHtml(html: string, pageUrl: string): ParsedPage | null {
  if (!html || html.length < 400) return null;
  if (CHALLENGE.test(html.slice(0, 4000)) && html.length < 20_000) return null;

  const { document } = parseHTML(html);
  const ld = ldArticle(document);
  const readable = new Readability(document).parse();

  const title =
    readable?.title?.trim() ||
    ld?.headline ||
    meta(document, 'meta[property="og:title"]') ||
    document.querySelector("title")?.textContent?.trim() ||
    "";
  const author =
    readable?.byline?.trim() ||
    ld?.author ||
    meta(document, 'meta[name="author"]') ||
    meta(document, 'meta[property="article:author"]') ||
    "";
  const published =
    ld?.date ||
    meta(document, 'meta[property="article:published_time"]') ||
    meta(document, 'meta[name="pubdate"]') ||
    meta(document, 'meta[name="date"]') ||
    "";

  const text = (readable?.textContent || ld?.body || "").replace(/\n{3,}/g, "\n\n").trim();
  const images = readable?.content
    ? imagesFrom(parseHTML(readable.content).document, pageUrl)
    : imagesFrom(document, pageUrl);

  if (text.length < 280) return null;
  return { title, author, published, text, images };
}

const SHELL =
  /paste a link and read|no link handy|type removepaywall|12ft ladder|this page is a placeholder|search the archive|wayback machine has not archived|enter a url to remove/i;

export function looksLikeShell(title: string, text: string): boolean {
  return SHELL.test(`${title}\n${text.slice(0, 900)}`);
}

export function isSubstantial(text: string): boolean {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 40);
  return text.length >= 1400 && paragraphs.length >= 4;
}

export function toMarkdown(input: {
  title: string;
  author: string;
  published: string;
  originalUrl: string;
  method: string;
  methodUrl: string;
  text: string;
  images: ArticleImage[];
  partial: boolean;
}): string {
  const lines = [
    "## Article",
    "",
    `**Title:** ${input.title || "Unknown"}`,
    `**Author:** ${input.author || "Unknown"}`,
    `**Published:** ${input.published || "Unknown"}`,
    `**Original URL:** ${input.originalUrl}`,
    `**Method that succeeded:** ${input.method} — ${input.methodUrl}`,
    input.partial ? "**Note:** Text looks short or incomplete." : "",
    "",
    input.text,
    "",
    "---",
    "",
    "## Images",
    ...(input.images.length
      ? input.images.map((img) => `- ${img.alt || "image"}: ${img.src}`)
      : ["- none"]),
    "",
  ];
  return lines.filter((line, i, arr) => !(line === "" && arr[i - 1] === "" && i < 8)).join("\n");
}
