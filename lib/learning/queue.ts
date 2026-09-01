import { createAdminClient } from "@/lib/supabase/admin";
import type { LearningJob, LearningJobType } from "@/lib/learning/types";

export async function enqueueLearningJob(
  jobType: LearningJobType,
  payload: Record<string, unknown> = {},
  options?: { priority?: number; dedupeKey?: string; delayMs?: number }
): Promise<string | null> {
  const admin = createAdminClient();

  const row: Record<string, unknown> = {
    job_type: jobType,
    payload,
    priority: options?.priority ?? 0,
    dedupe_key: options?.dedupeKey ?? null,
    status: "pending" as const,
  };
  // See lib/pipeline/queue.ts: only a real delay overrides the database clock.
  if (options?.delayMs && options.delayMs > 0) {
    row.scheduled_at = new Date(Date.now() + options.delayMs).toISOString();
  }

  if (options?.dedupeKey) {
    const { data: existing } = await admin
      .from("learning_jobs")
      .select("id")
      .eq("dedupe_key", options.dedupeKey)
      .in("status", ["pending", "running"])
      .maybeSingle();
    if (existing) return null;
  }

  const { data, error } = await admin.from("learning_jobs").insert(row).select("id").maybeSingle();

  if (error) {
    console.error("enqueueLearningJob", jobType, error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function claimLearningJobs(batchSize = 5): Promise<LearningJob[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_learning_jobs", { batch_size: batchSize });
  if (error) {
    console.error("claimLearningJobs", error.message);
    return [];
  }
  return (data ?? []) as LearningJob[];
}

export async function completeLearningJob(
  id: string,
  result: Record<string, unknown> = {}
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("learning_jobs")
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      result,
      error_message: null,
    })
    .eq("id", id);
}

export async function failLearningJob(id: string, message: string, retryMs = 60_000): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("learning_jobs")
    .select("attempts, max_attempts")
    .eq("id", id)
    .maybeSingle();

  const attempts = (data?.attempts as number) ?? 1;
  const maxAttempts = (data?.max_attempts as number) ?? 3;
  const failed = attempts >= maxAttempts;

  await admin
    .from("learning_jobs")
    .update({
      status: failed ? "failed" : "pending",
      error_message: message.slice(0, 500),
      scheduled_at: failed ? undefined : new Date(Date.now() + retryMs).toISOString(),
      started_at: null,
    })
    .eq("id", id);
}

export async function pendingJobCount(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("learning_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}
