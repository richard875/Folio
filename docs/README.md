# Documentation and supporting files

| Location | Contents |
| --- | --- |
| [skills/universal-article-reader/SKILL.md](skills/universal-article-reader/SKILL.md) | Current Folio workflow for AI agents |
| [prompts/daily-news-brief.md](prompts/daily-news-brief.md) | Recovered daily-brief example; credentials and service address replaced with placeholders |
| [handovers/2026-10-12.md](handovers/2026-10-12.md) | Recovered historical handover; credentials redacted and outdated claims labelled |
| [handovers/2026-10-18.md](handovers/2026-10-18.md) | Historical continuation handover; not a current configuration source |
| [research/proxy-options/overview.md](research/proxy-options/overview.md) | Proxy research report |
| [research/proxy-options/](research/proxy-options/) | Supporting managed-proxy, public/hosted-proxy and scraping-API notes |
| `qa/screenshots/` | New desktop/mobile screenshots and adjacent JSON verdicts; ignored |
| `qa/archive/` | Original screenshots and verdicts preserved unchanged; ignored |
| `qa/logs/` | Historical build, test and server logs; ignored |
| `qa/feed-samples/` | Historical feed response samples, not the active feed catalog; ignored |
| `private/oracle/` | Private deployment PDFs, key files and warning capture; local-only and ignored |

Private files are not published as documentation. Do not print, stage or commit
their contents. Some logs and captures may also contain sensitive historical data;
keep all generated QA artifacts ignored. Research pricing/findings are historical,
not a promise of current service terms or an implemented scraping-API integration.

## Moved locations

| Former location | Current location |
| --- | --- |
| `attachments/SKILL.md` | `docs/skills/universal-article-reader/SKILL.md` |
| `attachments/private/*` | `docs/private/oracle/*` |
| `reports/Folio handover 2026-10-18.md` | `docs/handovers/2026-10-18.md` |
| `reports/Free proxy options for Folio.md` | `docs/research/proxy-options/overview.md` |
| `research_notes/Free proxy options for Folio/*` | `docs/research/proxy-options/*` |
| `screenshots/*.png`, `screenshots/*.json` | `docs/qa/archive/` with unchanged filenames |
| `screenshots/*.log` | `docs/qa/logs/` |
| `screenshots/feed-samples/*` | `docs/qa/feed-samples/*` |

The handover and archived verdicts retain their original text/paths as historical
evidence. Use the table above to locate moved files. The handover also mentions a
Markdown feed catalog that was removed earlier; the current catalog is
[`data/feeds.json`](../data/feeds.json). No saved articles or jobs were moved.

API guides remain beside their tools in `scripts/`; reader/configuration guides
remain in `reader/` and `data/`. Root setup/deployment instructions remain in
`README.md` and `deployment.md`. This consolidation covers the former four folders.
