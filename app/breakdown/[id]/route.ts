import { permanentRedirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Legacy per-submission page. Every submission was backfilled into a video with
 * one shot, so send the visitor to whichever of those still exists.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const admin = createAdminClient();
  const { data: shot } = await admin
    .from("shots")
    .select("id, slug")
    .eq("submission_id", id)
    .maybeSingle();

  if (shot) permanentRedirect(`/shots/${shot.slug ?? shot.id}`);

  const { data: video } = await admin.from("videos").select("id").eq("id", id).maybeSingle();
  if (video) permanentRedirect(`/videos/${video.id}`);

  notFound();
}
