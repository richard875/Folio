import { parseHTML } from "linkedom";
import { parseArticleHtml, type ParsedPage } from "./extract.ts";
import { publicUrl } from "../src/lib/runtime/network.ts";

/** Service payloads are data, never executable scripts or arbitrary JSON articles. */
export function parseArticleResponse(body: string, finalUrl: string, method: string): ParsedPage | null {
  const url = new URL(finalUrl);
  if (url.hostname === "r.jina.ai" && ["jina-http", "jina-https", "jina-enc", "textise-dot-iitty"].includes(method)) {
    // Jina's default response is an envelope followed by Markdown, not HTML.
    // Require the envelope and reject upstream error/challenge warnings, even
    // when their diagnostic text is long enough to pass the length heuristic.
    const envelope = /^Title: ([^\r\n]+)\r?\n+URL Source: (https?:\/\/[^\r\n]+)\r?\n([\s\S]*?)^Markdown Content:\s*\r?\n([\s\S]+)$/m.exec(body.trim());
    if (!envelope || envelope.index !== 0 || /^Warning:/m.test(envelope[3])) return null;
    if (/^(?:just a moment[.…]*|attention required!?|verify you are human|security check)$/i.test(envelope[1].trim())) return null;
    try { publicUrl(envelope[2]); } catch { return null; }
    const text = envelope[4].trim();
    if (text.length < 280) return null;
    return { title: envelope[1].trim(), author: "", published: "", text, images: [] };
  }

  if (url.hostname === "freedium-mirror.cfd" && ["freedium-mirror", "freedium-mirror-encoded"].includes(method) &&
      body.trimStart().startsWith("<") && body.includes(".resolve(")) {
    const { document } = parseHTML(body);
    // Current Freedium streams cache misses in Svelte data, leaving the initial
    // DOM empty. Read only the JSON-encoded HTML string in the advertised data
    // record. Never eval JS, fetch script URLs, or follow internal API addresses.
    for (const script of document.querySelectorAll("script:not([src])")) {
      const match = /\b__sveltekit_\w+\.resolve\(\d+,\s*\(\)\s*=>\s*\[\{html:("(?:[^"\\]|\\.)*")/.exec(script.textContent || "");
      if (!match) continue;
      try {
        const html: unknown = JSON.parse(match[1]);
        if (typeof html !== "string") continue;
        const parsed = parseArticleHtml(`<html><body><article>${html}</article></body></html>`, finalUrl);
        const title = /\barticle:\{title:("(?:[^"\\]|\\.)*")/.exec((script.textContent || "").slice(match.index + match[0].length));
        if (parsed && title) parsed.title = JSON.parse(title[1]) as string;
        return parsed;
      } catch { return null; }
    }
  }
  const parsed = parseArticleHtml(body, finalUrl);
  // An archive calendar/JS bootstrap page is not a short archived article.
  if (["wayback", "wayback-id"].includes(method) && url.hostname === "web.archive.org" &&
      parsed?.title.trim().toLowerCase() === "wayback machine") return null;
  return parsed;
}
