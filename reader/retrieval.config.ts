/**
 * EDIT FETCH ORDER HERE. Arrays run left to right; first entry is tried first.
 * "withProxy" means the proxy is enabled AND has a configured URL, even when
 * a specific service is bypassed via OUTBOUND_PROXY_BYPASS_HOSTS.
 * Moving/removing a method here does not change its network routing.
 */
import type { MethodId } from "./methods.ts";

// Everything after the ordinary Freedium Mirror attempt.
// Shared by every publisher below. Change this list to change all their tails.
export const FALLBACK_METHODS = [
  "freedium-mirror-encoded",
  "archive.is-newest",
  "archive.today",
  "archive.ph",
  "archive.is",
  "removepaywalls",
  "removepaywall",
  "removepaywall-co",
  "wayback",
  "wayback-id",
  "jina-http",
  "jina-https",
  "jina-enc",
  "textise-dot-iitty",
  "smry",
  "12ft",
  "googlebot",
  "direct-bingbot",
  "direct-facebook",
  "direct-twitter",
] as const satisfies readonly MethodId[];

export type RetrievalOrder = {
  withProxy: readonly MethodId[];
  withoutProxy: readonly MethodId[];
};

// Used for manually supplied URLs outside the ten configured publishers.
// This is not the RSS catalog; adding a publisher here does not add its feed.
export const DEFAULT_ORDER: RetrievalOrder = {
  withProxy: ["direct", "freedium-mirror", ...FALLBACK_METHODS],
  withoutProxy: ["freedium-mirror", ...FALLBACK_METHODS],
};

// Host matching is exact after removing one leading "www.". No wildcards.
// Each publisher has its own editable order; no hidden priority insertions.
export const PUBLISHERS = {
  "wsj.com": {
    name: "The Wall Street Journal",
    withProxy: ["wallhop", "direct", "freedium-mirror", ...FALLBACK_METHODS],
    withoutProxy: ["wallhop", "freedium-mirror", ...FALLBACK_METHODS],
  },
  "nytimes.com": {
    name: "The New York Times",
    withProxy: ["direct", "wallhop", "freedium-mirror", ...FALLBACK_METHODS],
    withoutProxy: ["freedium-mirror", "wallhop", ...FALLBACK_METHODS],
  },
  "washingtonpost.com": {
    name: "The Washington Post",
    withProxy: ["direct", "wallhop", "freedium-mirror", ...FALLBACK_METHODS],
    withoutProxy: ["freedium-mirror", "wallhop", ...FALLBACK_METHODS],
  },
  "bloomberg.com": {
    name: "Bloomberg",
    withProxy: ["direct", "wallhop", "freedium-mirror", ...FALLBACK_METHODS],
    withoutProxy: ["freedium-mirror", "wallhop", ...FALLBACK_METHODS],
  },
  "economist.com": {
    name: "The Economist",
    withProxy: ["direct", "wallhop", "freedium-mirror", ...FALLBACK_METHODS],
    withoutProxy: ["freedium-mirror", "wallhop", ...FALLBACK_METHODS],
  },
  "ft.com": {
    name: "Financial Times",
    withProxy: ["direct", "wallhop", "freedium-mirror", ...FALLBACK_METHODS],
    withoutProxy: ["freedium-mirror", "wallhop", ...FALLBACK_METHODS],
  },
  "foreignpolicy.com": {
    name: "Foreign Policy",
    withProxy: ["wallhop", "direct", "freedium-mirror", ...FALLBACK_METHODS],
    withoutProxy: ["wallhop", "freedium-mirror", ...FALLBACK_METHODS],
  },
  "cnbc.com": {
    name: "CNBC",
    withProxy: ["wallhop", "direct", "freedium-mirror", ...FALLBACK_METHODS],
    withoutProxy: ["wallhop", "freedium-mirror", ...FALLBACK_METHODS],
  },
  "reuters.com": {
    name: "Reuters",
    withProxy: ["direct", "wallhop", "freedium-mirror", ...FALLBACK_METHODS],
    withoutProxy: ["freedium-mirror", "wallhop", ...FALLBACK_METHODS],
  },
  "businessinsider.com": {
    name: "Business Insider",
    withProxy: ["direct", "wallhop", "freedium-mirror", ...FALLBACK_METHODS],
    withoutProxy: ["freedium-mirror", "wallhop", ...FALLBACK_METHODS],
  },
} as const satisfies Record<string, RetrievalOrder & { name: string }>;
