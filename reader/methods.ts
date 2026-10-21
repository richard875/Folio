/**
 * RETRIEVAL METHODS — service definitions, not publisher ordering.
 * Edit retrieval.config.ts to reorder/disable methods for a publisher.
 * See README.md in this folder for URL placeholders and proxy-routing rules.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
export const BINGBOT_UA = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
export const FACEBOOK_UA = "Mozilla/5.0 (compatible; FacebookBot/1.0; +http://www.facebook.com/bot.html)";
export const TWITTER_UA = "Twitterbot/1.0";

export const METHOD_DEFAULTS = {
  attemptTimeoutMs: 15_000,
  proxyBudgetMs: 6_000,
  userAgent: BROWSER_UA,
} as const;

export type RetrievalMethod = {
  name: string;
  url: string;
  userAgent?: string;
  attemptTimeoutMs?: number;
  /** Total across retries/redirects, still bounded by the article deadline. */
  totalBudgetMs?: number;
  /** Service headers must never be forwarded to another redirect hostname. */
  headers?: { hostname: string; values: Readonly<Record<string, string>> };
  /** Normal document request first; legacy loader headers are used only if advertised. */
  navigationHeaders?: Readonly<Record<string, string>>;
};

export const METHODS = {
  wallhop: {
    name: "WallHop (normal HTML page)",
    url: "https://wallhop.io/{url}",
    // Current pages serve the article on document navigation. Sending the old
    // load header immediately can return an empty 403. Keep it only for pages
    // explicitly advertising that legacy loader; never execute page scripts.
    navigationHeaders: {
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
    },
    headers: { hostname: "wallhop.io", values: { "X-Wallhop-Load": "1" } },
    attemptTimeoutMs: 25_000,
    totalBudgetMs: 25_000,
  },
  direct: {
    name: "Publisher HTML (uses the configured transport, not a proxy bypass)",
    url: "{url}",
  },
  "freedium-mirror": {
    name: "Freedium Mirror",
    url: "https://freedium-mirror.cfd/{url}",
  },
  "freedium-mirror-encoded": {
    name: "Freedium Mirror (encoded article URL)",
    url: "https://freedium-mirror.cfd/{encodedUrl}",
  },
  "archive.is-newest": {
    name: "Archive.is newest snapshot",
    url: "https://archive.is/newest/{url}",
  },
  "archive.today": {
    name: "Archive.today latest snapshot",
    url: "https://archive.today/latest/{url}",
  },
  "archive.ph": {
    name: "Archive.ph",
    url: "https://archive.ph/{url}",
  },
  "archive.is": {
    name: "Archive.is",
    url: "https://archive.is/{url}",
  },
  removepaywalls: {
    name: "RemovePaywalls",
    url: "https://removepaywalls.com/{url}",
  },
  removepaywall: {
    name: "RemovePaywall (.com)",
    url: "https://removepaywall.com/{url}",
  },
  "removepaywall-co": {
    name: "RemovePaywall (.co)",
    url: "https://removepaywall.co/{url}",
  },
  wayback: {
    name: "Wayback Machine",
    url: "https://web.archive.org/web/{url}",
  },
  "wayback-id": {
    name: "Wayback Machine (identity view)",
    url: "https://web.archive.org/web/id_/{url}",
  },
  "jina-http": {
    name: "Jina Reader (HTTP article URL)",
    url: "https://r.jina.ai/http://{urlWithoutProtocol}",
    attemptTimeoutMs: 10_000,
  },
  "jina-https": {
    name: "Jina Reader (HTTPS article URL)",
    url: "https://r.jina.ai/https://{urlWithoutProtocol}",
    attemptTimeoutMs: 10_000,
  },
  "jina-enc": {
    name: "Jina Reader (legacy encoded URL)",
    url: "https://r.jina.ai/http://{encodedUrl}",
    attemptTimeoutMs: 10_000,
  },
  "textise-dot-iitty": {
    name: "Bing cache via Jina Reader (legacy probe)",
    url: "https://r.jina.ai/http://cc.bingj.com/cache.aspx?d=503-123&u={encodedUrl}",
    attemptTimeoutMs: 10_000,
  },
  smry: {
    name: "Smry",
    url: "https://smry.ai/{url}",
  },
  "12ft": {
    name: "12ft",
    url: "https://12ft.io/{url}",
  },
  googlebot: {
    name: "Publisher HTML with Googlebot user agent",
    url: "{url}",
    userAgent: GOOGLEBOT_UA,
  },
  "direct-bingbot": {
    name: "Publisher HTML with Bingbot user agent",
    url: "{url}",
    userAgent: BINGBOT_UA,
  },
  "direct-facebook": {
    name: "Publisher HTML with Facebook user agent",
    url: "{url}",
    userAgent: FACEBOOK_UA,
  },
  "direct-twitter": {
    name: "Publisher HTML with Twitter user agent",
    url: "{url}",
    userAgent: TWITTER_UA,
  },
} as const satisfies Record<string, RetrievalMethod>;

export type MethodId = keyof typeof METHODS;

export function methodDefinition(method: string): RetrievalMethod | undefined {
  // Preserve the timeout for an old, unscheduled method name.
  if (method === "textise-iitty") return METHODS["textise-dot-iitty"];
  return Object.hasOwn(METHODS, method) ? METHODS[method as MethodId] : undefined;
}

export function userAgentFor(method: string): string {
  return methodDefinition(method)?.userAgent ?? METHOD_DEFAULTS.userAgent;
}

export function methodUrl(method: MethodId, original: string): string {
  const values = {
    url: original,
    encodedUrl: encodeURIComponent(original),
    urlWithoutProtocol: original.replace(/^https?:\/\//, ""),
  };
  return METHODS[method].url.replace(/\{(url|encodedUrl|urlWithoutProtocol)\}/g,
    (_, key: keyof typeof values) => values[key]);
}
