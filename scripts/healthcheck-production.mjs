try {
  if (!process.env.ACCESS_HASH) throw new Error("missing credential");
  const port = process.env.PORT || "3000";
  if (!/^\d+$/.test(port)) throw new Error("invalid port");
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${process.env.ACCESS_HASH}` },
    redirect: "error",
  });
  if (!response.ok || (await response.json()).status !== "ready") throw new Error("not ready");
} catch {
  // Never log a URL, credential, request headers, or a remote response body.
  console.error("Folio health check failed: inspect service availability and storage capacity.");
  process.exitCode = 1;
}
