# Folio — agent workspace instructions

## Current repository contract

Folio is an existing private, file-backed article reader/news-collection API and
React interface. Maintain it in place; do not scaffold a new app for a question,
greeting, audit or documentation request.

- **Runtime:** Node **24.20.0** (`.node-version`; `package.json` requires
  `>=24.20.0 <25`). Inspect the actual working directory and OS; this checkout is
  used on macOS, not necessarily in a Linux `/workspace` sandbox.
- **Deployment:** one Render Free Node web service in Singapore, defined in
  `render.yaml`, with Nitro's **`node-server`** preset. The retained `vercel.json`
  is template infrastructure, not the active Folio deployment target.
- **Storage:** private temporary files under `output/articles/`, `output/links/`
  and `output/jobs/`. Render sleep, restart and redeploy can erase them. No durable
  disk, database, account system or automatic job replay is configured.
- **Authentication:** server-side `ACCESS_HASH` protects private API operations;
  `/healthz` is public. `VITE_AUTH_ENABLED=false` disables optional account-auth
  scaffolding, **not** Folio's API authentication. Leave `DATABASE_URL` unset.
- **Sources of truth:** `data/feeds.json` for feeds;
  `reader/retrieval.config.ts` for publisher orders; `reader/methods.ts` for
  retrieval services/headers/timeouts. Root `reader/` is active extraction code;
  `@reader/*` maps there. Feed/batch/agent/runtime helpers live in `src/lib/`.
- **Current guides:** `README.md`, `deployment.md`, `reader/AI-GUIDE.md`,
  `scripts/*.md`, and `docs/skills/universal-article-reader/SKILL.md`.
  Keep the human `reader/README.md` very concise. Handovers/research/prompts are
  historical snapshots, not current configuration authorities.

## AI Agent Resources

Supporting skills and references from the App Builder library have one shared
home under `.claude/`, discovered by both Claude Code and OpenCode:

- **Skills:** `.claude/skills/` (18 optional feature recipes)
- **References:** `.claude/references/`
- **Indexes:** `.claude/README.md` and each resource directory's `_INDEX.md`
- **Project instructions:** this `AGENTS.md` is authoritative; `CLAUDE.md` imports it
- **OpenCode:** `opencode.json` explicitly loads the `.claude/references/` guides
- **Runtime config:** Folio reads `.claude/app-env.defaults.json` and optional
  `.claude/app-env.json`.

Edit shared resources in place; do not create tool-specific copies. These are
recipes for explicitly requested future work, not features already in Folio.
Statements about platform provisioning apply only in that platform environment.
See `.claude/README.md` for the distinction between template material and active
Folio features. No `.agents/` or `.ai/` resource tree is needed.

## 0.5 Decide scope, auth and storage before implementing

1. **Clear implementation request:** implement the requested change in place.
2. **Clearly wants a new app but vague:** choose one coherent product only if
   that is actually the user's request; do not replace Folio implicitly.
3. **Trivial / no-signal message:** build nothing; ask what they want.
4. **Question / explanation / audit:** answer or investigate; do not turn it into
   an implementation without permission.

**Accounts and database stay OFF for Folio.** Turning them on is an architecture
change requiring an explicit request. For a separately authorized app feature:

- Accounts only for an accounts/sign-in/login/profile/per-user/cross-device-save/
  inter-user-sharing/identified-leaderboard requirement. A local high score is
  not a reason to add accounts.
- A database without accounts can suit non-sensitive shared data, but public
  unowned rows are world-readable/writable; do not store personal data or expose
  destructive bulk mutations that way. Propose authenticated access instead.
- Otherwise use local state/`localStorage` as appropriate; add no migrations,
  `@/lib/db` imports or login routes. This does not replace Folio's existing
  server file store with browser storage.
- If a future account-backed feature is authorized, read `.claude/references/data-and-auth.md`
  (also in `opencode.json` instructions)
  plus the `auth`/`neon` skills. Every per-user server function must use
  `authMiddleware` and verified `context.userId` query scoping, never a client id.
  Do not add account middleware to Folio's account-free APIs.

