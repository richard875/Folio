# Save articles API

`GET /api/save?url=…&hash=…` reads and saves an article before returning it.
It uses the same access key and article extraction as `/api/read`.

By default, both the file and response are Markdown. Add `format=json` to save
a `.json` file and receive the same article data as JSON. Partial results use
HTTP 206. Responses are not cached, so each request creates a new saved file.
The `X-Saved-File` response header identifies its relative path.

Files are stored beneath the server's project directory:

```text
output/articles/YYYY-MM-DD_HH/website_section_first_five_title_words_HH-mm-ss.md
```

Dates and times are UTC; `HH` is the 24-hour clock. Missing directories are
created automatically and existing directories are reused. Existing files are
never overwritten: a same-name collision waits for the next second, including
across hour/day boundaries. Filenames are filesystem-safe, lowercase, and
underscore-separated; overly long parts are truncated.

The website name comes from the original URL's hostname. The section is
inferred from the URL path where possible, otherwise `general`. Override either
with `website` and `section` query parameters; this is especially useful for
Google News links or opaque article URLs:

```text
/api/save?url=https%3A%2F%2Fwww.ft.com%2Fcontent%2Farticle-id&hash=YOUR_KEY&section=Markets
```

This endpoint requires a writable filesystem on a persistent server, such as
your Oracle Cloud VM. It does not provide durable storage on serverless hosts.
The production build uses Nitro's `node-server` preset. See
`deployment/README.md` for the Oracle Cloud persistent-server setup.

Use a persistent disk and restrict access to these output directories on your
server. The access key is never written into article files. Failed reads create
no files; write failures return HTTP 500 rather than reporting a successful save.
