# AI Agent Resources — Shared Source

This directory is the single source of Folio's optional App Builder skills and
supporting references, shared by Claude Code and OpenCode.

## Contents

- `skills/` — 18 discoverable skill packages; each has a `SKILL.md` and some have
  supporting `references/`, scripts, or licenses. See `skills/_INDEX.md`.
- `references/` — repository-specific startup, QA, deployment, scaffold, data/auth,
  and generated-art guidance. See `references/_INDEX.md`.
- `app-env.defaults.json` — tracked `VITE_AUTH_ENABLED=false` default.
- `dev.log` — local development log; ignored by Git. `startup.sh` writes here.

## How agents use these files

- **Claude Code** discovers project skills in `.claude/skills/`.
- **OpenCode** discovers project skills in `.claude/skills/`; `opencode.json`
  explicitly loads the guides in `.claude/references/`.
- **Project guidance** is in root `AGENTS.md`, which OpenCode loads directly and
  `CLAUDE.md` imports for Claude Code. It points to relevant references for
  on-demand reading and explains Folio-specific constraints.
- Claude Code does not automatically load every file in `references/`; read the
  applicable guide when a task calls for it. Skills load on demand from their
  metadata and descriptions.

Edit shared files here once. Neither tool needs a second resource tree, symlinks,
or a synchronization script.

## Folio context

Most skills are optional template recipes, not active Folio features. Folio is a
file-backed article reader deployed to Render Free; private APIs use server-side
`ACCESS_HASH`, account auth is disabled, and no database is configured. Do not
enable optional auth, database, game, art-generation, multiplayer, or xAI features
unless explicitly requested.

- Runtime: Node 24.20.0, React/TanStack Start, local macOS development.
- Deployment: one Render Free Node service; its temporary filesystem is not durable.
- Active sources of truth: publisher `data/*.json` inventories (only the ten
  `Main feed` entries are operational via `src/lib/rss/sources.ts`),
  `reader/retrieval.config.ts`, and `reader/methods.ts`.
- `app-env.defaults.json` carries `VITE_AUTH_ENABLED=false`. Folio's wrapper reads
  `.claude/app-env.defaults.json`, then optional ignored `.claude/app-env.json`,
  then process variables. These paths are unchanged by resource consolidation.

See `skills/_INDEX.md` and `references/_INDEX.md` for the full catalogs. OpenCode
loads `.claude/references/*.md` through `opencode.json`; Claude Code can read the
same references on demand, as directed by root `AGENTS.md`.

Use the actual tool/environment available: this checkout is macOS, not the hosted
Linux `/workspace` sandbox. Check for optional tools such as `imagine_*`,
`agent-browser`, `ffmpeg`, and `task`; do not assume they exist.

This resource set originated under `.grok/` and now lives only under `.claude/`.
The redundant `.agents/` mirror was removed after verifying its content against
this tree. No `.ai/` directory is used.

For Folio's active reader documentation, see
[`docs/skills/universal-article-reader/SKILL.md`](../docs/skills/universal-article-reader/SKILL.md)
and [`reader/AI-GUIDE.md`](../reader/AI-GUIDE.md).
