# Skills Index — AI Agent Resources

This catalog lists all specialized capability modules in `.claude/skills/`.
Each skill provides focused instructions and workflows for specific tasks.

**Status:** Active — these are template recipes from App Builder, not all active in Folio  
**Last Updated:** October 2026

Claude Code and OpenCode both discover `.claude/skills/` directly. Maintain each
skill here once; no tool-specific mirror or synchronization step is needed.

## How to Use Skills

Skills are specialized instruction sets that agents can load when a task matches
their description. Each skill contains:

- `SKILL.md` — Primary instructions with YAML frontmatter metadata
- `references/` — Supporting documentation (some skills only)

**Loading a skill:** Reference the skill's `SKILL.md` path when the task matches.

**Example references:**
```
.claude/skills/auth/SKILL.md — User authentication workflows
.claude/skills/controls/SKILL.md — Input handling & control verification
.claude/skills/og/SKILL.md — Social cards & app identity
```

## ⚠️ Folio Context

Most skills are **template recipes for optional features**, not active Folio
implementations. Always check whether a feature is actually implemented before
assuming it exists.

**Active Folio workflows:**
- Browser QA procedures (see `.claude/references/browser-qa.md`)
- Build & deployment (see `.claude/references/deploy-target.md`)

**Template recipes (NOT active in Folio):**
- Game development, 3D graphics, art generation
- User accounts & authentication
- Database operations
- WebRTC & multiplayer
- xAI API integration
- Asset generation pipelines

## Available Skills

### Authentication & Data

**auth** — User accounts and sign-in  
Add authentication, protected routes, and per-user data via Better Auth federation
to Grok broker (Google, X) or local email/password.  
Path: `.claude/skills/auth/SKILL.md`  
Status: ⚠️ Template recipe — Folio uses `ACCESS_HASH`, not accounts

**neon** — Database operations  
PostgreSQL database setup, migrations, queries via Neon with PGLite fallback.  
Path: `.claude/skills/neon/SKILL.md`  
Status: ⚠️ Template recipe — Folio is file-backed, no database

### Game Development

**building-games** — Game development patterns  
Core game loop, camera systems, 3D orientation, physics, and rendering architecture.  
Path: `.claude/skills/building-games/SKILL.md` + `references/`  
Status: ⚠️ Template recipe

**controls** — Input handling & control verification  
WASD, vehicles, flight, FPS mouse-look with mandatory control self-tests to prevent
inverted A/D bugs in chase-camera games.  
Path: `.claude/skills/controls/SKILL.md`  
Status: ⚠️ Template recipe

**game-animation-frames** — Character animation  
Motion/loop laws, frame timing, and sprite sheet animation for game characters.  
Path: `.claude/skills/game-animation-frames/SKILL.md`  
Status: ⚠️ Template recipe

**game-asset-core** — Game asset pipelines  
Core asset generation doctrine, verification, and retry discipline for game art.  
Path: `.claude/skills/game-asset-core/SKILL.md`  
Status: ⚠️ Template recipe

**game-character-consistency** — Character design  
Turnarounds, variants, and maintaining visual consistency across character assets.  
Path: `.claude/skills/game-character-consistency/SKILL.md`  
Status: ⚠️ Template recipe

**game-tilesets** — Tileset generation  
Seamless tiles, transitions, and tileable ground/wall assets for level design.  
Path: `.claude/skills/game-tilesets/SKILL.md`  
Status: ⚠️ Template recipe

**game-ui-icons** — Game UI assets  
HUD elements, buttons, icon sets, and interactive UI art for games.  
Path: `.claude/skills/game-ui-icons/SKILL.md`  
Status: ⚠️ Template recipe

### Asset Generation

**imagine-grok-build** — Image generation pipeline  
2D asset generation via `imagine_*` tools (text-to-image, image-to-image,
text-to-video, image-to-video). Path-based stack with result rendering.  
Path: `.claude/skills/imagine-grok-build/SKILL.md`  
Status: ⚠️ Template recipe — Check tool availability; not guaranteed

