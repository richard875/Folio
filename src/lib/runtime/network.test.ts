import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { publicFetch, publicFetchRedirects, outboundProxyUrl, outboundProxyEnabled, proxyBypassed, networkErrorDetails, permanentNetworkFailure } from "./network.ts";
import { Agent } from "undici";
import { fetchHtml } from "../../../reader/fetch.ts";

async function fakeProxy(t: TestContext, handle: (request: IncomingMessage, socket: Duplex) => void) {
  const server = createServer((_request, response) => { response.writeHead(500).end(); });
  const sockets = new Set<Duplex>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("connect", handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const previous = process.env.OUTBOUND_PROXY_URL;
  const previousEnabled = process.env.OUTBOUND_PROXY_ENABLED;
  const previousMode = process.env.OUTBOUND_PROXY_MODE;
  const previousBypass = process.env.OUTBOUND_PROXY_BYPASS_HOSTS;
  delete process.env.OUTBOUND_PROXY_BYPASS_HOSTS;
  process.env.OUTBOUND_PROXY_MODE = "configured";
  process.env.OUTBOUND_PROXY_ENABLED = "true";
  process.env.OUTBOUND_PROXY_URL = `http://test-user:test%3Apassword@127.0.0.1:${address.port}/`;
  t.after(async () => {
    if (previous === undefined) delete process.env.OUTBOUND_PROXY_URL;
    else process.env.OUTBOUND_PROXY_URL = previous;
    if (previousEnabled === undefined) delete process.env.OUTBOUND_PROXY_ENABLED;
    else process.env.OUTBOUND_PROXY_ENABLED = previousEnabled;
    if (previousMode === undefined) delete process.env.OUTBOUND_PROXY_MODE;
    else process.env.OUTBOUND_PROXY_MODE = previousMode;
    if (previousBypass === undefined) delete process.env.OUTBOUND_PROXY_BYPASS_HOSTS;
    else process.env.OUTBOUND_PROXY_BYPASS_HOSTS = previousBypass;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
}

function tunnel(socket: Duplex, response: string, inspect?: (request: string) => void) {
  socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  let request = "";
  socket.on("data", (chunk) => {
    request += chunk.toString();
    if (!request.includes("\r\n\r\n")) return;
    inspect?.(request);
    socket.end(response);
  });
}

function fixtureDns(t: TestContext, address: string) {
  const original = dns.lookup;
  dns.lookup = ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    if (hostname === "publisher.example") callback(null, [{ address, family: 4 }]);
    else Reflect.apply(original, dns, [hostname, options, callback]);
  }) as typeof dns.lookup;
  syncBuiltinESMExports();
  t.after(() => { dns.lookup = original; syncBuiltinESMExports(); });
}

test("proxy configuration is optional, validated, and errors never echo secrets", () => {
  assert.equal(outboundProxyUrl(""), undefined);
  assert.equal(outboundProxyUrl("  "), undefined);
  assert.equal(outboundProxyUrl("https://user:password@proxy.example:443/")?.protocol, "https:");
  for (const value of ["socks5://user:secret@proxy.example", "http://user:secret@proxy.example/path", "http://proxy.example/?secret", "http://proxy.example/#secret", "http://user:%zz@proxy.example", "secret"]) {
    assert.throws(() => outboundProxyUrl(value), (error: Error) => {
      assert.match(error.message, /Invalid OUTBOUND_PROXY_URL/);
      assert.doesNotMatch(error.message, /secret|%zz/);
      return true;
    });
  }
});

test("proxy toggle defaults on, supports explicit off, and rejects typos", () => {
  for (const value of ["", "  ", "true", " TRUE "]) assert.equal(outboundProxyEnabled(value), true);
  for (const value of ["false", " FALSE "]) assert.equal(outboundProxyEnabled(value), false);
  for (const value of ["0", "1", "yes", "flase"]) assert.throws(() => outboundProxyEnabled(value), /Invalid OUTBOUND_PROXY_ENABLED/);
});

test("Webshare rotating mode selects the rotation username without duplicating its suffix", () => {
  const base = "http://example-user:example-password@p.webshare.io:80/";
  assert.equal(outboundProxyUrl(base, "rotating")?.username, "example-user-rotate");
  assert.equal(outboundProxyUrl(base.replace("example-user", "example-user-rotate"), "rotating")?.username, "example-user-rotate");
  assert.equal(outboundProxyUrl(base, "configured")?.username, "example-user");
  assert.equal(outboundProxyUrl(base, "")?.username, "example-user");
  assert.equal(outboundProxyUrl(base, "rotating")?.password, "example-password");
  assert.throws(() => outboundProxyUrl(base, "typo"), /Invalid OUTBOUND_PROXY_MODE/);
  for (const value of ["http://example-user:example-password@another.example/", "http://p.webshare.io/"]) {
    assert.throws(() => outboundProxyUrl(value, "rotating"), (error: Error) => {
      assert.match(error.message, /requires the p.webshare.io gateway/);
      assert.doesNotMatch(error.message, /example-user|example-password/);
      return true;
    });
  }
});

test("rotation credentials use a fresh tunnel for repeated fetches, retries and redirects", async (t) => {
  const sockets = new Set<Duplex>();
  let connects = 0;
  await fakeProxy(t, (request, socket) => {
    connects++;
    sockets.add(socket);
    assert.equal(request.headers["proxy-authorization"], `Basic ${Buffer.from("test-user-rotate:test:password").toString("base64")}`);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () => {
      // Keep-alive would permit reuse; Folio must still start a fresh tunnel.
      if (connects === 3) socket.write("HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n");
      else if (connects === 5) socket.write("HTTP/1.1 302 Found\r\nLocation: /redirected\r\nContent-Length: 0\r\n\r\n");
      else socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 7\r\n\r\narticle");
    });
  });
  process.env.OUTBOUND_PROXY_URL = process.env.OUTBOUND_PROXY_URL!.replace("test-user:", "test-user-rotate:");
  const options = () => ({ signal: AbortSignal.timeout(2000) });
  for (let index = 0; index < 2; index++) {
    assert.equal(await (await publicFetch("http://93.184.216.34/story", options())).text(), "article");
  }
  const previousRetry = process.env.FETCH_RETRY_LIMIT;
  process.env.FETCH_RETRY_LIMIT = "1";
  t.after(() => {
    if (previousRetry === undefined) delete process.env.FETCH_RETRY_LIMIT;
    else process.env.FETCH_RETRY_LIMIT = previousRetry;
  });
  assert.equal(await fetchHtml("http://93.184.216.34/story", "direct", Date.now() + 2000), "article");
  assert.equal(await (await publicFetchRedirects("http://93.184.216.34/story", options())).text(), "article");
  assert.equal(connects, 6);
  assert.equal(sockets.size, 6);
});