If `AGENTS.project.md` exists, read it too.

## 1. Environment and startup

Read `package.json` before installing/upgrading dependencies or running unfamiliar
scripts. Dependencies are already installed in this checkout. Add packages only
when the requested change needs them; do not reinstall as routine QA.

### `startup.sh` (required — preserve and maintain)

The existing root `startup.sh` changes to its own directory, probes
`http://127.0.0.1:8080/`, and starts `npm run dev` in the background only if needed.
It logs to `.claude/dev.log`. Run **`sh startup.sh`** from the repository root.
Keep it idempotent and non-blocking, update it when the development start contract
changes, and never delete or rename it. In a hosted App Builder sandbox the same
root file is `/workspace/startup.sh`; do not create `/workspace` on macOS.

- Development binds **`0.0.0.0:8080`**. Keep the dev and QA preview port contracts.
- Start Vite through npm scripts, never `vite` / `npx vite` directly. The wrapper
  `scripts/with-app-env.mjs` merges tracked `.claude/app-env.defaults.json`, optional
  ignored `.claude/app-env.json`, then process variables (highest precedence).
  Only `VITE_` string entries are flags; those JSON files are not secret stores.
- `npm start` loads an existing ignored `.env` and starts the production build
  with constrained memory. Render supplies runtime environment variables and `PORT`.
  Production validates settings and rejects `DATABASE_URL`.
- Vite explicitly loads only `ACCESS_HASH`, `FETCH_RETRY_LIMIT`,
  `RSS_LINKS_PER_SECTION` and `SAVE_CONCURRENCY` from `.env` for server code.
  Export other settings before development; do not assume arbitrary unprefixed
  variables are available through Vite's client environment loading.
- Do not print/overwrite existing secrets or create environment files during an
  unrelated task. `.env.example` is the tracked placeholder reference. Never put
  access keys, proxy credentials or private tokens in source, screenshots or
  `VITE_` variables. A local environment is not proof of Render's current settings.
- The **Linux-only** `npm run preview:restart` helper uses `/proc` to own port
  8081. Prefer `npm run test:production` for disposable built-server QA on macOS.

### Preserve the application shell and platform helpers

Do not recreate `vite.config.ts`, `tsconfig.json` or the existing routes. Preserve:

- Named `getRouter()` export, `defaultErrorComponent: AppErrorComponent` (keep
  `error.message` visible), and `rewrite: previewPathRewrite()` in `src/router.tsx`.
- `<AuthProvider>`, `<PreviewHostBridge />` near the top of `<body>`, and normal
  TanStack document/head/scripts wiring in `src/routes/__root.tsx`.
- `createFileRoute("/")` for the home route, Tailwind import and button cursors.
- The build/preview-gated Nitro plugin, **`preset: "node-server"`**,
  `serverDir: "./server"`, and `grokPwaPlugin()`.
- `public/__grok/`, `server/`, `scripts/grok-pwa-*` and prewired `src/lib` helpers.
  App API routes go under `src/routes/`, never platform `server/`.
- Branding injection from `https://grok.com/grok-app-builder/extensions.js`.
  Do not hide/strip the Created with Grok/Remix controls or block them with CSP.
  Branding visibility is a project setting, not a code-removal task.
- Injector-owned `og:*` / `twitter:card`; do not duplicate them in `__root.tsx`.

Do not add login/auth routes without an authorized account feature. Never create
`src/routes/auth/popup.tsx`: the Vite plugin already serves `/auth/popup` for the
optional account scaffold. Do not add Grok sign-in buttons to Folio's access-key UI.

## 2. Work safely and verify

1. **Inspect first.** Check Git status and relevant source/instructions. Preserve
   user changes. Commit, push, credential rotation and history cleanup each need
   appropriate current authorization; one request is not standing permission.
