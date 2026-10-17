import { lookup } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, Pool, ProxyAgent } from "undici";

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

/** Unset preserves URL-based opt-in; typos must not silently bypass the proxy. */
export function outboundProxyEnabled(value = process.env.OUTBOUND_PROXY_ENABLED): boolean {
  const flag = value?.trim().toLowerCase();
  if (!flag || flag === "true") return true;
  if (flag === "false") return false;
  throw new Error("Invalid OUTBOUND_PROXY_ENABLED: expected true or false.");
}

/** Never include the supplied value (which may contain credentials) in errors. */
export function outboundProxyUrl(value = process.env.OUTBOUND_PROXY_URL, mode = process.env.OUTBOUND_PROXY_MODE): URL | undefined {
  if (!value?.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname ||
        url.pathname !== "/" || url.search || url.hash) throw new Error();
    // Validate percent escapes before passing credentials to Undici.
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch {
    throw new Error("Invalid OUTBOUND_PROXY_URL: expected an http(s) proxy URL without a path, query or fragment.");
  }
  const connectionMode = mode?.trim().toLowerCase() || "configured";
  if (connectionMode === "rotating") {
    if (url.hostname.toLowerCase().replace(/\.$/, "") !== "p.webshare.io" || !url.username || !url.password) {
      throw new Error("OUTBOUND_PROXY_MODE=rotating requires the p.webshare.io gateway with username/password authentication.");
    }
    const username = decodeURIComponent(url.username);
    // Webshare's rotating endpoint is selected by authentication, not hostname.
    if (!username.endsWith("-rotate")) url.username = encodeURIComponent(`${username}-rotate`);
  } else if (connectionMode !== "configured") {
    throw new Error("Invalid OUTBOUND_PROXY_MODE: expected configured or rotating.");
  }
  return url;
}

/** Exact host matches only: redirects are evaluated independently. */
export function proxyBypassed(url: URL, value = process.env.OUTBOUND_PROXY_BYPASS_HOSTS): boolean {
  const hosts = (value ?? "").split(",").map((host) => host.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (hosts.some((host) => !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host))) {
    throw new Error("Invalid OUTBOUND_PROXY_BYPASS_HOSTS: expected comma-separated exact hostnames, without URLs or wildcards.");
  }
  return hosts.includes(url.hostname.toLowerCase().replace(/\.$/, ""));
}

const CERTIFICATE_ERRORS = new Set([
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_NOT_YET_VALID",
]);
const NETWORK_ERRORS = new Set([
  ...CERTIFICATE_ERRORS, "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED",
  "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_ABORTED",
]);

/** Allowlisted diagnostics only: never log arbitrary error messages or URLs. */
export function networkErrorDetails(error: unknown) {
  let errorCode: string | null = null;
  let errorType: string | null = null;
  let proxyStatus: number | null = null;
  const seen = new Set<unknown>();
  for (let depth = 0; error instanceof Error && depth < 6 && !seen.has(error); depth++) {
    seen.add(error);
    if (["TimeoutError", "AbortError", "TypeError", "Error"].includes(error.name) && !errorType) errorType = error.name;
    if ("code" in error && typeof error.code === "string" && NETWORK_ERRORS.has(error.code)) errorCode = error.code;
    const match = /Proxy response \(([1-5]\d{2})\) !== 200 when HTTP Tunneling/.exec(error.message);
    if (match) proxyStatus = Number(match[1]);
    error = error.cause;
  }
  return { errorCode, errorType, proxyStatus };
}

export function permanentNetworkFailure(error: unknown): boolean {
  const { errorCode, proxyStatus } = networkErrorDetails(error);
  return errorCode === "ENOTFOUND" || (errorCode !== null && CERTIFICATE_ERRORS.has(errorCode)) ||
    proxyStatus === 407 || proxyStatus === 402;
}

async function proxyDispatcher(url: URL, proxy: URL, signal?: AbortSignal | null): Promise<ProxyAgent> {
  signal?.throwIfAborted();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const address = isIP(host) ? host : await new Promise<string>((resolve, reject) => {
    const abort = () => reject(signal?.reason ?? new Error("Request aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    publicLookup(host, { family: 0, hints: 0 }, (error, resolved) => {
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(resolved as string);
    });
  });
  signal?.throwIfAborted();
  const authority = `${isIP(address) === 6 ? `[${address}]` : address}:${url.port || (url.protocol === "https:" ? 443 : 80)}`;
  const token = proxy.username || proxy.password
    ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`
    : undefined;
  return new ProxyAgent({
    uri: proxy.origin,
    token,
    connections: 1,
    proxyTunnel: true,
    proxyTls: { timeout: 10_000 },
    requestTls: { timeout: 10_000 },
    // Pin CONNECT to our validated IP, rather than allowing the proxy to resolve
    // the hostname again (DNS rebinding). Origin, Host, TLS SNI and certificate
    // verification retain the original publisher hostname.
    clientFactory: (origin, options) => new Pool(origin, options).compose(
      (dispatch) => (options, handler) => dispatch({ ...options, path: authority }, handler),
    ),
  });
}

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
  const configuredProxy = outboundProxyEnabled() ? outboundProxyUrl() : undefined;
  const bypass = configuredProxy && proxyBypassed(url);
  const proxy = bypass ? undefined : configuredProxy;
  if (bypass) console.info(JSON.stringify({ event: "outbound_proxy_bypass", site: url.origin, proxy: configuredProxy.origin, reason: "configured_hostname" }));
  let agent: Agent | ProxyAgent | undefined;
  const started = Date.now();
  let status: number | null = null;
  let outcome = "error";
  let diagnostics: ReturnType<typeof networkErrorDetails> | undefined;
  try {
    agent = proxy ? await proxyDispatcher(url, proxy, init.signal)
      : new Agent({ connect: { lookup: publicLookup, timeout: 10_000 }, connections: 1 });
    const response = await fetch(url, { ...init, redirect: "manual", dispatcher: agent } as RequestInit);
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      outcome = "response";
      return new Response(null, { status: response.status, headers: response.headers });
    }
    const body = await boundedBytes(response, maximumBytes, init.signal ?? undefined);
    const buffered = new Response(body as BodyInit, { status: response.status, headers: response.headers });
    Object.defineProperty(buffered, "url", { value: url.href });
    outcome = "response";
    return buffered;
  } catch (error) {
    diagnostics = networkErrorDetails(error);
    throw error;
  } finally {
    if (proxy) console.info(JSON.stringify({
      event: "outbound_proxy_request",
      site: url.origin,
      proxy: proxy.origin,
      status,
      outcome,
      connectionMode: proxy.hostname === "p.webshare.io" && decodeURIComponent(proxy.username).endsWith("-rotate") ? "rotating" : "configured",
      ...diagnostics,
      durationMs: Date.now() - started,
    }));
    await agent?.destroy();
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
