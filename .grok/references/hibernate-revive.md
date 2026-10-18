# Development startup, continuity and hosted revive

## Current local Folio checkout

`AGENTS.md` § "Environment and startup" owns the contract. Use the actual checkout
and Node **24.20.0**, not a hardcoded Linux path. Root `startup.sh` already contains:

```sh
#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
mkdir -p .grok
npm run dev >>.grok/dev.log 2>&1 &
```

Run `sh startup.sh` from the repository root. It returns promptly and does not
restart a healthy service. It must remain at the project root, start through
`npm run dev`, and stay in sync with development startup changes. Do not replace
it just to follow a generic example. A health probe alone does not verify rendering.

## Follow-up work

- Inspect Git status; preserve user changes and saved `output/`.
- Edit in place. HMR normally updates source without restarting development.
- Restart when configuration, dependencies or process environment require it;
  do not kill development merely for a Markdown change.
- When rendering changes, run desktop/mobile QA and inspect both screenshots.
  For built-server verification on macOS use `npm run test:production`; the
  `/proc`-based `preview:restart` helper is Linux-only.

## Hosted App Builder sandbox only

In the original hosted environment, the project root is `/workspace` and the
platform can run `/workspace/startup.sh` after hibernate/restore. These paths and
automatic lifecycle actions are **conditional**, not how a local Mac or Render
starts Folio. A fresh unrelated template might need scaffolding; this repository
already has its app and entry files. Do not re-scaffold Folio on session changes.

Hosted snapshots restoring a workspace are distinct from **Render Free** service
sleep/restart/redeploy: Render can erase runtime files and interrupted jobs do not
resume. Keep those behaviours separate in user-facing explanations.
