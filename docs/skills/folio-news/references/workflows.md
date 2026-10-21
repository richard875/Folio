# Editorial workflows

## Interactive topic news

1. Establish topic, date window, breadth and desired depth. Before discovery, generate multiple literal terms and synonyms; for “Canadian economy”, use `canada`, `canadian`, `economy`, `economics`. Explain OR metadata search, then select promising Canadian/economic sections. Do not claim all matches concern Canada's economy. Disclose that non-editorial feeds retain only 72 hours of dated candidates (editorial 168 hours), so "this week" is not a comprehensive archive search; undated candidates have uncertain recency.
2. Inspect up to four catalog pages per round, not unlimited full-inventory pagination. Reuse the same catalog version; keep exact publisher filters if requested. Choose at most eight feeds per fetch, with a total candidate limit at most 100. Section labels and aliases are inferred; compatibility is unverified.
3. Fetch one bounded batch, then inspect statuses/warnings and deduplicate candidate URLs and stories. Counts are ceilings, not relevance/quantity guarantees. Consider recency, direct relevance, source diversity and redundancy. An empty feed is not proof no relevant news exists. Do not override unsupported-source/domain restrictions or invent replacement URLs/IDs; choose another discovered ID or report the gap. A second targeted discovery/fetch round is allowed if needed, then stop and report limits (maximum two rounds).
4. Select a manageable set (default roughly 5–10 stories, fewer for narrow topics). Only submit URLs actually returned as candidates; do not invent publisher URLs or follow raw feed/Google wrappers. Explain if only headline/snippet evidence is available.
5. Save selected articles once. Record call ID, poll explicitly at five-second intervals (bounded to 24 polls per chat run), and retain terminal status JSON locally without credentials. If still running, report pending with ID, not fabricated completion.
6. Read latest with `--status-file` and an explicit new `--output-dir`. If it no longer contains this call and its saved files, report that latest cannot locate the batch; do not quietly read an unrelated folder. Never resubmit to repair a lost ID automatically.
7. Inspect verified local article files for the requested selection. Summarize in chat with publisher links, dates and coverage caveats; distinguish file integrity, reading completion and extraction quality.

## Daily briefing now

1. Fetch `links` once for the ten Main feeds. State current date/timezone or ask when material. Include failed feed counts; HTTP 502 means every feed failed even if a report was saved, not “no news”.
2. Inspect report candidates, group related developments, choose diverse high-value stories and save only the shortlist. Continue steps 5–7 above. Do not use bulk collect, expand silently to every inventory feed, or claim full coverage.
3. Suggested answer: **As of**, **Top developments** (what happened / why it matters / source), **Watch next**, **Coverage and limitations**. Default to a concise chat answer, not a new document or email.
4. If asked “daily at 7am”, run now only if requested, explain the skill itself does not schedule, and ask for timezone/separate supported scheduler if the user wants recurrence. Do not claim a task was created without a scheduling tool confirmation.

## Existing latest

When the user explicitly wants the latest saved articles, `read-latest --output-dir ...` may omit `--status-file`. Disclose that it reads the latest finished folder, not a particular new job; surface untracked-folder warnings, pending collections, failures and partial extractions. Use the ledger to identify verified files, then read their local contents.

## No authorized HTTP path

State: “This chat cannot currently make authorized HTTPS requests to Folio. Installing a skill does not grant that access.” Offer uploaded credential-free candidate JSON or already saved article files. Analyze only supplied content and label its date/coverage. An authorized local operator can run the bundled CLI with environment credentials; do not ask for the access hash in chat, put it in a ZIP, or route it through web search/browser URLs. Do not claim live retrieval, saves or schedules took place.