test("disabled proxy ignores its URL, uses direct transport, and emits no proxy log", async (t) => {
  const previous = process.env.OUTBOUND_PROXY_URL;
  const previousEnabled = process.env.OUTBOUND_PROXY_ENABLED;
  t.after(() => {
    if (previous === undefined) delete process.env.OUTBOUND_PROXY_URL;
    else process.env.OUTBOUND_PROXY_URL = previous;
    if (previousEnabled === undefined) delete process.env.OUTBOUND_PROXY_ENABLED;
    else process.env.OUTBOUND_PROXY_ENABLED = previousEnabled;
  });
  process.env.OUTBOUND_PROXY_ENABLED = "false";
  process.env.OUTBOUND_PROXY_URL = "intentionally-invalid";
  const log = t.mock.method(console, "info", () => {});
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit & { dispatcher: unknown }) => {
    assert.ok(init.dispatcher instanceof Agent);
    return new Response("direct");
  });
  assert.equal(await (await publicFetch("https://example.com/story")).text(), "direct");
  assert.equal(log.mock.callCount(), 0);
  process.env.OUTBOUND_PROXY_ENABLED = "flase";
  await assert.rejects(publicFetch("https://example.com/story"), /Invalid OUTBOUND_PROXY_ENABLED/);
});

test("HTTP uses authenticated CONNECT and does not leak proxy authorization to the destination", async (t) => {
  let connects = 0;
  let originRequest = "";
  await fakeProxy(t, (request, socket) => {
    connects++;
    assert.equal(request.url, "93.184.216.34:80");
    assert.equal(request.headers["proxy-authorization"], `Basic ${Buffer.from("test-user:test:password").toString("base64")}`);
    tunnel(socket, "HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\narticle", (value) => { originRequest = value; });
  });
  const response = await publicFetch("http://93.184.216.34/story", { signal: AbortSignal.timeout(2000) });
  assert.equal(await response.text(), "article");
  assert.equal(response.url, "http://93.184.216.34/story");
  assert.match(originRequest, /GET \/story HTTP\/1.1/);
  assert.doesNotMatch(originRequest, /proxy-authorization|test-user|test:password/i);
  assert.equal(connects, 1);
});

test("HTTPS attempts a CONNECT tunnel on 443 and proxy refusal does not fall back", async (t) => {
  let connects = 0;
  await fakeProxy(t, (request, socket) => {
    connects++;
    assert.equal(request.url, "93.184.216.34:443");
    socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n");
  });
  await assert.rejects(publicFetch("https://93.184.216.34/story", { signal: AbortSignal.timeout(2000) }), /fetch failed/);
  assert.equal(connects, 1);
});

