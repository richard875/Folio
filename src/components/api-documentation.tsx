import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, X } from "lucide-react";

export function ApiDocumentation({ accessHash = "" }: { accessHash?: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm font-medium text-ink hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent"
        >
          <BookOpen className="size-4 text-accent" aria-hidden="true" />
          API documentation
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 overflow-y-auto bg-ink/40 p-4 sm:p-6">
          <Dialog.Content className="mx-auto my-4 w-full max-w-3xl rounded-xl border border-line bg-paper p-5 shadow-xl outline-none sm:my-8 sm:p-8">
            <div className="mb-6 flex items-start justify-between gap-4 border-b border-line pb-4">
              <div>
                <Dialog.Title className="font-serif text-2xl font-medium text-ink">
                  API documentation
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted">
                  Read, save, and collect articles using your access key.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close API documentation"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <div className="space-y-6 text-sm leading-relaxed text-muted">
              <p className="rounded-lg border border-line bg-bg p-3 text-ink">
                Render Free uses temporary storage. Saved articles, reports, imported history,
                and job statuses disappear on sleep, restart, or redeployment. Keep important
                output in a separate archive.
              </p>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-ink">Swagger UI</h3>
                <p>
                  Interactive documentation is available at{" "}
                  <code className="break-all text-ink">/api/docs?hash=YOUR_ACCESS_HASH</code>. The
                  OpenAPI specification is at <code className="text-ink">/api/openapi</code> and
                  also requires your hash. “Try it out” can create files or start jobs.
                </p>
                {accessHash ? (
                  <a
                    href={`/api/docs?hash=${encodeURIComponent(accessHash)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center rounded-lg border border-line bg-bg px-3 font-medium text-ink hover:bg-paper"
                  >
                    Open Swagger UI
                  </a>
                ) : (
                  <p>Enter your access key on the reader page to enable the Swagger link.</p>
                )}
              </section>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-ink">Read an article</h3>
                <p>
                  API: <code className="break-all text-ink">GET /api/read?url=…&hash=…</code>. Add{" "}
                  <code className="text-ink">format=json</code> for JSON, or omit it for Markdown. A
                  short result comes back as HTTP 206.
                </p>
              </section>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-ink">Save an article</h3>
                <p>
                  Save API: <code className="break-all text-ink">GET /api/save?url=…&hash=…</code>.
                  Returns the article and saves it as Markdown. Add{" "}
                  <code className="text-ink">format=json</code> to save and return JSON. A short
                  result comes back as HTTP 206.
                </p>
                <p>
                  Files are saved to{" "}
                  <code className="break-all text-ink">
                    output/articles/YYYY-MM-DD_HH-mm/website_section_first_5_title_words_HH-mm-ss.md
                  </code>{" "}
                  (or <code className="text-ink">.json</code>). Timestamps use UTC and the 24-hour
                  clock. Folders are created automatically; existing files are never overwritten.
                  Batch saves all use the folder for the job's start date, hour and minute;
                  standalone saves use the current time.
                </p>
                <p>
                  Website and section names are inferred from the article URL. Add{" "}
                  <code className="text-ink">section=Markets</code> or{" "}
                  <code className="text-ink">website=Reuters</code> to override them. The{" "}
                  <code className="text-ink">X-Saved-File</code> response header provides the saved
                  path. Saving requires a writable server filesystem.
                </p>
              </section>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-ink">Collect RSS links</h3>
                <p>
                  Links API: <code className="break-all text-ink">GET /api/links?hash=…</code>.
                  Collects article links from RSS and news sitemaps, filters media/non-articles
                  before the limit, and saves a timestamped Markdown file in{" "}
                  <code className="text-ink">output/links</code>. Add{" "}
                  <code className="text-ink">format=json</code> for grouped links and a saved-file
                  summary. The default is 5 links per subsection; change{" "}
                  <code className="break-all text-ink">RSS_LINKS_PER_SECTION</code> in your server
                  environment. Collection runs on demand and may take several minutes. Only one
                  collection runs at a time. Curated feeds preserve editor order; other sources use
                  publication time and cross-publisher coverage to estimate priority.
                </p>
              </section>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-ink">Background collection</h3>
                <p>
                  <code className="break-all text-ink">POST /api/collect?hash=…</code> (or GET).
                  Returns HTTP 202 with a <code className="text-ink">callId</code> immediately, then
                  collects links and saves their articles in the background. The default is 5
                  parallel saves; set <code className="text-ink">SAVE_CONCURRENCY</code> in your
                  server environment to change it. Add <code className="text-ink">format=json</code>{" "}
                  to save articles as JSON.
                </p>
              </section>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-ink">Check progress</h3>
                <p>
                  <code className="break-all text-ink">
                    GET /api/collect/status?callId=…&hash=…
                  </code>
                  . Returns saved/failed counts and a status of completed, in progress, not found,
                  or error. Poll externally while a job is active. Interrupted jobs are marked
                  as errors only if their temporary records survive; after storage loss, status
                  returns not found. Start a new collection explicitly.
                </p>
              </section>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-ink">External AI agent</h3>
                <p>
                  Start at <code className="break-all text-ink">GET /api/agent/latest</code> with{" "}
                  <code className="break-all text-ink">Authorization: Bearer YOUR_ACCESS_HASH</code>{" "}
                  (or add your hash query parameter). It lists every article in the latest finished
                  folder and supplies reading instructions. Follow each article's read URL and all
                  subsequent chunks until the end marker, then verify its checksum.
                </p>
                <p>
                  Folder snapshots prevent mixing old and new collections. Running collections are
                  excluded; failed saves and partial articles are reported. Only claim completion
                  when every listed file has been fully retrieved and verified.
                </p>
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
