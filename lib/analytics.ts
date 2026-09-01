import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Product analytics. Deliberately narrow: an event name, a user id when we
 * already have one, and non-identifying properties. No IPs, no user agents, no
 * emails — nothing collected that the product does not use.
 */
export const ANALYTICS_EVENTS = [
  "signup",
  "onboarding_completed",
  "upload_started",
  "upload_completed",
  "processing_started",
  "processing_completed",
  "processing_failed",
  "video_viewed",
  "shot_viewed",
  "search_performed",
  "filter_used",
  "shot_saved",
  "shot_unsaved",
  "collection_created",
  "shot_added_to_collection",
  "shot_removed_from_collection",
  "sequence_created",
  "sequence_reordered",
  "find_similar_clicked",
  "representative_frame_changed",
  "metadata_corrected",
  "export_started",
  "export_completed",
  "share_created",
  "share_viewed",
  "video_deleted",
  "account_deleted",
  "upgrade_viewed",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export function isAnalyticsEvent(value: string): value is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(value);
}

/** Property values are clamped so an event cannot become a free-text sink. */
function sanitize(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(properties)) {
    if (count >= 20) break;
    if (value === null || value === undefined) continue;
    if (typeof value === "string") out[key] = value.slice(0, 300);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 20).map((v) => String(v).slice(0, 80));
    else continue;
    count += 1;
  }
  return out;
}

export async function track(
  event: AnalyticsEvent,
  options: {
    userId?: string | null;
    anonId?: string | null;
    properties?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("analytics_events").insert({
      event,
      user_id: options.userId ?? null,
      anon_id: options.anonId ? options.anonId.slice(0, 64) : null,
      properties: sanitize(options.properties ?? {}),
    });
  } catch (e) {
    // Analytics must never break a user action.
    console.error("analytics", event, e instanceof Error ? e.message : e);
  }
}

/** Fire and forget from a request handler. */
export function trackAsync(
  event: AnalyticsEvent,
  options: Parameters<typeof track>[1] = {}
): void {
  void track(event, options);
}
