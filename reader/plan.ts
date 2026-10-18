// Print both configured orders without fetching articles or reading credentials.
import { METHODS } from "./methods.ts";
import { assertPublicHttpUrl, buildProbeList } from "./targets.ts";

if (process.argv.length !== 3) {
  console.error("Usage: npm run reader:plan -- <article-url>");
  process.exitCode = 1;
} else {
  try {
    const original = assertPublicHttpUrl(process.argv[2]).href;
    console.log(`Article: ${original}`);
    console.log("Configured order only: no network requests, no cache or saved-output changes.");
    console.log("Transport routing still depends on OUTBOUND_PROXY_BYPASS_HOSTS.\n");
    for (const proxyActive of [true, false]) {
      console.log(proxyActive ? "PROXY ENABLED AND CONFIGURED" : "PROXY DISABLED / UNCONFIGURED");
      for (const [index, probe] of buildProbeList(original, proxyActive).entries()) {
        console.log(`${index + 1}. ${probe.method} — ${METHODS[probe.method].name}`);
        console.log(`   ${probe.url}`);
      }
      console.log("");
    }
  } catch {
    console.error("Please supply a public HTTP(S) article URL without credentials.");
    process.exitCode = 1;
  }
}
