import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { BookOpen, KeyRound, Link2, Loader2 } from "lucide-react";
import type { ArticleResult } from "@/lib/reader/types";

export const Route = createFileRoute("/")({ component: Home });

const KEY_STORE = "folio-access-hash";

function Home() {
  const [url, setUrl] = useState("");
  const [hash, setHash] = useState(() =>
    typeof sessionStorage === "undefined" ? "" : sessionStorage.getItem(KEY_STORE) || "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [article, setArticle] = useState<ArticleResult | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    sessionStorage.setItem(KEY_STORE, hash);
    try {
      const q = new URLSearchParams({ url: url.trim(), hash, format: "json" });
      const res = await fetch(`/api/read?${q.toString()}`);
      const data = (await res.json()) as ArticleResult & { error?: string };
      if (!res.ok && !data.text) {
        setArticle(null);
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setArticle(data);
    } catch (err) {
      setArticle(null);
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-xs font-medium tracking-[0.22em] text-accent uppercase">
            Private reader
          </p>
          <h1 className="font-serif text-4xl font-medium tracking-tight text-ink sm:text-5xl">
            Folio
          </h1>
        </div>
        <BookOpen className="size-8 text-accent" aria-hidden="true" />
      </header>

      <form
        onSubmit={onSubmit}
        className="grid gap-4 rounded-xl border border-line bg-paper p-4 sm:p-6"
      >
        <label className="grid gap-2 text-sm font-medium text-ink">
          <span className="inline-flex items-center gap-2">
            <Link2 className="size-4 text-muted" aria-hidden="true" />
            Article URL
          </span>
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.wsj.com/…"
            className="min-h-11 rounded-lg border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-ink">
          <span className="inline-flex items-center gap-2">
            <KeyRound className="size-4 text-muted" aria-hidden="true" />
            Access key
          </span>
          <input
            required
            type="password"
            autoComplete="off"
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            className="min-h-11 rounded-lg border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? "Reading" : "Read article"}
        </button>
        <p className="text-sm leading-relaxed text-muted">
          API: <code className="text-ink">GET /api/read?url=…&hash=…</code>. Add{" "}
          <code className="text-ink">format=json</code> for JSON, or omit it for Markdown. A short
          result comes back as HTTP 206.
        </p>
        <div className="space-y-2 text-sm leading-relaxed text-muted">
          <p>
            Save API: <code className="text-ink">GET /api/save?url=…&hash=…</code>. Returns the
            article and saves it as Markdown. Add <code className="text-ink">format=json</code> to
            save and return JSON. A short result comes back as HTTP 206.
          </p>
          <p>
            Files are saved to{" "}
            <code className="break-all text-ink">
              output/articles/YYYY-MM-DD_HH/website_section_first_5_title_words_HH-mm-ss.md
            </code>{" "}
            (or <code className="text-ink">.json</code>). Timestamps use UTC and the 24-hour clock.
            Folders are created automatically; existing files are never overwritten.
          </p>
          <p>
            Website and section names are inferred from the article URL. Add{" "}
            <code className="text-ink">section=Markets</code> or{" "}
            <code className="text-ink">website=Reuters</code> to override them. The{" "}
            <code className="text-ink">X-Saved-File</code> response header provides the saved path.
            Saving requires a writable server filesystem.
          </p>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          Links API: <code className="text-ink">GET /api/links?hash=…</code>. Collects RSS article
          links and saves a timestamped Markdown file in{" "}
          <code className="text-ink">output/links</code>. Add{" "}
          <code className="text-ink">format=json</code> for grouped links and a saved-file summary.
          The default is 5 links per subsection; change{" "}
          <code className="text-ink">RSS_LINKS_PER_SECTION</code> in your server environment.
          Collection runs on demand and may take several minutes. Only one collection runs at a
          time.
        </p>
      </form>

      {error ? (
        <p
          className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-accent"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {article ? (
        <article className="rounded-xl border border-line bg-paper px-5 py-6 sm:px-8">
          {article.partial ? (
            <p className="text-xs tracking-wide text-muted uppercase">Partial article</p>
          ) : null}
          <h2 className="mt-2 font-serif text-3xl leading-tight text-ink">
            {article.title || "Untitled"}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {article.author || "Unknown author"}
            {article.published ? ` · ${article.published}` : ""}
          </p>
          <div className="mt-6 space-y-4 font-serif text-lg leading-relaxed text-ink">
            {article.text.split(/\n\s*\n/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </article>
      ) : null}
    </main>
  );
}
