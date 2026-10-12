const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const n = m.slice(1).map((x) => Number(x));
  if (n.some((x) => x > 255)) return true;
  const [a, b] = n;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("That host is not allowed.");
  }
  if (isPrivateIpv4(host) || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    throw new Error("Private network addresses are not allowed.");
  }
  return url;
}

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

// Domains that work best with archive.is/newest (tried immediately after direct fetch)
const ARCHIVE_NEWEST_DOMAINS = new Set([
  "wsj.com",
  "www.wsj.com",
  "axios.com",
  "www.axios.com",
  "thehill.com",
  "www.thehill.com",
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

export type Probe = { method: string; url: string };

export function probeList(original: string): Probe[] {
  const enc = encodeURIComponent(original);
  const premium = isPremiumDomain(original);
  const archiveNewest = isArchiveNewestDomain(original);

  // Build the cascade
  const raw: Probe[] = [
    { method: "direct", url: original },
  ];

  if (archiveNewest) {
    // For WSJ and similar domains, try archive.is/newest first (after direct)
    raw.push(
      { method: "archive.is-newest", url: `https://archive.is/newest/${original}` },
    );
  }

  if (premium) {
    // For premium domains, try Freedium and Freedium-mirror first (both raw and encoded)
    raw.push(
      { method: "freedium", url: `https://freedium.cfd/${original}` },
      { method: "freedium-encoded", url: `https://freedium.cfd/${enc}` },
      { method: "freedium-mirror", url: `https://freedium-mirror.cfd/${original}` },
      { method: "freedium-mirror-encoded", url: `https://freedium-mirror.cfd/${enc}` },
    );
  }

  // Standard cascade for all domains
  raw.push(
    { method: "freedium", url: `https://freedium.cfd/${original}` },
    { method: "freedium-encoded", url: `https://freedium.cfd/${enc}` },
    { method: "freedium-mirror", url: `https://freedium-mirror.cfd/${original}` },
    { method: "freedium-mirror-encoded", url: `https://freedium-mirror.cfd/${enc}` },
    { method: "removepaywalls", url: `https://removepaywalls.com/${original}` },
    { method: "removepaywall", url: `https://removepaywall.com/${original}` },
    { method: "removepaywall-co", url: `https://removepaywall.co/${original}` },
    { method: "smry", url: `https://smry.ai/${original}` },
    { method: "12ft", url: `https://12ft.io/${original}` },
    // archive.is/newest comes first among archive services (if not already added for archiveNewest domains)
    { method: "archive.is-newest", url: `https://archive.is/newest/${original}` },
    { method: "archive.today", url: `https://archive.today/latest/${original}` },
    { method: "archive.ph", url: `https://archive.ph/${original}` },
    { method: "archive.is", url: `https://archive.is/${original}` },
    { method: "wayback", url: `https://web.archive.org/web/${original}` },
    { method: "wayback-id", url: `https://web.archive.org/web/id_/${original}` },
    { method: "googlebot", url: original },
  );

  const seen = new Set<string>();
  return raw.filter((p) => {
    const key = `${p.method}|${p.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
