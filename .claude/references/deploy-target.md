# Folio build and deploy target

The active target is **Render Free**, not Vercel: `render.yaml` defines one Node
web service in Singapore. See [deployment.md](../../deployment.md) for setup,
limits, environment configuration and temporary-storage caveats. Deploy only when
authorized; a successful local build does not verify the deployed commit.

## Build and dependencies

- Use Node **24.20.0** and the existing npm scripts. The Render build installs
  with `npm ci --include=dev`, then runs lint, tests, typecheck and build.
- `npm run build` uses `scripts/with-app-env.mjs` and emits
  `.output/server/index.mjs` plus client assets. Its `db:migrate` step is a no-op
  without `DATABASE_URL`/top-level app migrations. Do not enable a database for Folio.
- Runtime imports belong in `dependencies`; test/lint tools can remain in
  `devDependencies`. Do not reinstall/upgrade packages without a task-specific need.
- Render starts `scripts/start-production.mjs` with the Blueprint's constrained
  memory settings and provider `PORT`. Locally, `npm start` supplies memory flags
  and loads an existing ignored `.env`.
- Runtime filesystem writes are intentional here but **not durable**. Do not
  re-target this file-backed app to serverless Vercel merely because the retained
  `vercel.json` exists. It is not used by the Render Blueprint.

## Preserve `vite.config.ts`

Do not replace it or `tsconfig.json`, or import a vendored config preset. Keep:

- Dev binding **`0.0.0.0:8080`** and QA preview **`127.0.0.1:8081`**.
- Nitro gated on `command === "build" || isPreview`, with
  **`preset: "node-server"`** and **`serverDir: "./server"`**. The server directory
  registers PWA/head/manifest/install middleware; disabling it loses those routes.
- `grokPwaPlugin()`, the preview bridge/path rewrite and existing auth-env wrapper.
- Server secrets out of `VITE_` variables and client imports.

## Verify the output, not just dev

For runtime/UI changes, build first and use `npm run test:production`: it starts
a disposable standalone Node server with synthetic fixtures, checks APIs/storage
and desktop/mobile rendering, then stops its own server. Add
`PRODUCTION_SMOKE_COMPARE_DEV=1` only with dev already running. Never substitute
real saved output or live publisher requests for disposable fixtures.

On **Linux only**, `npm run preview:restart` can serve built-output QA on 8081;
the helper uses `/proc` and can terminate the existing port owner. Check ownership
first. Do not use it as a macOS process-manager workaround. Rebuild after source
edits before testing a build. A module response with MIME `text/html`, a missing
asset, hydration error, or blank page is a failure despite an HTTP 200.
