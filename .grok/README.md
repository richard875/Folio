# App Builder reference library — scope in Folio

This directory retains generic development recipes from Folio's App Builder
template. It is **not** the live service configuration or a list of implemented
Folio features. Start with [AGENTS.md](../AGENTS.md), the
[root README](../README.md), [deployment guide](../deployment.md), and
[Folio reader skill](../docs/skills/universal-article-reader/SKILL.md).

## Apply the right environment

- Folio uses Node **24.20.0**, a React/TanStack Start frontend and a **Render Free
  Node server** (`render.yaml`, Nitro `node-server`). This checkout is used on
  macOS. Do not assume Linux `/workspace`, Vercel or an in-app preview exists.
- `references/` covers the current repository's startup, build and QA helpers.
  The [scaffold snippets](references/scaffold.md) are examples, not instructions
  to replace existing Folio entry files.
- `skills/` and their `references/` are **optional recipes**. Games, Three.js,
  Phaser, art-generation, WebRTC, Neon, accounts and runtime xAI calls are not
  active Folio features merely because their recipes are present.
- `/workspace/...` in a sandbox-specific recipe means that hosted sandbox's
  project root, not a directory to create on the user's machine. Run project
  commands from the actual repository root; use relative paths on macOS.
- Native `imagine_*`, `task`, `read_file`, `render_file` and browser CLI names
  describe tool capabilities in the original host. Check the current tool schema
  and installed commands; never invent unavailable tools or silently spend API
  quota as a substitute. The bundled image recipe is `imagine-grok-build`.
- Claims that ffmpeg, Pillow/numpy or `agent-browser` are preinstalled apply to
  the original App Builder image, not every local machine. Playwright is a Folio
  dev dependency; its Chromium binary is a separate installation when missing.
- Templates illustrating new files, schemas, public assets and future routes do
  not assert that those files already exist. Engine/API examples must be checked
  against the version actually installed when that feature is requested. Pinned
  upstream provenance files describe snapshots, not the latest upstream release.

## Account/database/connector recipes are inactive here

Folio's private APIs use **server `ACCESS_HASH`**, not account sessions.
`VITE_AUTH_ENABLED=false` comes from tracked `app-env.defaults.json` and the
Render Blueprint; leave `DATABASE_URL` unset. Process environment wins over local
JSON overrides. Merely deleting an override key does not enable accounts.

Grok broker/gate identity, automatic Neon provisioning and injected xAI/connector
credentials are host-specific capabilities, **not Render provisioning promises**.
The existing `src/lib/auth/`, `src/lib/db.ts` and `src/lib/app-data/` helpers remain
preserved but do not authorize enabling those integrations. Only implement them
for a separately authorized architecture change. Use backend-only connector calls;
if an `app-data` skill is supplied by the harness, consult it. No such skill file
is bundled in this checkout.

## Active reference entry points

- [Build/deploy](references/deploy-target.md)
- [Startup and continuity](references/hibernate-revive.md)
- [Browser QA](references/browser-qa.md)
- [Optional account/data scaffolding](references/data-and-auth.md)
- [Conditional generated-art pipelines](references/generated-art.md)

Preserve platform branding, PWA injection and the preview bridge. Reading or
updating these recipes is not authorization to generate assets, change auth,
create migrations, rotate credentials, publish, or modify saved output.
