import { after } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { enqueueJob, findActiveJob } from "@/lib/pipeline/queue";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readSegmentBreakdown } from "@/lib/validation";

export const maxDuration = 60;

const Body = z.object({
  focus: z.string().trim().max(500).optional(),
});

function dedupeKeyFor(videoId: string): string {
  return `segment-breakdown:${videoId}`;
}

async function kickWorker(): Promise<void> {
  try {
    const { drainQueue } = await import("@/lib/pipeline/worker");
    await drainQueue({ maxMs: 50_000, batchSize: 1 });
  } catch {
    // Cron or the local worker will pick the job up.
  }
}

/**
 * The one breakdown of a segment: its status, and the answer when it is ready.
 *
 * Read through the service role and authorize in code, the way getShot does:
 * RLS only exposes public rows to a non-owner, so an unlisted segment shared by
 * link would 404 for the person holding the link.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data: video } = await admin
    .from("videos")
    .select("id, user_id, visibility, focus, breakdown, breakdown_status, breakdown_error")
    .eq("id", id)
    .maybeSingle();

  if (!video) return jsonError("Not found", 404);

  const isOwner = !!user && video.user_id === user.id;
  if (!isOwner && video.visibility === "private") return jsonError("Not found", 404);

  const status = (video.breakdown_status as string | null) ?? "missing";
  // breakdown_error is the raw pipeline/provider message (worker.ts stores
  // Error.message verbatim), so it is the owner's to read, not a public
  // reader's — they cannot act on it and it can name internals.
  const error =
    status === "failed" && isOwner ? ((video.breakdown_error as string | null) ?? null) : null;
  return Response.json({
    status,
    breakdown: readSegmentBreakdown(video.breakdown),
    focus: (video.focus as string | null) ?? null,
    error,
  });
}

/**
 * Ask the segment a different question. Owner only: a refocus rewrites the
 * stored breakdown and costs a generation, so it is never a reader's to spend.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to regenerate a breakdown", 401);

  const admin = createAdminClient();
  const { data: video } = await admin
    .from("videos")
    .select("id, user_id, status")
    .eq("id", id)
    .maybeSingle();

  // Ownership before the rate limit, so a stranger cannot spend the owner's budget.
  if (!video || video.user_id !== user.id) return jsonError("Not found", 404);
  if (video.status !== "complete") return jsonError("This segment is still processing.", 400);

  const { count } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("video_id", id)
    .eq("status", "complete");
  if (!count) return jsonError("This segment has no analysed shots to break down.", 400);

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();
  const isPro = profile?.plan === "pro";

  const limited = await enforceRateLimit(
    "segment_breakdown",
    request,
    user.id,
    isPro ? { limit: 60 } : undefined
  );
  if (limited) return limited;

  // The body is optional: "regenerate, same question" is a bare POST with no
  // body at all, which request.json() would reject as malformed.
  let raw: unknown = {};
  const bodyText = await request.text().catch(() => "");
  if (bodyText.trim()) {
    try {
      raw = JSON.parse(bodyText);
    } catch {
      return jsonError("Invalid JSON", 400);
    }
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const already = await findActiveJob(dedupeKeyFor(id));
  if (already) {
    // A queued job has not read videos.focus yet, so a question that arrives
    // before it starts is still the one that gets answered. A running job has
    // already read it, and rewriting focus underneath it would leave the stored
    // question describing an answer to a different one.
    if (parsed.data.focus !== undefined && already.status === "pending") {
      await admin
        .from("videos")
        .update({ focus: parsed.data.focus || null })
        .eq("id", id);
    }
    return Response.json({ status: "pending" });
  }

  const update: Record<string, unknown> = {
    breakdown_status: "pending",
    breakdown_error: null,
  };
  // focus is the user's own column and the session client could write it, but
  // breakdown_status is pipeline-owned and the protect_video_columns trigger
  // rejects it from a client. One service-role write keeps the new question and
  // the pending marker from drifting apart if the second write were to fail.
  if (parsed.data.focus !== undefined) update.focus = parsed.data.focus || null;

  const { error: updateError } = await admin.from("videos").update(update).eq("id", id);
  if (updateError) return jsonError(updateError.message, 500);

  await enqueueJob(
    "generate_segment_breakdown",
    { videoId: id },
    {
      videoId: id,
      userId: user.id,
      dedupeKey: dedupeKeyFor(id),
      priority: 4,
    }
  );

  after(() => kickWorker());
  return Response.json({ status: "pending" });
}
