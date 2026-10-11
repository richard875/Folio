# RSS article links

Run from the repository root with Node.js 22 or newer:

```sh
npm run fetch:links
```

The command reads `attachments/News site RSS feeds by section.md`, fetches the
listed feeds, and writes `output/links/links_YYYY-MM-DD_HH-mm-ss.md`. Timestamps
are UTC. Existing files are never overwritten. Each website is a level-one
heading, each section is a level-two heading, and article URLs are bullet links.
Each subsection includes at most **5 unique links** by default, keeping the order
provided by the feed (usually newest first). Set `RSS_LINKS_PER_SECTION` in the
root `.env` or environment to change this:

```env
RSS_LINKS_PER_SECTION=5
```

Missing, invalid, or non-positive values default to 5. An explicit `--limit`
overrides the environment value. The cap also applies when multiple feeds share
the same subsection.

The feed catalog includes the listed subsection filenames, path alternatives,
The Hill's five business categories, Axios's three example cities, and CNBC's
additional IDs. Generic templates, retired feeds, reference links, and sections
explicitly marked as having no feed are excluded. If you edit the research,
table rows are read on every run; abbreviated supplementary URLs are expanded
in `scripts/rss-feed-catalog.mjs`.

Up to six feeds are fetched concurrently, with a 15-second timeout per attempt.
`FETCH_RETRY_LIMIT` in the environment or the root `.env` controls retries after
the first attempt (default: 5; 0 disables retries). Existing environment values
take precedence over `.env`. Failed feeds are marked in their section without
discarding successful results. If every feed fails, a report is still saved and
the command exits with code 1. Invalid input or a write failure also exits 1.

Optional overrides:

```sh
npm run fetch:links -- --retry-limit 0 --timeout-ms 6000
npm run fetch:links -- --limit 10
npm run fetch:links -- --input path/to/feeds.md --output-dir output/links
```

Custom input uses `## Website` headings and tables whose first two columns are
section name and backtick-quoted feed URL, matching the supplied research file.

Only links currently present in a feed are collected; this is not an archive
of every article on the website. Duplicates are removed within each section,
but an article can appear in multiple sections. Google News feeds retain their
Google News article links as published in the feed; publisher URLs are not
invented or decoded. No article bodies are fetched, and no access key is needed.
