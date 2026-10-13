import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isGoogleNewsArticle, resolveGoogleNewsUrl } from "../rss/google-news.ts";
import { publicFetch } from "../runtime/network.ts";
import { syncDirectory } from "../runtime/storage.ts";

export type ArticleTask = { website: string; section: string; url: string };
export type JobStatus = "in progress" | "completed" | "partial" | "error";
export type ArticleResultStatus = "saved" | "failed";
export type Job = {
  callId: string;
  status: JobStatus;
  phase: "collecting links" | "saving articles" | "finished";
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  concurrency: number;
  total: number;
  processed: number;
  saved: number;
  failed: number;
  active: number;
  failedFeeds: number;
  linksFile: string | null;
  error: string | null;
  results: (ArticleTask & {
    status: ArticleResultStatus;
    savedFile?: string;
    partial?: boolean;
    error?: string;
  })[];
};

export function validCallId(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}

export function saveConcurrency(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value.trim())) return 5;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 10 ? number : 5;
}

/** Read only the generated report's website/section headings and article links. */
export function parseLinksFile(markdown: string): ArticleTask[] {
  let website = "";
  let section = "";
  const tasks: ArticleTask[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const siteMatch = /^# (.+)$/.exec(line);
    if (siteMatch) {
      website = siteMatch[1].replace(/\\(.)/g, "$1");
      section = "";
      continue;
    }
    const sectionMatch = /^## (.+)$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].replace(/\\(.)/g, "$1");
      continue;
    }
    const link = /^- <(https?:\/\/[^<>]+)>$/.exec(line);
    if (!link || !website || !section) continue;
    const url = new URL(link[1]);
    if (url.username || url.password) continue;
    const key = JSON.stringify([website, section, url.href]);
    if (!seen.has(key)) {
      seen.add(key);
      tasks.push({ website, section, url: url.href });
    }
  }
  return tasks;
}

type ManagerOptions = {
  root?: string;
  fetchImpl?: typeof fetch;
  internalBase?: () => string;
  wait?: (milliseconds: number) => Promise<unknown>;
  timeoutMs?: number;
};

export class JobManager {
  private readonly root: string;
  private readonly fetchImpl: typeof fetch;
  private readonly internalBase: () => string;
  private readonly wait: (milliseconds: number) => Promise<unknown>;
  private readonly timeoutMs: number;
  private readonly jobs = new Map<string, Job>();
  private running: string | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly googleUrls = new Map<string, Promise<string>>();

  get isRunning(): boolean { return this.running !== null; }

  constructor(options: ManagerOptions = {}) {
    this.root = resolve(options.root ?? process.cwd());
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.wait = options.wait ?? sleep;
    this.timeoutMs = options.timeoutMs ?? 3_600_000;
    // Never derive internal destinations from client-supplied Host headers.
    this.internalBase =
      options.internalBase ??
      (() => {
        const port =
          process.env.NITRO_PORT ||
          process.env.PORT ||
          (process.env.NODE_ENV === "production" ? "3000" : "8080");
        return `http://127.0.0.1:${port}`;
      });
  }