2. **Consult matching recipes only when applicable.** UI → `.claude/skills/design-ui`;
   game/canvas/3D → `.claude/skills/building-games`; game UI → both;
   WASD/vehicles/flight → `.claude/skills/controls` before movement code.
   Only use `imagine_*` tools if actually available. Otherwise use
   CSS/SVG/canvas/geometry; abstract games stay procedural. Source images are art,
   never a substitute for an implemented UI.
   Viewer connector data, if requested, uses backend-only `src/lib/app-data/`
   helpers; read their types/client/errors first and a harness-provided `app-data`
   skill if available. This checkout has no bundled `app-data/SKILL.md` and Render
   does not automatically supply connector grants. Do not invent OAuth/SDK tools
   or send connector secrets to frontend code.
3. **Implement within scope.** Preserve async collection, save-batch, agent snapshots,
   import, authentication and Swagger. Do not purge/rewrite `output/` for tests.
   Do not restore The Hill/Axios or alter publisher/proxy decisions incidentally.
   Keep WallHop's normal HTML endpoint, hostname-scoped header and caller-bounded
   25-second allowance. Keep TLS/public-network protections and no hidden direct
   fallback. Method `direct` means publisher HTML, not a transport bypass.
4. **Use existing startup.** For work requiring dev rendering run `sh startup.sh`;
   edit in place with HMR. Restart only when configuration/dependencies/environment
   need it. Documentation-only changes do not require starting a server.
5. **Run relevant gates.** For code, `npm test`, `npm run lint`, `npm run typecheck`
   and `npm run build`; build/typecheck can run in parallel once source is stable.
   Keep the test-only proxy preload `scripts/test-env.mjs`. Use disposable fixtures,
   not broad live collection/proxy spending. For Markdown-only changes run docs and
   affected contract tests; broader gates are useful but not a new live-data audit.
6. **Brand-asset pass — optional, only for an authorized identity/build change.**
   Follow the `og` skill when a custom card is actually required. Establish
   routes/types/tokens/dependencies and non-overlapping file ownership before any
   parallel agent writes; delegate only when authorized by the user or applicable
   skill (see `.claude/skills/og/SKILL.md`). If a brand task is dispatched,
   **no `wait_tasks`, never `get_task_output`** on it; leave it running and use
   its completion notification. Its relative marker
   is `.claude/og-pending` (`/workspace/.claude/og-pending` in the hosted sandbox), stale
   after **10 minutes**. A fresh marker suppresses brand warnings; do not duplicate
   the task. Folio is a utility, not a game; documentation maintenance is not a
   reason to generate new assets or change branding.
7. **Verify rendering when UI/runtime changes.** Read `.claude/references/browser-qa.md`.
   `node scripts/browser-smoke.mjs http://127.0.0.1:8080/ docs/qa/screenshots/change-dev.png`
   audits desktop and mobile. Inspect both screenshots and ensure visible content,
   no horizontal overflow and no uncaught console/module/hydration errors. A curl
   200 alone is insufficient. For interactions use available browser tooling;
   check `agent-browser` availability rather than assuming it is installed. Games
   with movement require an A-left/D-right test, not just a still frame.
8. **Verify the actual build for runtime changes.** After `npm run build`,
   `PRODUCTION_SMOKE_COMPARE_DEV=1 npm run test:production` checks a disposable
   production server, synthetic APIs/storage and desktop/mobile parity. Omit the
   baseline flag if no dev server is running. Rebuild after later source edits.
   Use Linux preview restart/baseline commands only on Linux; do not kill unrelated
   processes to make a QA port available.
9. **Report accurately.** Summarize what changed and checks actually completed.
   Separate saved-file/checksum coverage from extraction validity/completeness.
   Never claim a deployment, publisher success rate or new test run without evidence.

### Communication and excluded material

Drive QA yourself; do not ask the user to run tests, inspect logs or supply
screenshots merely to verify your work. Explain product outcomes clearly. Give
file paths/commands when useful to a repository request, but do not assume a local
server URL is reachable through the user's chat preview. Do not end with "let me
know if it works" instead of verifying.

Supporting docs live under `docs/`; do not recreate root `attachments/`,
`reports/`, `research_notes/` or `screenshots/`. Keep `docs/private/`, generated
`docs/qa/` and output files ignored. Respect task-specific exclusions even if
other documentation links to them. Never rewrite historical evidence just to
make its embedded paths look current.
