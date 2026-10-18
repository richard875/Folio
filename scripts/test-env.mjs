// Test-only preload. Render exposes service variables during builds as well as
// runtime: tests must use their own fake proxies, never deployed credentials.
// Production/start/dev/build commands intentionally do not load this module.
for (const key of [
  "OUTBOUND_PROXY_URL",
  "OUTBOUND_PROXY_URLS",
  "OUTBOUND_PROXY_ENABLED",
  "OUTBOUND_PROXY_MODE",
  "OUTBOUND_PROXY_BYPASS_HOSTS",
]) delete process.env[key];
