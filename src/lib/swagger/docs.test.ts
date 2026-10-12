import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { handleOpenApi, handleSwaggerAsset, handleSwaggerDocs } from "./docs.ts";
import { openApiDocument } from "./openapi.ts";

const KEY = "swagger-test-key";
const originalHash = process.env.ACCESS_HASH;
beforeEach(() => {
  process.env.ACCESS_HASH = KEY;
});
afterEach(() => {
  if (originalHash === undefined) delete process.env.ACCESS_HASH;
  else process.env.ACCESS_HASH = originalHash;
});

test("UI, specification and assets reject missing and incorrect hashes", () => {
  for (const suffix of ["", "?hash=wrong"]) {
    assert.equal(handleSwaggerDocs(new Request(`http://localhost/api/docs${suffix}`)).status, 401);
    assert.equal(handleOpenApi(new Request(`http://localhost/api/openapi${suffix}`)).status, 401);
    assert.equal(
      handleSwaggerAsset(new Request(`http://localhost/api/docs/assets${suffix}`), {
        css: "CSS",
        js: "JS",
      }).status,
      401,
    );
  }
  delete process.env.ACCESS_HASH;
  assert.equal(handleSwaggerDocs(new Request(`http://localhost/api/docs?hash=${KEY}`)).status, 401);
});

test("UI is local, non-cacheable, preauthorized and does not persist browser credentials", async () => {
  const response = handleSwaggerDocs(new Request(`http://localhost/api/docs?hash=${KEY}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const html = await response.text();
  assert.match(html, /SwaggerUIBundle/);
  assert.match(html, /preauthorizeApiKey/);
  assert.match(html, /persistAuthorization:false/);
  assert.match(html, /validatorUrl:null/);
  assert.match(html, /searchParams.delete\('hash'\)/);
  assert.doesNotMatch(html, /cdn\.|localStorage|sessionStorage/);
});

test("specification and assets accept Bearer auth without revealing the secret", async () => {
  const options = { headers: { authorization: `Bearer ${KEY}` } };
  const response = handleOpenApi(new Request("http://localhost/api/openapi", options));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /swagger-test-key/);
  assert.equal(JSON.parse(text).openapi, "3.0.3");
  const css = handleSwaggerAsset(
    new Request("http://localhost/api/docs/assets?file=css", options),
    { css: "CSS", js: "JS" },
  );
  assert.equal(await css.text(), "CSS");
  assert.match(css.headers.get("content-type") || "", /text\/css/);
  assert.equal(
    handleSwaggerAsset(
      new Request("http://localhost/api/docs/assets?file=../../private", options),
      { css: "CSS", js: "JS" },
    ).status,
    404,
  );
});

test("authorized Swagger HTML includes both inline favicon sizes without extra authenticated requests", async () => {
  const favicons = { small: "data:image/png;base64,small", large: "data:image/png;base64,large" };
  const response = handleSwaggerDocs(
    new Request(`http://localhost/api/docs?hash=${KEY}`),
    favicons,
  );
  const html = await response.text();
  assert.match(html, /sizes="16x16" href="data:image\/png;base64,small"/);
  assert.match(html, /sizes="32x32" href="data:image\/png;base64,large"/);
  assert.doesNotMatch(html, /href="data:,"/);
  assert.equal(handleSwaggerDocs(new Request("http://localhost/api/docs"), favicons).status, 401);
});

test("access hashes are safely escaped inside the HTML bootstrap", async () => {
  process.env.ACCESS_HASH = '</script><script>alert("secret")</script>';
  const response = handleSwaggerDocs(
    new Request(`http://localhost/api/docs?hash=${encodeURIComponent(process.env.ACCESS_HASH)}`),
  );
  const html = await response.text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /\\u003c/);
});

test("OpenAPI describes all routes, uses unique operation IDs and resolves every schema reference", () => {
  for (const path of [
    "/api/read",
    "/api/save",
    "/api/links",
    "/api/collect",
    "/api/collect/status",
    "/api/agent/latest",
    "/api/agent/read",
    "/api/docs",
    "/api/openapi",
    "/api/docs/assets",
  ]) {
    assert.ok(path in openApiDocument.paths, path);
  }
  assert.ok(openApiDocument.paths["/api/links"].post);
  assert.ok(openApiDocument.paths["/api/collect"].post);
  const operationIds = Object.values(openApiDocument.paths).flatMap((path) =>
    Object.values(path).map((operation) => operation.operationId),
  );
  assert.equal(new Set(operationIds).size, operationIds.length);
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string") {
      let target: unknown = openApiDocument;
      for (const part of record.$ref.slice(2).split("/"))
        target = (target as Record<string, unknown>)[part];
      assert.ok(target, record.$ref);
    }
    Object.values(record).forEach(visit);
  };
  visit(openApiDocument);
  assert.deepEqual(openApiDocument.security, [{ AccessHash: [] }]);
});
