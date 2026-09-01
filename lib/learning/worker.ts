import { claimLearningJobs, completeLearningJob, failLearningJob, pendingJobCount } from "@/lib/learning/queue";
import { runLearningJob, seedAllCurriculum, seedRecurringLearningJobs } from "@/lib/learning/jobs";
import type { LearningJob } from "@/lib/learning/types";

export type LearningWorkerResult = {
  seeded: number;
  claimed: number;
  completed: number;
  failed: number;
  pending: number;
  jobs: { id: string; type: string; ok: boolean; error?: string }[];
};

export async function runLearningWorker(batchSize = 8): Promise<LearningWorkerResult> {
  let seeded = await seedRecurringLearningJobs();

  let pending = await pendingJobCount();
  if (pending < 12) {
    seeded += await seedAllCurriculum(4);
    pending = await pendingJobCount();
  }

  const jobs = await claimLearningJobs(batchSize);

  const results: LearningWorkerResult = {
    seeded,
    claimed: jobs.length,
    completed: 0,
    failed: 0,
    pending: 0,
    jobs: [],
  };

  for (const job of jobs) {
    try {
      const outcome = await runLearningJob(job as LearningJob);
      if (outcome.ok) {
        await completeLearningJob(job.id, outcome.detail ?? {});
        results.completed += 1;
        results.jobs.push({ id: job.id, type: job.job_type, ok: true });
      } else {
        await failLearningJob(job.id, outcome.error ?? "failed");
        results.failed += 1;
        results.jobs.push({ id: job.id, type: job.job_type, ok: false, error: outcome.error });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "job crashed";
      console.error(`learning job ${job.job_type} (${job.id})`, message);
      await failLearningJob(job.id, message);
      results.failed += 1;
      results.jobs.push({ id: job.id, type: job.job_type, ok: false, error: message });
    }
  }

  results.pending = await pendingJobCount();
  return results;
}

/** Fire-and-forget: queue learning from a freshly analyzed submission. */
export async function queueSubmissionLearning(submissionId: string, source?: {
  sourceUrl?: string | null;
  sourceType?: string | null;
  title?: string | null;
}) {
  const { enqueueLearningJob } = await import("@/lib/learning/queue");
  await enqueueLearningJob(
    "distill_submission",
    { submissionId },
    { dedupeKey: `distill:${submissionId}`, priority: 7 }
  );
  if (source?.sourceUrl) {
    await enqueueLearningJob(
      "warm_research",
      {
        sourceUrl: source.sourceUrl,
        sourceType: source.sourceType ?? null,
        title: source.title ?? null,
      },
      { dedupeKey: `warm:${source.sourceUrl}`, priority: 5 }
    );
  }
}