**generate2dmap** — 2D level design  
Top-down RPG maps, side-scroller stages, layered maps, collision zones for browser
games (canvas/Phaser).  
Path: `.claude/skills/generate2dmap/SKILL.md`  
Status: ⚠️ Template recipe

**generate2dsprite** — 2D sprite generation  
Character sprites, walk cycles, attacks, projectiles, FX with magenta (#FF00FF)
chroma key for postprocessing.  
Path: `.claude/skills/generate2dsprite/SKILL.md`  
Status: ⚠️ Template recipe

**video2dsprite** — Video-based sprite extraction  
Dense motion frames from video via image-to-video + ffmpeg + chroma processing.  
Path: `.claude/skills/video2dsprite/SKILL.md`  
Status: ⚠️ Template recipe — Grok-only pipeline

### Branding & Identity

**og** — Social cards & app identity  
Share-link previews: og:image card (1200×630), X banner (1200×264), SVG favicon,
PWA icons. Always run as non-blocking subagent task.  
Path: `.claude/skills/og/SKILL.md`  
Status: ⚠️ Template recipe — Folio is utility app, placeholder card is fine

### UI & Design

**design-ui** — UI design guidance  
User interface patterns, component design, and visual hierarchy for web apps.  
Path: `.claude/skills/design-ui/SKILL.md` + `references/`  
Status: ⚠️ Template recipe

### Networking & Real-time

**multiplayer-p2p** — WebRTC peer-to-peer  
P2P multiplayer, real-time communication, WebRTC data channels.  
Path: `.claude/skills/multiplayer-p2p/SKILL.md`  
Status: ⚠️ Template recipe

### 3D Graphics

**threejs** — Three.js 3D graphics  
WebGL 3D rendering, scene management, cameras, lighting, materials via three.js.  
Path: `.claude/skills/threejs/SKILL.md`  
Status: ⚠️ Template recipe

### API Integration

**xai-api** — xAI API integration  
Runtime xAI API calls for chat, embeddings, or other xAI services.  
Path: `.claude/skills/xai-api/SKILL.md`  
Status: ⚠️ Template recipe — Render doesn't auto-inject credentials

## Usage Guidelines

### Before Loading a Skill

1. **Check if the feature exists in Folio** — Most skills are template recipes
2. **Verify tool availability** — Don't assume `imagine_*`, `agent-browser`, or
   `task` tools exist based on documentation
3. **Understand platform constraints** — Grok-specific provisioning doesn't apply
   to Render deployments
4. **Read project docs first** — Start with `AGENTS.md`, `README.md`, handovers

### When Loading a Skill

- Reference the full path: `.claude/skills/<name>/SKILL.md`
- Check skill's references if it has a `references/` subdirectory
- Understand that YAML frontmatter provides metadata for discovery
- Remember these are recipes, not active implementation

### Skills vs. Folio Features

**Folio's actual features are documented in:**
- `docs/skills/universal-article-reader/SKILL.md` — Article extraction
- `reader/AI-GUIDE.md` — Reader implementation details
- `data/*.json` — Publisher inventories; only ten Main feeds active via `src/lib/rss/sources.ts`
- `reader/retrieval.config.ts` — Publisher retrieval orders

## Adding New Skills

Skills follow this structure:

```
skill-name/
├── SKILL.md           # Main instructions with YAML frontmatter
└── references/        # Optional supporting docs
    ├── detail-1.md
    └── detail-2.md
```

**YAML frontmatter format:**
```yaml
---
name: skill-name
description: >
  Detailed trigger conditions and use cases.
metadata:
  short-description: "One-line summary"
user-invocable: false
---
```

Update this index when adding or removing skills.

## Migration Notes

The original App Builder skill collection was moved from `.grok/` to the shared
`.claude/skills/` directory. All 18 skill packages and their supporting files are
retained here for both tools.
