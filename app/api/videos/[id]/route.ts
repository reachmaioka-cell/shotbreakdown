import { NextResponse } from "next/server";
import { trackAsync } from "@/lib/analytics";
import { UPLOAD_BUCKET } from "@/lib/constants";
import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Live processing status for the poller. Owner only. */
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
      "id, title, status, stage_detail, progress, shot_count, analyzed_shot_count, duration_seconds, error_message, error_code, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !video) return jsonError("Not found", 404);

  const { count: readyShots } = await supabase
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("video_id", id)
    .eq("status", "complete");

  return NextResponse.json({ video, readyShots: readyShots ?? 0 });
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
