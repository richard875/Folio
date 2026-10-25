import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { outboundProxyUrls } from "../src/lib/runtime/network.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("documented dotenv pool examples validate without reading private environment files", async () => {
  for (const path of ["REFERENCE.md", ".env.example"]) {
    const example = /OUTBOUND_PROXY_URLS='([^'\n]+)'/.exec(await read(path))?.[1];
    assert.ok(example, `${path}: missing pool example`);
    const proxies = outboundProxyUrls(example, "invalid-ignored-single", "rotating");
    assert.equal(proxies.length, 3);
    assert.deepEqual(proxies.map((proxy) => proxy.username), ["ACCOUNT_1-rotate", "ACCOUNT_2-rotate", "ACCOUNT_3-rotate"]);
    assert.ok(proxies.every((proxy) => proxy.hostname === "p.webshare.io"));
  }
});

test("proxy guides document pool precedence, process-local state and separate bandwidth limits", async () => {
  for (const path of ["REFERENCE.md", "deployment.md", "reader/AI-GUIDE.md", "docs/skills/universal-article-reader/SKILL.md"]) {
    const text = (await read(path)).replace(/\s+/g, " ");
    for (const setting of ["OUTBOUND_PROXY_URLS", "OUTBOUND_PROXY_URL"]) assert.ok(text.includes(setting), `${path}: ${setting}`);
    assert.match(text, /replac(?:es|ing)/i, path);
    assert.match(text, /process/i, path);
    assert.match(text, /quota|bytes|bandwidth/i, path);
  }
  const reference = await read("REFERENCE.md");
  assert.match(reference, /without the surrounding dotenv/);
  assert.match(reference, /proxyIndex/);
  assert.match(reference, /proxyPoolSize/);
});
