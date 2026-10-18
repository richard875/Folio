import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("test preload removes inherited deployment proxy settings without changing other variables", () => {
  const keys = ["OUTBOUND_PROXY_URL", "OUTBOUND_PROXY_URLS", "OUTBOUND_PROXY_ENABLED", "OUTBOUND_PROXY_MODE", "OUTBOUND_PROXY_BYPASS_HOSTS"];
  const child = spawnSync(process.execPath, [
    "--import", fileURLToPath(new URL("./test-env.mjs", import.meta.url)),
    "--input-type=module", "--eval",
    `console.log(JSON.stringify({proxySettingsPresent:${JSON.stringify(keys)}.some(key => key in process.env), sentinel:process.env.FOLIO_TEST_SENTINEL}))`,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      OUTBOUND_PROXY_URL: "http://fixture-user:fixture-password@127.0.0.1:1/",
      OUTBOUND_PROXY_URLS: '["http://pool-user:pool-password@127.0.0.1:1/"]',
      OUTBOUND_PROXY_ENABLED: "true",
      OUTBOUND_PROXY_MODE: "rotating",
      OUTBOUND_PROXY_BYPASS_HOSTS: "freedium-mirror.cfd",
      FOLIO_TEST_SENTINEL: "preserved",
    },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { proxySettingsPresent: false, sentinel: "preserved" });
});

test("only test commands preload proxy isolation, never application commands", () => {
  const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const key of ["test", "test:proxy", "test:production"]) assert.match(scripts[key], /--import \.\/scripts\/test-env\.mjs/);
  for (const key of ["start", "dev", "build"]) assert.doesNotMatch(scripts[key], /test-env/);
});
