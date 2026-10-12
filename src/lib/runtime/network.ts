import { lookup } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, prefix, "ipv4");
const publicV6 = new BlockList();
publicV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");

export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && publicV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export function publicUrl(raw: string): URL {
  if (raw.length > 8192) throw new Error("URL is too long.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("That is not a valid URL."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs are allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (url.username || url.password) throw new Error("URL credentials are not allowed.");
  if (!host || host === "localhost" || !host.includes(".") && !isIP(host) ||
      /\.(?:localhost|local|internal)$/.test(host) || isIP(host) && !publicAddress(host)) {
    throw new Error("Private network addresses are not allowed.");
  }
  return url;
}

/** Validate the addresses actually used by the socket, not a separate DNS preflight.
 * This prevents DNS rebinding and access to OCI's link-local metadata service. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) { callback(error, "", 4); return; }
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
      callback(new Error("Private network addresses are not allowed."), "", 4);
      return;
    }
    const matching = addresses.filter((entry) => !options.family || entry.family === options.family);
    if (!matching.length) { callback(new Error("No public address available."), "", 4); return; }
    if (options.all) callback(null, matching);
    else callback(null, matching[0].address, matching[0].family);
  });
};

/** Enforce the limit while streaming, including decoded compressed responses. */
export async function boundedBytes(response: Response, maximum: number, signal?: AbortSignal): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (length > maximum) {
    await response.body?.cancel();
    throw new Error("Response too large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("Response too large");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** A short-lived dispatcher avoids retaining an unbounded set of origin pools.
 * Redirects are deliberately manual: each new destination is validated again. */
export async function publicFetch(input: string | URL | Request, init: RequestInit = {}, maximumBytes = 8_000_000): Promise<Response> {
  const url = publicUrl(input instanceof Request ? input.url : String(input));
  const agent = new Agent({ connect: { lookup: publicLookup, timeout: 10_000 }, connections: 1 });
  try {
    const response = await fetch(url, { ...init, redirect: "manual", dispatcher: agent } as RequestInit);
    if (!response.ok) {
      await response.body?.cancel();
      return new Response(null, { status: response.status, headers: response.headers });
    }
    const body = await boundedBytes(response, maximumBytes, init.signal ?? undefined);
    const buffered = new Response(body as BodyInit, { status: response.status, headers: response.headers });
    Object.defineProperty(buffered, "url", { value: url.href });
    return buffered;
  } finally {
    await agent.destroy();
  }
}

export async function publicFetchRedirects(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  let url = input instanceof Request ? input.url : String(input);
  for (let hop = 0; hop <= 10; hop++) {
    const response = await publicFetch(url, init);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Missing redirect destination.");
    url = publicUrl(new URL(location, url).href).href;
  }
  throw new Error("Too many redirects.");
}
