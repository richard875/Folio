import assert from "node:assert/strict";
import { test } from "node:test";
import { isGoogleNewsArticle, resolveGoogleNewsUrl } from "./google-news.ts";

const GOOGLE = "https://news.google.com/rss/articles/CBMiExample?oc=5";
const PUBLISHER = "https://www.reuters.com/world/example-story/";
const PAGE =
  '<div data-n-a-id="CBMiExample" data-n-a-sg="example-signature" data-n-a-ts="1791726338"></div>';

function rpc(url: string) {
  return `)]}'\n\n${JSON.stringify([
    ["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", url, 1]), null, null, null, "0"],
    ["di", 12],
  ])}`;
}

test("only recognizes Google News article wrappers", () => {
  assert.equal(isGoogleNewsArticle(GOOGLE), true);
  assert.equal(isGoogleNewsArticle("https://news.google.com/read/CBMiExample"), true);
  assert.equal(isGoogleNewsArticle("https://news.google.com/articles/CBMiExample"), true);
  assert.equal(isGoogleNewsArticle("https://news.google.com/rss/search?q=reuters"), false);
  assert.equal(
    isGoogleNewsArticle("https://news.google.com.evil.example/rss/articles/CBMiExample"),
    false,
  );
});

test("direct publisher URLs remain unchanged and cause no requests", async () => {
  assert.equal(
    await resolveGoogleNewsUrl(PUBLISHER, async () => {
      assert.fail("Must not request direct links");
    }),
    PUBLISHER,
  );
});

test("follows Google hops and returns the publisher Location without fetching the publisher", async () => {
  let requests = 0;
  const url = await resolveGoogleNewsUrl(GOOGLE, async (input, options) => {
    assert.equal(options?.redirect, "manual");
    assert.equal(new URL(String(input)).hostname, "news.google.com");
    requests++;
    return new Response(null, {
      status: 302,
      headers: { location: requests === 1 ? "/rss/articles/CBMiExample?hl=en-US" : PUBLISHER },
    });
  });
  assert.equal(url, PUBLISHER);
  assert.equal(requests, 2);
});

test("resolves the browser-side redirect using its signed article reference", async () => {
  let requests = 0;
  const url = await resolveGoogleNewsUrl(GOOGLE, async (input, options) => {
    requests++;
    if (requests === 1) return new Response(PAGE);
    assert.match(String(input), /news\.google\.com\/_\/DotsSplashUi\/data\/batchexecute/);
    assert.equal(options?.method, "POST");
    const form = options?.body as URLSearchParams;
    const envelope = JSON.parse(form.get("f.req")!);
    const payload = JSON.parse(envelope[0][0][1]);
    assert.equal(payload[2], "CBMiExample");
    assert.equal(payload[3], 1791726338);
    assert.equal(payload[4], "example-signature");
    return new Response(rpc(PUBLISHER));
  });
  assert.equal(url, PUBLISHER);
  assert.equal(requests, 2);
});

test("supports length-prefixed RPC responses", async () => {
  let requests = 0;
  const url = await resolveGoogleNewsUrl(GOOGLE, async () => {
    if (!requests++) return new Response(PAGE);
    const frame = rpc(PUBLISHER).split("\n\n")[1];
    return new Response(`)]}'\n\n${frame.length}\n${frame}\n`);
  });
  assert.equal(url, PUBLISHER);
});

test("rejects missing redirects, missing references and invalid RPC responses", async () => {
  await assert.rejects(
    resolveGoogleNewsUrl(GOOGLE, async () => new Response("No article reference")),
    /resolve/,
  );
  await assert.rejects(
    resolveGoogleNewsUrl(GOOGLE, async () => new Response(null, { status: 302 })),
    /resolve/,
  );
  let requests = 0;
  await assert.rejects(
    resolveGoogleNewsUrl(GOOGLE, async () => new Response(!requests++ ? PAGE : "invalid JSON")),
    /resolve/,
  );
});

test("rejects private, non-http, Google consent and credential-bearing destinations", async () => {
  for (const destination of [
    "http://127.0.0.1/private",
    "https://metadata.google.internal/",
    "file:///private",
    "https://consent.google.com/",
    "https://user:password@reuters.com/story",
  ]) {
    await assert.rejects(
      resolveGoogleNewsUrl(
        GOOGLE,
        async () => new Response(null, { status: 302, headers: { location: destination } }),
      ),
    );
    let requests = 0;
    await assert.rejects(
      resolveGoogleNewsUrl(GOOGLE, async () => new Response(!requests++ ? PAGE : rpc(destination))),
    );
  }
});
