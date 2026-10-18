export { publicUrl as assertPublicHttpUrl } from "../src/lib/runtime/network.ts";
import { outboundProxyActive } from "../src/lib/runtime/network.ts";
import { methodUrl, type MethodId } from "./methods.ts";
import { DEFAULT_ORDER, PUBLISHERS, type RetrievalOrder } from "./retrieval.config.ts";

export type Probe = { method: MethodId; url: string };

/** Pure plan builder: no environment reads, network requests or file writes. */
export function buildProbeList(original: string, proxyActive: boolean): Probe[] {
  const host = new URL(original).hostname.toLowerCase().replace(/^www\./, "");
  const order: RetrievalOrder = Object.hasOwn(PUBLISHERS, host)
    ? PUBLISHERS[host as keyof typeof PUBLISHERS]
    : DEFAULT_ORDER;
  const methods = proxyActive ? order.withProxy : order.withoutProxy;
  // Preserve the historical duplicate-probe protection when editing lists.
  return [...new Set(methods)].map((method) => ({ method, url: methodUrl(method, original) }));
}

/** Runtime adapter. Exact-host bypasses do not change which order is selected. */
export function probeList(original: string): Probe[] {
  return buildProbeList(original, outboundProxyActive());
}
