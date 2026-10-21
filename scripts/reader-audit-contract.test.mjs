import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const run = (args, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "reader/audit.ts", ...args], {
  encoding: "utf8",
  env: { ...process.env, OUTBOUND_PROXY_ENABLED: "false", OUTBOUND_PROXY_URL: "", OUTBOUND_PROXY_URLS: "", OUTBOUND_PROXY_BYPASS_HOSTS: "", ...env },
});

test("live audit is opt-in; help does not inspect network configuration", () => {
  const result = run(["--help"], { OUTBOUND_PROXY_ENABLED: "invalid-secret", OUTBOUND_PROXY_URLS: "secret" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--live/);
  assert.doesNotMatch(result.stdout + result.stderr, /invalid-secret|outbound_proxy_request/);
});

test("live audit fails closed on missing proxies, wrong bypass rules, private URLs and unknown methods", () => {
  const configured = {
    OUTBOUND_PROXY_ENABLED: "true", OUTBOUND_PROXY_MODE: "configured",
    OUTBOUND_PROXY_URL: "http://audit-user:audit-secret@proxy.example/",
    OUTBOUND_PROXY_BYPASS_HOSTS: "wallhop.io,freedium-mirror.cfd",
  };
  for (const [args, env] of [
    [["--live", "https://example.com/story"], {}],
    [["--live", "http://169.254.169.254/metadata"], configured],
    [["--live", "https://user:private-secret@example.com/story"], configured],
    [["--live", "https://example.com/story", "private-secret"], configured],
    [["--live", "https://example.com/story", "direct,direct"], configured],
    [["--live", "https://example.com/story"], { ...configured, OUTBOUND_PROXY_BYPASS_HOSTS: "wallhop.io,freedium-mirror.cfd,example.com" }],
    [["--live", "https://example.com/story"], { ...configured, OUTBOUND_PROXY_BYPASS_HOSTS: "wallhop.io" }],
  ]) {
    const result = run(args, env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Audit refused/);
    assert.doesNotMatch(result.stdout + result.stderr, /audit-user|audit-secret|private-secret|outbound_proxy_request/);
  }
});