test("CONNECT pins validated DNS while the publisher Host header is preserved", async (t) => {
  fixtureDns(t, "93.184.216.34");
  let requestText = "";
  await fakeProxy(t, (request, socket) => {
    assert.equal(request.url, "93.184.216.34:80");
    tunnel(socket, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok", (value) => { requestText = value; });
  });
  assert.equal(await (await publicFetch("http://publisher.example/story", { signal: AbortSignal.timeout(2000) })).text(), "ok");
  assert.match(requestText, /host: publisher\.example\r\n/i);
});

test("proxy mode rejects DNS resolving to private networks before CONNECT", async (t) => {
  fixtureDns(t, "10.0.0.1");
  let connects = 0;
  await fakeProxy(t, (_request, socket) => { connects++; socket.destroy(); });
  await assert.rejects(publicFetch("https://publisher.example/story", { signal: AbortSignal.timeout(2000) }), /Private network/);
  assert.equal(connects, 0);
});

test("proxy redirects are followed through the proxy and private redirects are rejected", async (t) => {
  let connects = 0;
  await fakeProxy(t, (_request, socket) => {
    connects++;
    tunnel(socket, connects === 1
      ? "HTTP/1.1 302 Found\r\nLocation: http://8.8.8.8/next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
      : "HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/metadata\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await assert.rejects(publicFetchRedirects("http://93.184.216.34/story", { signal: AbortSignal.timeout(2000) }), /Private network/);
  assert.equal(connects, 2);
});

test("article fetching uses the shared proxy without reader changes", async (t) => {
  await fakeProxy(t, (_request, socket) => {
    tunnel(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 7\r\nConnection: close\r\n\r\narticle");
  });
  assert.equal(await fetchHtml("http://93.184.216.34/story", "direct", Date.now() + 2000), "article");
});

test("proxy mode preserves response limits and cancellation", async (t) => {
  await fakeProxy(t, (_request, socket) => {
    tunnel(socket, "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\narticle");
  });
  await assert.rejects(publicFetch("http://93.184.216.34/story", { signal: AbortSignal.timeout(2000) }, 5), /Response too large/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(publicFetch("http://93.184.216.34/story", { signal: controller.signal }), { name: "AbortError" });
});

test("per-site proxy logs report responses and failures without credentials or target queries", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "info", (line: string) => { logs.push(line); });
  let connects = 0;
  await fakeProxy(t, (_request, socket) => {
    connects++;
    if (connects === 1) tunnel(socket, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    else socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n");
  });
  const options = { signal: AbortSignal.timeout(2000) };
  assert.equal((await publicFetch("http://93.184.216.34/private-path?hash=target-secret", options)).status, 403);
  await assert.rejects(publicFetch("https://93.184.216.34/another-path?token=target-secret", options));
  assert.equal(logs.length, 2);
  const [response, failure] = logs.map((line) => JSON.parse(line));
  assert.equal(response.event, "outbound_proxy_request");
  assert.equal(response.site, "http://93.184.216.34");
  assert.match(response.proxy, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(response.status, 403);
  assert.equal(response.outcome, "response");
  assert.equal(failure.status, null);
  assert.equal(failure.outcome, "error");
  assert.equal(failure.proxyStatus, 407);
  assert.equal(typeof response.durationMs, "number");
  assert.doesNotMatch(logs.join("\n"), /test-user|password|target-secret|private-path|another-path|Basic/);
});

test("bypass list is exact-host only, never a wildcard or URL", () => {
  assert.equal(proxyBypassed(new URL("https://archive.is/story"), "ARCHIVE.IS,archive.ph"), true);
  assert.equal(proxyBypassed(new URL("https://sub.archive.is/story"), "archive.is"), false);
  assert.equal(proxyBypassed(new URL("https://archive.is.evil.example/story"), "archive.is"), false);
  assert.equal(proxyBypassed(new URL("https://archive.is/story"), ""), false);
  for (const value of ["*", "*.archive.is", "https://archive.is/", "archive.is:443"]) {
    assert.throws(() => proxyBypassed(new URL("https://archive.is/story"), value), /Invalid OUTBOUND_PROXY_BYPASS_HOSTS/);
  }
});

test("configured bypass uses direct transport but a redirect to another host returns to the proxy", async (t) => {
  await fakeProxy(t, (_request, socket) => socket.destroy());
  process.env.OUTBOUND_PROXY_BYPASS_HOSTS = "publisher.example";
  const logs: string[] = [];
  t.mock.method(console, "info", (line: string) => logs.push(line));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit & { dispatcher: unknown }) => {
    if (++calls === 1) {
      assert.ok(init.dispatcher instanceof Agent);
      return new Response(null, { status: 302, headers: { location: "https://8.8.8.8/next" } });
    }
    assert.equal(init.dispatcher instanceof Agent, false);
    return new Response("article");
  });
  assert.equal(await (await publicFetchRedirects("https://publisher.example/start")).text(), "article");
  assert.deepEqual(logs.map((line) => JSON.parse(line).event), ["outbound_proxy_bypass", "outbound_proxy_request"]);
});

test("diagnostics expose certificate failures and proxy authentication failures without raw errors", () => {
  const error = new TypeError("secret credentials and destination URL", {
    cause: Object.assign(new Error("another secret"), { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" }),
  });
  assert.deepEqual(networkErrorDetails(error), { errorCode: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", errorType: "TypeError", proxyStatus: null });
  assert.equal(permanentNetworkFailure(error), true);
  assert.equal(permanentNetworkFailure(Object.assign(new Error("reset"), { code: "ECONNRESET" })), false);
  assert.equal(permanentNetworkFailure(new Error("Proxy response (407) !== 200 when HTTP Tunneling")), true);
  assert.doesNotMatch(JSON.stringify(networkErrorDetails(error)), /secret|credentials|destination/);
});
