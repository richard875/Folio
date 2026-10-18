# References Index — AI Agent Resources

This catalog lists all development references available in the `.claude/references/`
directory. References provide recipes and workflows for build, test, deploy, and
QA operations specific to the Folio repository.

**Status:** Active — these are practical guides for working on Folio  
**Last Updated:** October 2026

## How to Use References

References are development recipes covering build, test, deploy, and QA workflows.
They apply to Folio's actual repository structure and constraints.

**When to read a reference:**
- Starting development: `hibernate-revive.md`
- Running QA checks: `browser-qa.md`
- Building/deploying: `deploy-target.md`
- Adding auth/database (if authorized): `data-and-auth.md`
- Generating assets (if authorized): `generated-art.md`
- Scaffolding examples: `scaffold.md`

## Available References

### browser-qa.md

**Browser testing and QA procedures**

Covers agent-driven QA workflows including Playwright smoke tests, interactive
browser verification with `agent-browser`, desktop/mobile checks, built output
validation, and control verification for games with movement.

**Key topics:**
- Mandatory smoke pass + screenshot inspection
- Desktop (1280×800) and mobile (390×844) verification
- `node scripts/browser-smoke.mjs` helper
- Interactive QA with `agent-browser batch` (if installed)
- Built server validation with `npm run test:production`
- Control self-tests for WASD/vehicle/flight games

**When to use:** Any UI or runtime change requiring browser verification.

**Important notes:**
- Playwright is a dev dependency; Chromium binary may need separate install
- `agent-browser` is optional — check availability with `command -v agent-browser`
- Production smoke uses disposable fixtures, not real output
- `/proc`-based preview restart is Linux-only; use `test:production` on macOS

---

### deploy-target.md

**Build and deployment configuration**

Documents Folio's Render Free deployment target, build process, Node version,
Nitro configuration, and verification procedures.

**Key topics:**
- Node 24.20.0 requirement
- Render Free Node service (Singapore)
- `npm run build` process and `scripts/with-app-env.mjs` wrapper
- `render.yaml` Blueprint configuration
- Vite/Nitro preservation requirements
- Production smoke tests for built output

**When to use:** Before deploying, troubleshooting build issues, or verifying
production configuration.

**Important notes:**
- Active target is **Render Free**, not Vercel (despite retained `vercel.json`)
- Runtime filesystem writes are intentional but **not durable**
- Build includes lint, tests, typecheck as validation
- Memory constraints in production startup script
- Do not enable database for file-backed Folio deployment

---

### hibernate-revive.md

**Development startup, continuity, and lifecycle**

Covers the `startup.sh` contract, HMR workflows, when to restart development,
and hosted sandbox vs. local/Render distinctions.

**Key topics:**
- `sh startup.sh` — idempotent background dev server
- Inspect Git status before editing
- HMR updates vs. full restart triggers
- QA verification after rendering changes
- Hosted `/workspace` vs. macOS local paths

**When to use:** Starting work on Folio, understanding startup contract, or
troubleshooting development server issues.

**Important notes:**
- `startup.sh` must remain at project root
- Starts `npm run dev` only if port 8080 is not responding
- Logs to `.claude/dev.log`
- Do not restart for Markdown-only changes
- Render sleep/restart behavior is different from sandbox hibernation

---

### data-and-auth.md

**Database and authentication implementation**

Optional scaffold for adding databases and user accounts. **Currently inactive
in Folio** — this is template material for future authorized architecture changes.

**Key topics:**
- Database via `@/lib/db` (Postgres or PGLite fallback)
- Migrations in `migrations/*.sql`
- Better Auth federation to Grok broker
- Server function authorization with `authMiddleware`
- Turning sign-in on with `VITE_AUTH_ENABLED=true`
- Connector/AppData backend-only rules

**When to use:** Only after explicit authorization to add accounts or database
to Folio.

