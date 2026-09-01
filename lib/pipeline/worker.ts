import {
  activeJobCount,
  claimJobs,
  completeJob,
  failJob,
  reclaimStalledJobs,
  pendingJobCount,
  enqueueJob,
  type ProcessingJob,
} from "@/lib/pipeline/queue";
import {
  PipelineError,
  runAnalyzeShots,
  runFinalizeVideo,
  runGenerateRecreationGuide,
  runIngestVideo,
  runReanalyzeShot,
} from "@/lib/pipeline/stages";
import { reportError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export type WorkerReport = {
  claimed: number;
  done: number;
  failed: number;
  reclaimed: number;
  pending: number;
  details: { id: string; type: string; ok: boolean; error?: string }[];
};

async function runJob(job: ProcessingJob): Promise<Record<string, unknown>> {
  switch (job.job_type) {
    case "ingest_video":
      return runIngestVideo(job);
    case "analyze_shots":
      return runAnalyzeShots(job);
    case "finalize_video":
      return runFinalizeVideo(job);
    case "reanalyze_shot":
      return runReanalyzeShot(job);
    case "generate_recreation_guide":
      return runGenerateRecreationGuide(job);
    default:
      throw new PipelineError(`Unknown job type ${job.job_type}`, "unknown_job", false);
  }
}

/**
 * Mark a video failed when its pipeline gives up, so the user sees a terminal
 * state with a retry rather than an indefinite "processing".
 */
async function markVideoFailed(job: ProcessingJob, message: string, code: string): Promise<void> {
  if (!job.video_id) return;
  const admin = createAdminClient();
  await admin
    .from("videos")
    .update({
      status: "failed",
      error_message: message.slice(0, 500),
      error_code: code,
      stage_detail: null,
    })
    .eq("id", job.video_id)
    .not("status", "in", "(complete,canceled)");
}

export async function runWorkerTick(batchSize = 2): Promise<WorkerReport> {
  const reclaimed = await reclaimStalledJobs();
  const jobs = await claimJobs(batchSize);

  const report: WorkerReport = {
    claimed: jobs.length,
    done: 0,
    failed: 0,
    reclaimed,
    pending: 0,
    details: [],
  };

  for (const job of jobs) {
    try {
      const result = await runJob(job);
      await completeJob(job.id, result);
      report.done += 1;
      report.details.push({ id: job.id, type: job.job_type, ok: true });
    } catch (e) {
      const retryable = e instanceof PipelineError ? e.retryable : true;
      const code = e instanceof PipelineError ? e.code : "unexpected";
      const message = e instanceof Error ? e.message : "Job failed";
      const { terminal } = await failJob(job, message, { retryable });
      // A recreation-guide failure must not mark the video itself as failed.
      if (terminal && job.job_type !== "generate_recreation_guide") {
        await markVideoFailed(job, message, code);
      }
      report.failed += 1;
      report.details.push({ id: job.id, type: job.job_type, ok: false, error: message });
      reportError(e, { source: "processing_job", jobType: job.job_type, jobId: job.id });
    }
  }

  report.pending = await pendingJobCount();
  return report;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drain the queue until there is genuinely nothing left, or the budget runs out.
 *
 * Claiming nothing does not mean the queue is empty: another worker may hold the
 * job, or the next stage may be scheduled a few seconds out. Exiting on the
 * first empty claim would leave a half-processed video sitting until the next
 * cron tick, so the loop waits while work is still outstanding.
 */
export async function drainQueue(options: { maxMs?: number; batchSize?: number } = {}): Promise<{
  ticks: number;
  done: number;
  failed: number;
  remaining: number;
}> {
  const maxMs = options.maxMs ?? 240_000;
  const startedAt = Date.now();
  let ticks = 0;
  let done = 0;
  let failed = 0;
  let idleWaits = 0;

  for (;;) {
    if (Date.now() - startedAt > maxMs) break;

    const report = await runWorkerTick(options.batchSize ?? 2);
    ticks += 1;
    done += report.done;
    failed += report.failed;

    if (report.claimed > 0) {
      idleWaits = 0;
      continue;
    }

    const outstanding = await activeJobCount();
    if (outstanding === 0) break;
    // Give the holder of that job a moment, then look again.
    if (idleWaits >= 240) break;
    idleWaits += 1;
    await sleep(2000);
  }

  return { ticks, done, failed, remaining: await activeJobCount() };
}

/** Restart a video's pipeline from the beginning. Idempotent. */
export async function requeueVideo(videoId: string, userId: string | null): Promise<boolean> {
  const admin = createAdminClient();
  await admin
    .from("videos")
    .update({
      status: "queued",
      stage_detail: "Queued",
      progress: 0,
      error_message: null,
      error_code: null,
    })
    .eq("id", videoId);

  const id = await enqueueJob(
    "ingest_video",
    { videoId },
    { videoId, userId, dedupeKey: `ingest:${videoId}`, priority: 5 }
  );
  return id !== null;
}
