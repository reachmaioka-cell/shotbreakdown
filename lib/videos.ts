import { createAdminClient } from "@/lib/supabase/admin";
import { planLimits } from "@/lib/plans";

export type VideoStatus =
  | "queued"
  | "processing"
  | "detecting_shots"
  | "extracting_frames"
  | "analyzing"
  | "indexing"
  | "complete"
  | "failed"
  | "canceled";

export const ACTIVE_VIDEO_STATUSES: VideoStatus[] = [
  "queued",
  "processing",
  "detecting_shots",
  "extracting_frames",
  "analyzing",
  "indexing",
];

export function isActiveStatus(status: string): boolean {
  return ACTIVE_VIDEO_STATUSES.includes(status as VideoStatus);
}

/** Copy shown to the user for each pipeline stage. Real stages, not a fake bar. */
export const STAGE_LABELS: Record<VideoStatus, string> = {
  queued: "Queued",
  processing: "Starting",
  detecting_shots: "Detecting shots",
  extracting_frames: "Extracting frames",
  analyzing: "Analyzing cinematography",
  indexing: "Indexing",
  complete: "Complete",
  failed: "Failed",
  canceled: "Canceled",
};

/**
 * Monthly video allowance. Counted from the videos table rather than a
 * denormalised counter so it cannot drift from reality.
 */
export async function monthlyVideoUsage(
  userId: string,
  plan: string | null
): Promise<{ used: number; limit: number; remaining: number }> {
  const admin = createAdminClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const { count } = await admin
    .from("videos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "failed")
    .gte("created_at", since.toISOString());

  const limit = planLimits(plan).videosPerMonth;
  const used = count ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used) };
}
