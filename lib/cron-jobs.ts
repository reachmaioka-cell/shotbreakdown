import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { MODEL } from "@/lib/constants";
import { distillVerifiedBreakdowns, ingestLearnArticles } from "@/lib/knowledge";
import { runLearningWorker } from "@/lib/learning/worker";

/**
 * Recover videos whose pipeline stopped without reaching a terminal state.
 * Stalled jobs are returned to the queue by reclaim_stalled_jobs; this catches
 * the rarer case where the video row is stuck with no live job at all.
 */
export async function sweepStuckVideos(staleMinutes = 30) {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

  const { data: stuck } = await admin
    .from("videos")
    .select("id, user_id, status, updated_at")
    .in("status", ["queued", "processing", "detecting_shots", "extracting_frames", "analyzing", "indexing"])
    .lt("updated_at", cutoff)
    .limit(20);

  const requeued: string[] = [];
  for (const video of stuck ?? []) {
    const { count } = await admin
      .from("processing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("video_id", video.id)
      .in("status", ["pending", "running"]);

    if ((count ?? 0) > 0) continue;

    const { enqueueJob } = await import("@/lib/pipeline/queue");
    const id = await enqueueJob(
      "ingest_video",
      { videoId: video.id },
      { videoId: video.id as string, userId: video.user_id as string | null, dedupeKey: `ingest:${video.id}` }
    ).catch(() => null);
    if (id) requeued.push(video.id as string);
  }

  return requeued;
}

/**
 * Recover segments whose ANALYSIS finished but whose breakdown never arrived.
 *
 * sweepStuckVideos only looks at videos still in a processing status, so a
 * segment that reached `complete` with breakdown_status stuck at 'pending' —
 * the enqueue was dropped, or a worker died between claiming the job and the
 * failure hook running — is invisible to it. The breakdown is the product, so a
 * segment sitting without one is the worst state to leave a user in silently.
 *
 * A terminal failure sets breakdown_status to 'failed' and is not swept: that
 * one is the owner's to retry, and re-running it automatically would spend
 * against a cause that has not changed.
 */
export async function sweepStuckBreakdowns(staleMinutes = 30) {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

  const { data: stuck } = await admin
    .from("videos")
    .select("id, user_id")
    .eq("status", "complete")
    .eq("breakdown_status", "pending")
    .lt("updated_at", cutoff)
    .limit(20);

  const requeued: string[] = [];
  for (const video of stuck ?? []) {
    const { count } = await admin
      .from("processing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("video_id", video.id)
      .eq("job_type", "generate_segment_breakdown")
      .in("status", ["pending", "running"]);

    // A live job is already carrying this one; leave it alone.
    if ((count ?? 0) > 0) continue;

    // There must be something to break down. A segment whose every shot failed
    // has nothing to say, and re-queueing it would fail forever.
    const { count: shots } = await admin
      .from("shots")
      .select("id", { count: "exact", head: true })
      .eq("video_id", video.id)
      .eq("status", "complete");
    if ((shots ?? 0) === 0) continue;

    const { enqueueJob } = await import("@/lib/pipeline/queue");
    const id = await enqueueJob(
      "generate_segment_breakdown",
      { videoId: video.id },
      {
        videoId: video.id as string,
        userId: video.user_id as string | null,
        dedupeKey: `segment-breakdown:${video.id}`,
        priority: 3,
      }
    ).catch(() => null);
    if (id) requeued.push(video.id as string);
  }

  return requeued;
}

export async function writePromptInsights(): Promise<{ skipped?: boolean; ok?: boolean }> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: corrections }, { data: ratings }, { data: shotCorrections }] = await Promise.all([
    admin
      .from("breakdown_feedback")
      .select("field_key, original_value, corrected_value, comment, created_at")
      .not("field_key", "is", null)
      .gte("created_at", since)
      .limit(300),
    admin
      .from("breakdown_feedback")
      .select("rating, comment, created_at")
      .not("rating", "is", null)
      .gte("created_at", since)
      .limit(200),
    // Corrections on the shot model — where the loop is fed from now.
    admin.rpc("shot_correction_stats", { p_since: since }),
  ]);

  if (!corrections?.length && !ratings?.length && !shotCorrections?.length) {
    return { skipped: true };
  }

  const lowRatings = (ratings ?? []).filter((r) => (r.rating as number) <= 2);
  const highRatings = (ratings ?? []).filter((r) => (r.rating as number) >= 4);
  const comments = (ratings ?? []).filter((r) => r.comment).map((r) => r.comment);

  const payload = {
    shotFieldCorrections: shotCorrections ?? [],
    legacyFieldCorrections: corrections ?? [],
    lowRatings,
    highRatingCount: highRatings.length,
    comments: comments.slice(0, 30),
  };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are improving a cinematography-analysis prompt. Here is feedback from the last 30 days: per-field corrections users made to the AI output (shotFieldCorrections shows the field, how often it was corrected, and sample from/to values), plus low ratings and comments. Summarize the 5 most common ways the AI was wrong and the specific instruction change that would fix each. Be concrete about which field and which direction the error goes. Plain sentences. No preamble.\n\n${JSON.stringify(payload).slice(0, 80000)}`,
      },
    ],
  });

  const summary = message.content[0]?.type === "text" ? message.content[0].text : "";
  if (!summary) throw new Error("Empty summary");

  const { error: insertError } = await admin.from("prompt_insights").insert({ summary });
  if (insertError) throw insertError;
  return { ok: true };
}

export async function refreshKnowledgeBase(): Promise<{ learn: number; verified: number }> {
  const learn = await ingestLearnArticles();
  const verified = await distillVerifiedBreakdowns(15);
  return { learn: learn.upserted, verified: verified.upserted };
}

/** Run one learning worker batch (used by daily cron as backup). */
export async function runLearningTick(batchSize = 10) {
  return runLearningWorker(batchSize);
}
