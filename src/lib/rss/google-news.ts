import { parseHTML } from "linkedom";
import { assertPublicHttpUrl } from "../reader/targets.ts";
import { boundedBytes, publicFetch } from "../runtime/network.ts";

function articleId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.hostname !== "news.google.com" || url.protocol !== "https:") return null;
    return /^\/(?:rss\/)?(?:articles|read)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isGoogleNewsArticle(raw: string): boolean {
  return articleId(raw) !== null;
}

function publisherUrl(raw: string): string {
  const url = assertPublicHttpUrl(raw);
  if (
    url.username ||
    url.password ||
    url.hostname === "google.com" ||
    url.hostname.endsWith(".google.com")
  ) {
    throw new Error("Unable to resolve the publisher URL.");
  }
  return url.href;
}

function rpcPublisher(text: string): string | null {
  const body = text.replace(/^\)\]\}'[^\n]*\n/, "").trim();
  const frames = [
    body,
    ...body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("[")),
  ];
  for (const frame of frames) {
    try {
      const rows: unknown = JSON.parse(frame);
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (
          !Array.isArray(row) ||
          row[0] !== "wrb.fr" ||
          row[1] !== "Fbv4je" ||
          typeof row[2] !== "string"
        )
          continue;
        const payload: unknown = JSON.parse(row[2]);
        if (Array.isArray(payload) && payload[0] === "garturlres" && typeof payload[1] === "string")
          return payload[1];
      }
    } catch {
      /* Google can return length-prefixed JSON frames. */
    }
  }
  return null;
}

/** Resolve Google's article wrapper; direct publisher links cause no requests. */
export async function resolveGoogleNewsUrl(
  raw: string,
  fetchImpl: typeof fetch = publicFetch,
): Promise<string> {
  const id = articleId(raw);
  if (!id) return raw;
  const page = new URL(`https://news.google.com/rss/articles/${id}`);
  page.search = new URLSearchParams({ hl: "en-US", gl: "US", ceid: "US:en" }).toString();
  const signal = AbortSignal.timeout(20_000);
  const headers = { "user-agent": "Mozilla/5.0 (compatible; FolioRSS/1.0)", accept: "text/html" };
  let current = page;
  let html = "";
  for (let hop = 0; hop < 6; hop++) {
    const response = await fetchImpl(current.href, { redirect: "manual", signal, headers });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Unable to resolve the publisher URL.");
      const destination = new URL(location, current);
      if (destination.hostname !== "news.google.com") return publisherUrl(destination.href);
      if (destination.protocol !== "https:" || destination.username || destination.password)
        throw new Error("Unable to resolve the publisher URL.");
      current = destination;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Unable to resolve the publisher URL.");
    }
    html = new TextDecoder().decode(await boundedBytes(response, 3_000_000, signal));
    break;
  }
  // Recent Google News URLs use a browser-side redirect rather than HTTP
  // Location. Read its signed article reference and request the destination.
  const { document } = parseHTML(html);
  const reference = document.querySelector("[data-n-a-sg][data-n-a-ts]");
  const signature = reference?.getAttribute("data-n-a-sg");
  const timestamp = reference?.getAttribute("data-n-a-ts");
  if (!signature || !timestamp || !/^\d+$/.test(timestamp))
    throw new Error("Unable to resolve the publisher URL.");
  const context = [
    ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
    "X",
    "X",
    1,
    [1, 1, 1],
    1,
    1,
    null,
    0,
    0,
    null,
    0,
  ];
  const payload = JSON.stringify([
    [
      [
        "Fbv4je",
        JSON.stringify(["garturlreq", context, id, Number(timestamp), signature]),
        null,
        "0",
      ],
    ],
  ]);
  const response = await fetchImpl(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
    {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ "f.req": payload }),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Unable to resolve the publisher URL.");
  }
  const destination = rpcPublisher(new TextDecoder().decode(await boundedBytes(response, 3_000_000, signal)));
  if (!destination) throw new Error("Unable to resolve the publisher URL.");
  return publisherUrl(destination);
}
