import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const blueprint = require("js-yaml").load(readFileSync(new URL("../render.yaml", import.meta.url), "utf8"));

test("Render Blueprint provisions only one free Singapore web service", () => {
  assert.equal(blueprint.services.length, 1);
  const service = blueprint.services[0];
  assert.equal(service.type, "web");
  assert.equal(service.plan, "free");
  assert.equal(service.region, "singapore");
  assert.equal(blueprint.databases, undefined);
  assert.equal(service.disk, undefined);
});

test("free services omit the plan-gated shutdown override and drain below the default deadline", () => {
  // The public JSON schema accepts this field, but Render's Free-tier validator
  // rejects it. Keep this semantic regression separate from schema validation.
  const service = blueprint.services[0];
  assert.equal(Object.hasOwn(service, "maxShutdownDelaySeconds"), false);
  const timeout = service.envVars.find((entry) => entry.key === "NITRO_SHUTDOWN_TIMEOUT");
  assert.equal(Number(timeout.value), 20000);
  assert.ok(Number(timeout.value) < 30000);
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(example, /^NITRO_SHUTDOWN_TIMEOUT=20000$/m);
});
