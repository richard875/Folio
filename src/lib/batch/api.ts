import { hashMatches } from "../reader/auth.ts";
import { jobManager, type JobManager } from "./jobs.ts";

const headers = { "cache-control": "no-store" };

export async function handleCollectRequest(
  request: Request,
  manager: Pick<JobManager, "start"> = jobManager,
): Promise<Response> {
  const url = new URL(request.url);
  const hash = url.searchParams.get("hash");
  if (!hashMatches(hash)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const format = (url.searchParams.get("format") || "markdown").toLowerCase();
  if (!["markdown", "json"].includes(format))
    return Response.json(
      { status: "error", error: "Use format=markdown or format=json." },
      { status: 400, headers },
    );
  try {
    const job = await manager.start(hash!, format);
    if (!job)
      return Response.json(
        { status: "error", error: "A collection is already running." },
        { status: 409, headers },
      );
    return Response.json(
      {
        callId: job.callId,
        status: job.status,
        phase: job.phase,
        concurrency: job.concurrency,
        statusEndpoint: `/api/collect/status?callId=${job.callId}`,
      },
      { status: 202, headers },
    );
  } catch {
    return Response.json(
      { status: "error", error: "Unable to start the collection." },
      { status: 500, headers },
    );
  }
}

export async function handleCollectStatus(
  request: Request,
  manager: Pick<JobManager, "get"> = jobManager,
): Promise<Response> {
  const url = new URL(request.url);
  if (!hashMatches(url.searchParams.get("hash")))
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const callId = url.searchParams.get("callId");
  if (!callId)
    return Response.json(
      { status: "error", error: "callId is required." },
      { status: 400, headers },
    );
  try {
    const job = await manager.get(callId);
    if (!job) return Response.json({ callId, status: "not found" }, { status: 404, headers });
    return Response.json(
      { ...job, queued: Math.max(0, job.total - job.processed - job.active) },
      { headers },
    );
  } catch {
    return Response.json(
      { callId, status: "error", error: "Unable to read collection progress." },
      { status: 500, headers },
    );
  }
}
