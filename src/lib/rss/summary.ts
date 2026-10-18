import { parseHTML } from "linkedom";

// XML text constructs can be strings (RSS/Atom HTML) or nested nodes (Atom XHTML).
function markup(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(markup).join(" ");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([key, child]) =>
      key === "#text" ? markup(child) : `<${key}>${markup(child)}</${key}>`,
    )
    .join(" ");
}

/** Feed-provided text only: no article fetches, generated prose, or HTML in the report. */
export function feedSummary(
  values: unknown[],
  title: string,
  source: string,
  { filterStubs = true }: { filterStubs?: boolean } = {},
): string | undefined {
  const comparable = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const headline = comparable(title);
  const publisher = comparable(source);
  for (const value of values) {
    const html = markup(value);
    if (!html.trim()) continue;
    const { document } = parseHTML(`<html><body>${html}</body></html>`);
    document.querySelectorAll("script, style, noscript, template").forEach((node) => node.remove());
    document.querySelectorAll("br, p, div, li, section, h1, h2, h3").forEach((node) => {
      node.before(" ");
      node.after(" ");
    });
    const text = (document.body.textContent || "").replace(/\s+/gu, " ").trim();
    const normalized = comparable(text);
    // Most feeds reject stubs and headline-only text. Explicit publisher rules
    // may preserve a description verbatim after HTML cleanup instead.
    if (
      !text ||
      (filterStubs && (
        text.length < 40 ||
        normalized === headline ||
        normalized === headline + publisher ||
        normalized + publisher === headline
      ))
    ) continue;
    if (text.length <= 1000) return text;
    const excerpt = text.slice(0, 999).replace(/\s+\S*$/u, "").trimEnd();
    return `${excerpt}…`;
  }
  return undefined;
}
