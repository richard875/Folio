import { hashMatches } from "../../../reader/auth.ts";
import { jobManager, validCallId, type JobManager, type SaveBatchTask, type SaveBatchJob } from "./jobs.ts";

const headers = { "cache-control": "no-store" };

export interface SaveBatchRequestItem {
  url: string;
  website?: string;
  section?: string;
  callId?: string;
}

export interface SaveBatchStartResponse {
  callId: string;
  status: "in progress" | "completed" | "partial" | "error";
  phase: "saving articles" | "finished";
  total: number;
  processed: number;
  saved: number;
  failed: number;
  active: number;
  statusEndpoint: string;
}

export interface SaveBatchStatusResponse {
  callId: string;
  status: "in progress" | "completed" | "partial" | "error";
  phase: "saving articles" | "finished";
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  concurrency: number;
  total: number;
  processed: number;
  saved: number;
  failed: number;
  active: number;
  error: string | null;
  results: (SaveBatchTask & {
    status: "saved" | "failed";
    savedFile?: string;
    partial?: boolean;
    error?: string;
  })[];
}

export async function handleSaveBatchRequest(
  request: Request,
  manager: Pick<JobManager, "startSaveBatch" | "get"> = jobManager,
): Promise<Response> {
  const url = new URL(request.url);
  const hash = url.searchParams.get("hash");
  if (!hashMatches(hash)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed. Use POST." }, { status: 405, headers });
  }

  let body: { urls: SaveBatchRequestItem[]; format?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400, headers });
  }

  const { urls, format = "markdown" } = body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return Response.json({ error: "urls array is required and must not be empty." }, { status: 400, headers });
  }
  if (urls.length > 100) {
    return Response.json({ error: "Maximum 100 URLs per request." }, { status: 400, headers });
  }
  if (!["markdown", "json"].includes(format.toLowerCase())) {
    return Response.json({ error: "Use format=markdown or format=json." }, { status: 400, headers });
  }

  // Normalize: accept either ["url1", "url2"] or [{url: "url1"}, {url: "url2", ...}]
  const normalizedUrls = urls.map((item) =>
    typeof item === "string" ? { url: item } : item
  );

  // Validate callIds if provided (format + existence)
  for (const item of normalizedUrls) {
    if (item.callId) {
      if (!validCallId(item.callId)) {
        return Response.json({ error: `Invalid callId: ${item.callId}` }, { status: 400, headers });
      }
      const job = await manager.get(item.callId);
      if (!job) {
        return Response.json({ error: `Call not found: ${item.callId}` }, { status: 404, headers });
      }
    }
  }

  // Convert to SaveBatchTask format
  const tasks: SaveBatchTask[] = normalizedUrls.map((item) => ({
    url: item.url,
    website: item.website ?? "",
    section: item.section ?? "",
    callId: item.callId,
  }));

  // Start the background job
  const job = await manager.startSaveBatch(tasks, hash!, format);
  if (!job) {
    return Response.json(
      { status: "error", error: "A collection or save-batch job is already running." },
      { status: 409, headers },
    );
  }

  return Response.json(
    {
      callId: job.callId,
      status: job.status,
      phase: job.phase,
      total: job.total,
      processed: job.processed,
      saved: job.saved,
      failed: job.failed,
      active: job.active,
      statusEndpoint: `/api/save-batch/status?callId=${job.callId}`,
    },
    { status: 202, headers },
  );
}

export async function handleSaveBatchStatus(
  request: Request,
  manager: Pick<JobManager, "get"> = jobManager,
): Promise<Response> {
  const url = new URL(request.url);
  const hash = url.searchParams.get("hash");
  if (!hashMatches(hash)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });

  const callId = url.searchParams.get("callId");
  if (!callId) {
    return Response.json(
      { status: "error", error: "callId is required." },
      { status: 400, headers },
    );
  }
  if (!validCallId(callId)) {
    return Response.json({ error: "Invalid callId." }, { status: 400, headers });
  }

  try {
    const job = await manager.get(callId);
    if (!job) return Response.json({ callId, status: "not found" }, { status: 404, headers });

    // Filter results to only include completed ones (not "pending")
    const results = job.results.filter((r) => r.status !== "failed" || r.error !== "pending");

    return Response.json(
      {
        callId: job.callId,
        status: job.status,
        phase: job.phase,
        startedAt: job.startedAt,
        updatedAt: job.updatedAt,
        finishedAt: job.finishedAt,
        concurrency: job.concurrency,
        total: job.total,
        processed: job.processed,
        saved: job.saved,
        failed: job.failed,
        active: job.active,
        error: job.error,
        results,
        queued: Math.max(0, job.total - job.processed - job.active),
      },
      { headers },
    );
  } catch {
    return Response.json(
      { callId, status: "error", error: "Unable to read save-batch progress." },
      { status: 500, headers },
    );
  }
}