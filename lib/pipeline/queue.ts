import { createAdminClient } from "@/lib/supabase/admin";

export type ProcessingJobType =
  | "ingest_video"
  | "analyze_shots"
  | "finalize_video"
  | "reanalyze_shot"
  | "generate_recreation_guide"
  | "generate_segment_breakdown"
  | "generate_ai_recreation";

export type ProcessingJob = {
  id: string;
  video_id: string | null;
  user_id: string | null;
  job_type: ProcessingJobType;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed" | "canceled";
  attempts: number;
  max_attempts: number;
  error_message: string | null;
};

export type EnqueueOptions = {
  priority?: number;
  dedupeKey?: string;
  delayMs?: number;
  maxAttempts?: number;
};

/**
 * Enqueue a job. `dedupeKey` is enforced by a partial unique index over active
 * rows, so a double-submit cannot create two pipelines for the same video even
 * if both requests race.
 */
export async function enqueueJob(
  jobType: ProcessingJobType,
  payload: Record<string, unknown>,
  options: EnqueueOptions & { videoId?: string | null; userId?: string | null } = {}
): Promise<string | null> {
  const admin = createAdminClient();
  const row: Record<string, unknown> = {
    job_type: jobType,
    payload,
    video_id: options.videoId ?? null,
    user_id: options.userId ?? null,
    priority: options.priority ?? 0,
    dedupe_key: options.dedupeKey ?? null,
    max_attempts: options.maxAttempts ?? 3,
    status: "pending" as const,
  };
  // Only set scheduled_at for a real delay. Letting the column default to the
  // database's now() keeps the queue on one clock: an app server running even
  // 50ms ahead would otherwise schedule "immediate" jobs into the future and
  // they would be skipped by the claim query.
  if (options.delayMs && options.delayMs > 0) {
    row.scheduled_at = new Date(Date.now() + options.delayMs).toISOString();
  }

  const { data, error } = await admin
    .from("processing_jobs")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = the dedupe index rejected a duplicate active job. That is the
    // intended outcome, not a failure.
    if (error.code === "23505") return null;
    throw new Error(`Could not queue ${jobType}: ${error.message}`);
  }
  return data?.id ?? null;
}

export async function claimJobs(batchSize = 2): Promise<ProcessingJob[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_processing_jobs", { batch_size: batchSize });
  if (error) throw new Error(`claim_processing_jobs: ${error.message}`);
  return (data ?? []) as ProcessingJob[];
}

export async function heartbeat(jobId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("processing_jobs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", jobId);
}

export async function completeJob(
  jobId: string,
  result: Record<string, unknown> = {}
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("processing_jobs")
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      result,
      error_message: null,
    })
    .eq("id", jobId);
}

/**
 * Fail a job. Retryable failures go back to pending with exponential backoff
 * until max_attempts; terminal failures stop immediately so a bad input does
 * not burn the retry budget.
 */
export async function failJob(
  job: ProcessingJob,
  message: string,
  options: { retryable?: boolean } = {}
): Promise<{ terminal: boolean }> {
  const admin = createAdminClient();
  const retryable = options.retryable ?? true;
  const terminal = !retryable || job.attempts >= job.max_attempts;
  const backoffMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, job.attempts - 1));

  await admin
    .from("processing_jobs")
    .update({
      status: terminal ? "failed" : "pending",
      error_message: message.slice(0, 800),
      scheduled_at: terminal ? undefined : new Date(Date.now() + backoffMs).toISOString(),
      started_at: null,
      completed_at: terminal ? new Date().toISOString() : null,
    })
    .eq("id", job.id);

  return { terminal };
}

export async function reclaimStalledJobs(staleSeconds = 600): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reclaim_stalled_jobs", {
    p_stale_seconds: staleSeconds,
  });
  if (error) {
    console.error("reclaim_stalled_jobs", error.message);
    return 0;
  }
  return (data as number) ?? 0;
}

export async function findActiveJob(dedupeKey: string): Promise<ProcessingJob | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("processing_jobs")
    .select("id, video_id, user_id, job_type, payload, status, attempts, max_attempts, error_message")
    .eq("dedupe_key", dedupeKey)
    .in("status", ["pending", "running"])
    .maybeSingle();
  if (error) throw new Error(`findActiveJob: ${error.message}`);
  return (data as ProcessingJob | null) ?? null;
}

export async function pendingJobCount(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("processing_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

/**
 * Work that has not finished: pending (including scheduled for later) plus
 * anything another worker is currently running. A drain loop needs this to tell
 * "the queue is empty" from "someone else holds the job I would have taken".
 */
export async function activeJobCount(videoId?: string): Promise<number> {
  const admin = createAdminClient();
  let query = admin
    .from("processing_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "running"]);
  if (videoId) query = query.eq("video_id", videoId);
  const { count } = await query;
  return count ?? 0;
}
