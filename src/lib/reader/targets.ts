export { publicUrl as assertPublicHttpUrl } from "../runtime/network.ts";

// Premium news domains that benefit from Freedium-first approach
const PREMIUM_DOMAINS = new Set([
  "nytimes.com",
  "www.nytimes.com",
  "washingtonpost.com",
  "www.washingtonpost.com",
  "bloomberg.com",
  "www.bloomberg.com",
  "reuters.com",
  "www.reuters.com",
  "economist.com",
  "www.economist.com",
  "ft.com",
  "www.ft.com",
]);

// Domains that work best with archive.is/newest (tried first)
const ARCHIVE_NEWEST_DOMAINS = new Set([
  "wsj.com",
  "www.wsj.com",
  "axios.com",
  "www.axios.com",
  "thehill.com",
  "www.thehill.com",
  "foreignpolicy.com",
  "www.foreignpolicy.com",
  "cnbc.com",
  "www.cnbc.com",
  "businessinsider.com",
  "www.businessinsider.com",
]);

// Domains that block cloud IPs heavily - need text extraction services first
const CLOUD_BLOCKED_DOMAINS = new Set([
  "wsj.com",
  "www.wsj.com",
  "axios.com",
  "www.axios.com",
  "thehill.com",
  "www.thehill.com",
  "cnbc.com",
  "www.cnbc.com",
]);

function isPremiumDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return PREMIUM_DOMAINS.has(host) || PREMIUM_DOMAINS.has(`www.${host}`);
  } catch {
    return false;
  }
}

function isArchiveNewestDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return ARCHIVE_NEWEST_DOMAINS.has(host) || ARCHIVE_NEWEST_DOMAINS.has(`www.${host}`);
  } catch {
    return false;
  }
}

function isCloudBlockedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return CLOUD_BLOCKED_DOMAINS.has(host) || CLOUD_BLOCKED_DOMAINS.has(`www.${host}`);
  } catch {
    return false;
  }
}

export type Probe = { method: string; url: string };

/** Build text-extraction service URLs (work from cloud IPs when archives are blocked) */
function textExtractionProbes(original: string, enc: string): Probe[] {
  const noProto = original.replace(/^https?:\/\//, "");
  return [
    // Jina AI Reader - works well from cloud IPs, returns clean text
    { method: "jina-http", url: `https://r.jina.ai/http://${noProto}` },
    { method: "jina-https", url: `https://r.jina.ai/https://${noProto}` },
    // Jina AI with encoded URL
    { method: "jina-enc", url: `https://r.jina.ai/http://${enc}` },
    // textise dot iitty - lightweight text extraction (via r.jina.ai proxy)
    { method: "textise-iitty", url: `https://r.jina.ai/http://r.jina.ai/http://${noProto}` },
    // textise dot iitty alternative
    { method: "textise-dot-iitty", url: `https://r.jina.ai/http://cc.bingj.com/cache.aspx?d=503-123&u=${enc}` },
  ];
}

/** Build archive service URLs (heavily rate-limited on cloud IPs) */
function archiveProbes(original: string, enc: string): Probe[] {
  return [
    { method: "archive.is-newest", url: `https://archive.is/newest/${original}` },
    { method: "archive.today", url: `https://archive.today/latest/${original}` },
    { method: "archive.ph", url: `https://archive.ph/${original}` },
    { method: "archive.is", url: `https://archive.is/${original}` },
    { method: "removepaywalls", url: `https://removepaywalls.com/${original}` },
    { method: "removepaywall", url: `https://removepaywall.com/${original}` },
    { method: "removepaywall-co", url: `https://removepaywall.co/${original}` },
    { method: "wayback", url: `https://web.archive.org/web/${original}` },
    { method: "wayback-id", url: `https://web.archive.org/web/id_/${original}` },
  ];
}

/** Build Freedium service URLs (often blocked on cloud) */
function freediumProbes(original: string, enc: string): Probe[] {
  return [
    { method: "freedium", url: `https://freedium.cfd/${original}` },
    { method: "freedium-encoded", url: `https://freedium.cfd/${enc}` },
    { method: "freedium-mirror", url: `https://freedium-mirror.cfd/${original}` },
    { method: "freedium-mirror-encoded", url: `https://freedium-mirror.cfd/${enc}` },
  ];
}

export function probeList(original: string): Probe[] {
  const enc = encodeURIComponent(original);
  const premium = isPremiumDomain(original);
  const archiveNewest = isArchiveNewestDomain(original);
  const cloudBlocked = isCloudBlockedDomain(original);

  // Build the cascade: text extraction FIRST (cloud-friendly), then freedium, then archives
  const raw: Probe[] = [];

  // For cloud-blocked domains (WSJ, Axios, The Hill, CNBC), try text extraction FIRST
  if (cloudBlocked) {
    raw.push(...textExtractionProbes(original, enc));
  }

  if (archiveNewest) {
    // For WSJ, Axios, The Hill - still try archive.is/newest early but after text extraction
    raw.push(
      { method: "archive.is-newest", url: `https://archive.is/newest/${original}` },
      { method: "archive.today", url: `https://archive.today/latest/${original}` },
      { method: "archive.ph", url: `https://archive.ph/${original}` },
      { method: "archive.is", url: `https://archive.is/${original}` },
    );
  }

  if (premium) {
    // For premium domains, try Freedium first
    raw.push(...freediumProbes(original, enc));
    // archive.is/newest early for premium domains too
    raw.push(
      { method: "archive.is-newest", url: `https://archive.is/newest/${original}` },
      { method: "archive.today", url: `https://archive.today/latest/${original}` },
      { method: "archive.ph", url: `https://archive.ph/${original}` },
      { method: "archive.is", url: `https://archive.is/${original}` },
    );
  }

  // Standard cascade for all domains
  // Try freedium for non-premium too
  raw.push(...freediumProbes(original, enc));

  // Text extraction for all domains (fallback when archives fail)
  raw.push(...textExtractionProbes(original, enc));

  // Archive services (heavily rate-limited on cloud)
  raw.push(...archiveProbes(original, enc));

  // Other services
  raw.push(
    { method: "smry", url: `https://smry.ai/${original}` },
    { method: "12ft", url: `https://12ft.io/${original}` },
    { method: "googlebot", url: original },
    // Direct fetch with different user agents (some sites allow specific crawlers)
    { method: "direct-bingbot", url: original },
    { method: "direct-facebook", url: original },
    { method: "direct-twitter", url: original },
  );

  const seen = new Set<string>();
  return raw.filter((p) => {
    const key = `${p.method}|${p.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
