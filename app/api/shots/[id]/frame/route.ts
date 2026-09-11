import { NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { requireVerifiedUser } from "@/lib/auth-guard";
import { jsonError } from "@/lib/http";
import { getShotFrames } from "@/lib/shots";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueJob } from "@/lib/pipeline/queue";

const Body = z.object({
  frameId: z.string().uuid(),
  /** Re-run analysis against the newly chosen frame. */
  reanalyze: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const frames = await getShotFrames(id, user?.id ?? null, { allowPublic: true });
  return NextResponse.json({ frames });
}

/** Override the AI's representative-frame choice. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  // The reanalyze branch below is a model call. Guarded at the top rather than
  // beside it so an unverified caller does not spend an edit token either: this
  // route only ever touches a shot the caller already owns, and an unverified
  // account cannot have one, so nothing legitimate is refused here.
  const unverified = requireVerifiedUser(user);
  if (unverified) return unverified;

  const limited = await enforceRateLimit("edit", request, user.id);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const admin = createAdminClient();
  const { data: shot } = await admin
    .from("shots")
    .select("id, user_id, video_id, representative_frame_id")
    .eq("id", id)
    .maybeSingle();
  if (!shot || shot.user_id !== user.id) return jsonError("Not found", 404);

  const { data: frame } = await admin
    .from("shot_frames")
    .select("id, shot_id, storage_path, thumb_path, timestamp_seconds")
    .eq("id", parsed.data.frameId)
    .maybeSingle();
  if (!frame || frame.shot_id !== id) return jsonError("Frame not found", 404);

  // The representative flag is uniquely indexed per shot, so clear then set.
  await admin.from("shot_frames").update({ is_representative: false }).eq("shot_id", id);
  await admin.from("shot_frames").update({ is_representative: true }).eq("id", frame.id);

  const { error } = await admin
    .from("shots")
    .update({
      representative_frame_id: frame.id,
      representative_timestamp: frame.timestamp_seconds,
      poster_path: frame.storage_path,
      thumbnail_path: (frame.thumb_path as string | null) ?? (frame.storage_path as string),
    })
    .eq("id", id);
  if (error) return jsonError(error.message, 500);

  await admin.from("shot_edits").insert({
    shot_id: id,
    user_id: user.id,
    kind: "frame_changed",
    field_key: "representative_frame_id",
    previous_value: shot.representative_frame_id ?? null,
    new_value: frame.id,
  });

  trackAsync("representative_frame_changed", { userId: user.id, properties: { shotId: id } });

  if (parsed.data.reanalyze) {
    const rateLimited = await enforceRateLimit("reanalyze", request, user.id);
    if (rateLimited) return rateLimited;
    await admin.from("shots").update({ status: "pending" }).eq("id", id);
    await enqueueJob(
      "reanalyze_shot",
      { shotId: id },
      { videoId: shot.video_id as string, userId: user.id, dedupeKey: `reanalyze:${id}`, priority: 8 }
    );
  }

  return NextResponse.json({ ok: true, reanalyzing: !!parsed.data.reanalyze });
}