  private persist(job: Job): Promise<unknown> {
    const content = `${JSON.stringify(job, null, 2)}\n`;
    const dir = resolve(this.root, "output/jobs");
    const path = resolve(dir, `${job.callId}.json`);
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(dir, { recursive: true });
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporary, "wx", 0o600);
          try { await handle.writeFile(content); await handle.sync(); }
          finally { await handle.close(); }
          await rename(temporary, path);
          await syncDirectory(dir);
        } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
      });
    return this.writes;
  }

  private async update(job: Job) {
    job.updatedAt = new Date().toISOString();
    await this.persist(job);
  }

  async start(hash: string, format = "markdown"): Promise<Job | null> {
    if (this.running) return null;
    const callId = randomUUID();
    this.running = callId;
    const timestamp = new Date().toISOString();
    const job: Job = {
      callId,
      status: "in progress",
      phase: "collecting links",
      startedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
      concurrency: saveConcurrency(process.env.SAVE_CONCURRENCY),
      total: 0,
      processed: 0,
      saved: 0,
      failed: 0,
      active: 0,
      failedFeeds: 0,
      linksFile: null,
      error: null,
      results: [],
    };
    try {
      await this.persist(job);
      this.jobs.set(callId, job);
    } catch (error) {
      this.running = null;
      this.googleUrls.clear();
      throw error;
    }
    // Scheduling the work after returning prevents RSS or article requests from
    // delaying the 202 response. The secret lives only in this task's memory.
    setImmediate(() => {
      void this.run(job, hash, format);
    });
    return structuredClone(job);
  }

  async get(callId: string): Promise<Job | null> {
    if (!validCallId(callId)) return null;
    const current = this.jobs.get(callId);
    if (current) {
      // A terminal in-memory status must not race its final disk publication.
      // Otherwise readers can report completion while the agent still sees an
      // unfinished folder, or restart recovery can mistake that record for stale work.
      if (current.status !== "in progress") await this.writes.catch(() => {});
      return structuredClone(current);
    }
    let job: Job;
    try {
      job = JSON.parse(
        await readFile(resolve(this.root, "output/jobs", `${callId}.json`), "utf8"),
      ) as Job;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (job.status === "in progress") {
      job.status = "error";
      job.phase = "finished";
      job.active = 0;
      job.error = "The server restarted before this operation finished. Start a new collection.";
      job.finishedAt = new Date().toISOString();
      await this.update(job);
    }
    return job;
  }

  private async run(job: Job, hash: string, format: string): Promise<void> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    try {
      const query = new URLSearchParams({ hash, format: "json" });
      const response = await this.fetchImpl(`${this.internalBase()}/api/links?${query}`, {
        method: "POST",
        signal: AbortSignal.any([deadline, AbortSignal.timeout(600_000)]),
      });
      const report = (await response.json()) as { savedFile?: string; failedFeedCount?: number };
      if (
        report.savedFile &&
        /^output\/links\/links_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/.test(report.savedFile)
      ) {
        job.linksFile = report.savedFile;
      }
      job.failedFeeds = report.failedFeedCount ?? 0;
      if (!response.ok || !job.linksFile) throw new Error("Unable to collect article links.");
      const tasks = parseLinksFile(await readFile(resolve(this.root, job.linksFile), "utf8"));
      job.total = tasks.length;
      job.phase = "saving articles";
      await this.update(job);
      let next = 0;
      const workers = await Promise.allSettled(
        Array.from({ length: Math.min(job.concurrency, tasks.length) }, async () => {
          while (next < tasks.length && !deadline.aborted) {
            const task = tasks[next++];
            job.active++;
            try {
              await this.update(job);
              const result = await this.saveTask(job.callId, task, hash, format, deadline);
              job.results.push({ ...task, ...result });
              if (result.status === "saved") job.saved++;
              else job.failed++;
            } finally {
              job.active--;
              job.processed++;
              await this.update(job);
            }
          }
        }),
      );
      if (workers.some((worker) => worker.status === "rejected"))
        throw new Error("Unable to persist progress.");
      deadline.throwIfAborted();
      if (job.saved === 0 && job.failed > 0) {
        job.status = "error";
        job.error = "No articles could be saved. See the results for details.";
      } else if (job.failed > 0 || job.failedFeeds > 0) {
        job.status = "partial";
        job.error = null;
      } else {
        job.status = "completed";
        job.error = null;
      }
    } catch {
      job.status = "error";
      job.error = "The operation could not finish. Any articles already saved are retained.";
    } finally {
      job.phase = "finished";
      job.finishedAt = new Date().toISOString();
      // All worker promises must settle before this operation releases its lock.
      job.active = 0;
      try {
        await this.update(job);
        this.jobs.delete(job.callId);
      } catch {
        /* Keep error status queryable in memory if the disk fails. */
        console.warn(JSON.stringify({ event: "job_persistence_failed", callId: job.callId }));
        if (this.jobs.size > 1) this.jobs.delete(this.jobs.keys().next().value!);
      }
      this.running = null;
      // Bound memory retention; older statuses remain available on disk.
      console.info(JSON.stringify({ event: "collection_finished", callId: job.callId, status: job.status, saved: job.saved, failed: job.failed, failedFeeds: job.failedFeeds }));
      this.googleUrls.clear();
    }
  }

  private async saveTask(callId: string, task: ArticleTask, hash: string, format: string, deadline: AbortSignal) {
    let articleUrl = task.url;
    if (isGoogleNewsArticle(task.url)) {
      let resolved = this.googleUrls.get(task.url);
      if (!resolved) {
        const transport = this.fetchImpl === fetch ? publicFetch : this.fetchImpl;
        resolved = resolveGoogleNewsUrl(task.url, (input, init) => transport(input, {
          ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
        }));
        this.googleUrls.set(task.url, resolved);
      }
      try {
        articleUrl = await resolved;
      } catch {
        return {
          status: "failed" as const,
          error: "Unable to resolve this article's publisher URL.",
        };
      }
    }
    try {
      const query = new URLSearchParams({
        url: articleUrl,
        hash,
        website: task.website,
        section: task.section,
        callId,
        format,
      });
      for (let rateRetries = 0; ; rateRetries++) {
        deadline.throwIfAborted();
        const response = await this.fetchImpl(`${this.internalBase()}/api/save?${query}`, {
          method: "GET",
          signal: AbortSignal.any([deadline, AbortSignal.timeout(180_000)]),
        });
        if (response.status === 429 && rateRetries < 10) {
          const seconds = Number(response.headers.get("retry-after") || 60);
          await response.body?.cancel();
          await this.wait(
            Math.max(1, Math.min(Number.isFinite(seconds) ? seconds : 60, 120)) * 1000,
          );
          continue;
        }
        const savedFile = response.headers.get("x-saved-file");
        await response.body?.cancel();
        if (response.ok && savedFile)
          return {
            status: "saved" as const,
            url: articleUrl,
            savedFile,
            partial: response.status === 206,
          };
        // Log the actual error from save API for debugging
        const errorText = await response.text().catch(() => "");
        console.error("[job] save failed:", { url: articleUrl, status: response.status, statusText: response.statusText, error: errorText });
        return { status: "failed" as const, error: `Save failed (${response.status}): ${errorText || "Unable to save this article."}` };
      }
    } catch (error) {
      console.error("[job] save exception:", { url: articleUrl, error: error instanceof Error ? error.message : error });
      return { status: "failed" as const, error: error instanceof Error ? error.message : "Unable to save this article." };
    }
  }
}

export const jobManager = new JobManager();
