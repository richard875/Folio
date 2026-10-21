# Folio news — portable Claude skill

This folder is a multi-file skill for ordinary Claude chat. Claude supplies analysis; the existing private Folio app supplies candidates and article extraction. No AI is embedded in Folio, no packages are installed, and this skill does not schedule itself.

## Install

1. Review all bundled files. Keep credentials and generated/private output outside this bundle.
2. From the Folio repository root, run `npm run skill:package` (requires Python 3). This creates `docs/qa/skills/folio-news.zip` with `folio-news/SKILL.md`, `references/`, `scripts/`, and `evals/` inside, excluding environment/private/generated files. The ZIP is a generated artifact, not tracked source. Alternatively ZIP this reviewed folder yourself. Folder name matches YAML `name`.
3. Enable code execution/file creation in Claude settings (organization policy may control this). Open **Customize → Skills**, choose **+ → Create skill → Upload a skill**, upload the ZIP and enable it. Older interfaces/docs may say **Settings → Features**. Check the current help page if labels differ.
4. Confirm the execution environment permits outbound HTTPS to your Folio host. Installing/uploading the skill does not grant network access or provision secrets. Configure `FOLIO_ORIGIN` (HTTPS root origin, no path/query/credentials) and `FOLIO_ACCESS_HASH` through an approved secure environment mechanism **only if that surface provides one**. Ordinary Claude chat has no guaranteed environment-secret provisioning UI; do not assume one or paste a hash into chat. Otherwise use an authorized local runner and upload credential-free JSON/article outputs.
5. Ask “Use Folio to brief me on the Canadian economy” or “Use Folio for today's daily briefing.” For a new save, retain terminal status JSON and use it to bind latest reads to that call.

Python 3 standard library only. No account OAuth, bearer header, package installation, publisher scraping or arbitrary request command is required/supported. HTTPS only, including tests (network tests are entirely mocked). CLI commands read secrets only from the environment, never from flags or files; avoid shell tracing and HTTP debug logs.

Run these mocked client tests from the repository root with `npm run test:skill`
in addition to the Node-only `npm test` gate. Python 3 is required for client QA
and packaging, but not for Folio's Node build/runtime; no third-party Python
packages are needed.

The current instructions cover corrected Reuters locale labels/IDs, bounded
sitemap child resolution/source ranks, job-bound snapshot reading even when
a newer folder becomes latest, and saved-text quality checks for Jina/archive
content and per-article upstream failures. Retrieval/proxy configuration remains
server-side; no portable client/API changes or proxy credentials are needed.
Re-upload the regenerated ZIP to replace an older
installed copy; editing this repository does not update Claude's installed skill.
The repository-oriented `../universal-article-reader/SKILL.md` is a separate skill,
not part of this portable ZIP. The daily briefing prompt is also separate from
the bundle; `SKILL.md` and its references contain the portable workflow.

```sh
python3 scripts/folio.py --help
python3 -B -m unittest discover -s scripts -p 'test_*.py' -v
```

`catalog --keyword canada --keyword economy` returns metadata OR matches. Write selected feed IDs/catalogVersion to a credential-free JSON file and use `fetch FILE`. Write selected candidate articles to another file and use `save FILE`. `status CALL_ID` is one poll, not a watcher; space calls by at least five seconds. Save the final JSON to `finished-status.json`, then use:

```sh
python3 scripts/folio.py read-latest --status-file finished-status.json --output-dir /explicit/new/article-directory
```

The output directory must not exist. Only verified files are written, using exclusive creation, plus `verification-ledger.json`. The CLI prints a ledger, not all article text. Without `--output-dir` it verifies in memory and prints the ledger only; use an output directory to inspect article text for synthesis. Failures exit nonzero; partially produced directories are evidence of an incomplete run, not success. Do not overwrite or reuse them.

## Platform limits and official sources

Checked 21 October 2026:

- [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview): required YAML name/description, progressive loading of references/scripts; Claude.ai network access varies with user/admin settings; API skill containers have no network or runtime package installation.
- [Using skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude): code-execution prerequisites and ZIP folder upload via Customize → Skills. Current help and platform overview differ on some plan/admin/UI details; consult your current interface rather than promising universal availability.

This is not a connector or HTTP permission grant. On the Claude API, live Folio calls need separately authorized host-side tooling outside the skill container; this bundle does not implement that integration. No live API calls or Claude behavior evals are implied by passing the mocked client tests. `evals/evals.json` contains four behavior prompts for evaluation. Installation, secret provisioning, scheduling and deployment remain separate actions.