**Important notes:**
- **Folio currently uses `ACCESS_HASH`, not accounts**
- `VITE_AUTH_ENABLED=false` is tracked default
- Render does not auto-provision Neon or inject Grok credentials
- Never call connector/AppData APIs from frontend code
- Read `auth` and `neon` skills for full implementation guides

---

### generated-art.md

**Asset generation pipelines (2D only)**

Covers conditional image generation workflows for illustration, game sprites,
maps, and share cards using `imagine_*` tools when available.

**Key topics:**
- 2D illustration via `imagine_text_to_image` / `imagine_image_to_image`
- Game sprite sheets with magenta chroma key (#FF00FF)
- Skill-based pipeline: `game-asset-core`, `generate2dsprite`, `generate2dmap`
- Share card generation via `og` skill
- Abstract/geometric games stay procedural (no sprites)

**When to use:** Only when `imagine_*` tools are actually available and the
task requires generated assets.

**Important notes:**
- **Check tool availability first** — tools may not exist
- Ship CSS/SVG/emoji/canvas/geometric-WebGL when gen tools unavailable
- Abstract games (Tetris, Snake, Pong) use procedural rendering
- Share cards via `og` skill, run as subagent task (if `task` tool available)
- Folio is utility app; no custom assets required

---

### scaffold.md

**First-scaffold code snippets**

Example entry files for new App Builder apps. **Not a reset procedure for Folio** —
these are optional reference patterns, not instructions to replace existing files.

**Key topics:**
- `src/router.tsx` — named `getRouter()` export pattern
- `src/routes/__root.tsx` — document shell example
- `src/routes/index.tsx` — minimal home route
- `src/styles.css` — Tailwind import example

**When to use:** Reference only — to understand entry file patterns or when
creating a separate new app (not Folio modifications).

**Important notes:**
- **Do not replace Folio's existing entry files with these examples**
- Folio already has complete application structure
- Examples show TanStack Start contracts
- Auth/Preview/Platform helpers must be preserved in Folio

---

## Usage Guidelines

### Reading References

References assume:
- You've read `AGENTS.md` and understand Folio's architecture
- You're working in `<PROJECT_ROOT>` (macOS)
- Node 24.20.0 is installed via nvm
- Dependencies are already installed

### Tool Availability

References may mention tools that aren't universally available:
- `agent-browser` — Check with `command -v agent-browser`
- `imagine_*` tools — Check available tools list
- `task` subagent tool — May not exist in all environments
- Linux-specific helpers — `/proc`-based scripts don't work on macOS

Always verify tool availability rather than assuming based on documentation.

### Platform Context

Template references may mention:
- `/workspace/` paths — Hosted sandbox, not macOS
- Automatic Grok provisioning — Platform-specific, not Render
- Grok broker/gate/connectors — Not automatically available on Render

Translate these to Folio's actual macOS local + Render Free deployment context.

## Reference Cross-References

Common reference combinations:

**Starting new work:**
1. `hibernate-revive.md` — Startup contract
2. `browser-qa.md` — Verification procedures
3. `deploy-target.md` — Build/deploy target

**Adding features (if authorized):**
1. `data-and-auth.md` — Overview
2. `.claude/skills/auth/SKILL.md` — Auth implementation
3. `.claude/skills/neon/SKILL.md` — Database implementation

**Asset generation (if authorized and tools available):**
1. `generated-art.md` — Pipeline overview
2. `.claude/skills/og/SKILL.md` — Share cards
3. Game-specific skills as needed

## Folio-Specific Notes

### Active Workflows
- Browser QA procedures ✅
- Build/deploy process ✅
- Startup contract ✅

### Template Material (Inactive)
- Database setup ⚠️
- User accounts ⚠️
- Asset generation ⚠️
- Share card customization ⚠️

Folio uses:
- Server `ACCESS_HASH` authentication (not accounts)
- File-backed storage (not database)
- Placeholder share card (utility app)
- No image generation pipelines

## Migration Notes

The original App Builder references were moved from `.grok/` to the shared
`.claude/references/` directory. Claude Code and OpenCode use these same files;
edit them here without maintaining a second copy.
