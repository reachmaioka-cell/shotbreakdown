import { NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { UPLOAD_BUCKET } from "@/lib/constants";
import { jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readSegmentBreakdown } from "@/lib/validation";

/**
 * Live processing status for the poller, plus the segment's own fields.
 *
 * Read through the caller's session client, so RLS decides: the owner always,
 * and a signed-in reader of a public segment, which is the same audience the
 * breakdown route already serves. A private segment 404s for everyone else.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const { data: video, error } = await supabase
    .from("videos")
    .select(
      "id, user_id, title, status, stage_detail, progress, shot_count, analyzed_shot_count, duration_seconds, error_message, error_code, created_at, updated_at, focus, segment_start, segment_end, source_duration_seconds, breakdown_status, breakdown_error, visibility"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !video) return jsonError("Not found", 404);

  /*
   * RLS lets any signed-in reader see a PUBLIC segment, so this row is not
   * necessarily the caller's. breakdown_error and error_message hold the raw
   * pipeline and provider messages verbatim; they are the owner's to read and
   * mean nothing to anyone else. The page already blanks them server-side, and
   * this route is polled into the same client state, so it has to agree.
   */
  const isOwner = video.user_id === user.id;
  const payload = isOwner
    ? video
    : { ...video, breakdown_error: null, error_message: null, error_code: null };

  // The breakdown is a multi-kilobyte document and this route is polled every
  // couple of seconds while a segment processes. Fetching it in a second query,
  // only once the pipeline says it is ready, keeps the poll small for the whole
  // time there is nothing to send.
  let breakdown = null;
  if (video.breakdown_status === "ready") {
    const { data: row } = await supabase
      .from("videos")
      .select("breakdown")
      .eq("id", id)
      .maybeSingle();
    breakdown = readSegmentBreakdown(row?.breakdown);
  }

  const { count: readyShots } = await supabase
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("video_id", id)
    .eq("status", "complete");

  return NextResponse.json({ video: payload, readyShots: readyShots ?? 0, breakdown });
}

// Trimmed before the length check, not after: a pasted question that ends in a
// newline is inside the limit once trimmed, and rejecting it would be a 400 the
// user cannot see the cause of. The refocus route validates the same `focus`
// column the same way.
const PatchBody = z
  .object({
    // A name, so it has to be one. Nulling the title on an empty submit loses
    // the segment's name silently; a 400 leaves it as it was.
    title: z.string().trim().min(1).max(200).optional(),
    focus: z.string().trim().max(500).optional(),
  })
  .refine((body) => body.title !== undefined || body.focus !== undefined);

/**
 * Rename a segment, or rewrite the question asked of it. Owner only.
 *
 * Written through the caller's own session client rather than the service role.
 * Title and focus are the only two fields on a video a client may change, and
 * RLS plus the protect_video_columns trigger are what hold that line; going in
 * as service_role here would mean a hole in either one never showed up.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const limited = await enforceRateLimit("edit", request, user.id);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  // A public segment is readable by anyone, so ownership is checked here rather
  // than inferred from the read succeeding.
  const { data: video } = await supabase
    .from("videos")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!video || video.user_id !== user.id) return jsonError("Not found", 404);

  const patch: Record<string, string | null> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  // Clearing the box is how the uploader takes their question back off the
  // segment, so an empty focus is a null and not an empty string to answer.
  if (parsed.data.focus !== undefined) patch.focus = parsed.data.focus || null;

  const { data: updated, error } = await supabase
    .from("videos")
    .update(patch)
    .eq("id", id)
    .select("title, focus")
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!updated) return jsonError("Not found", 404);

  return NextResponse.json({ title: updated.title, focus: updated.focus });
}

/**
 * Permanent deletion. Removes the source file, every extracted frame, and — by
 * FK cascade — every shot, collection item, saved reference and share that
 * pointed at them. Nothing is soft-deleted or retained.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const { data: video } = await supabase
    .from("videos")
    .select("id, user_id, file_path")
    .eq("id", id)
    .maybeSingle();

  if (!video || video.user_id !== user.id) return jsonError("Not found", 404);

  const admin = createAdminClient();

  const { data: frames } = await admin
    .from("shot_frames")
    .select("storage_path, thumb_path")
    .eq("video_id", id);

  const paths = new Set<string>();
  for (const frame of frames ?? []) {
    if (frame.storage_path) paths.add(frame.storage_path as string);
    if (frame.thumb_path) paths.add(frame.thumb_path as string);
  }
  if (video.file_path) paths.add(video.file_path as string);

  if (paths.size > 0) {
    const list = [...paths];
    for (let i = 0; i < list.length; i += 100) {
      const { error } = await admin.storage.from(UPLOAD_BUCKET).remove(list.slice(i, i + 100));
      if (error) console.error("storage delete", error.message);
    }
  }

  const { error: deleteError } = await admin.from("videos").delete().eq("id", id);
  if (deleteError) return jsonError(deleteError.message, 500);

  trackAsync("video_deleted", { userId: user.id, properties: { shots: frames?.length ?? 0 } });
  return NextResponse.json({ ok: true, deletedFiles: paths.size });
}
