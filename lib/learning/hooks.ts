import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueLearningJob } from "@/lib/learning/queue";

/**
 * After an editor publishes a shot: distil it into the knowledge corpus and
 * warm research on its source, so the next analysis of similar material has
 * better context. This is the loop that makes the library compound.
 */
export async function queueVerifiedLearning(shotId: string): Promise<void> {
  await enqueueLearningJob(
    "distill_shot",
    { shotId },
    { dedupeKey: `distill-shot:${shotId}`, priority: 10 }
  );

  const admin = createAdminClient();
  const { data } = await admin
    .from("shots")
    .select("videos ( source_url, source_type, title )")
    .eq("id", shotId)
    .maybeSingle();

  const video = Array.isArray(data?.videos) ? data?.videos[0] : data?.videos;
  if (video?.source_url) {
    await enqueueLearningJob(
      "warm_research",
      {
        sourceUrl: video.source_url,
        sourceType: video.source_type,
        title: video.title,
      },
      { dedupeKey: `warm:${video.source_url}`, priority: 8 }
    );
  }
}

/** After owner edits a field — re-embed, re-distill, and refresh corrections. */
export async function queueEditLearning(submissionId: string): Promise<void> {
  await enqueueLearningJob(
    "reembed_submission",
    { submissionId },
    { dedupeKey: `reembed:${submissionId}`, priority: 7, delayMs: 5_000 }
  );
  await enqueueLearningJob(
    "distill_submission",
    { submissionId },
    { dedupeKey: `distill:${submissionId}`, priority: 8, delayMs: 10_000 }
  );
  await enqueueLearningJob(
    "distill_corrections",
    { limit: 30 },
    { dedupeKey: "distill:corrections:batch", priority: 6, delayMs: 30_000 }
  );
}

/** After feedback — corrections feed the correction corpus; high ratings trigger insights. */
export async function queueFeedbackLearning(
  submissionId: string,
  options: { hasCorrection?: boolean; rating?: number | null }
): Promise<void> {
  if (options.hasCorrection) {
    await enqueueLearningJob(
      "distill_corrections",
      { limit: 30 },
      { dedupeKey: "distill:corrections:batch", priority: 6, delayMs: 60_000 }
    );
    await enqueueLearningJob(
      "distill_submission",
      { submissionId },
      { dedupeKey: `distill:${submissionId}`, priority: 7, delayMs: 30_000 }
    );
  }

  if (options.rating != null && options.rating >= 4) {
    await enqueueLearningJob(
      "prompt_insights",
      {},
      { dedupeKey: "recurring:insights", priority: 5, delayMs: 120_000 }
    );
  }

  if (options.rating != null && options.rating <= 2) {
    await enqueueLearningJob(
      "prompt_insights",
      {},
      { dedupeKey: "recurring:insights:low", priority: 6, delayMs: 60_000 }
    );
  }
}
