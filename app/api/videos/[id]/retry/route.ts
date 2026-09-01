import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { requeueVideo, runWorkerTick } from "@/lib/pipeline/worker";
import { isActiveStatus } from "@/lib/videos";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const limited = await enforceRateLimit("video_retry", request, user.id);
  if (limited) return limited;

  const { data: video } = await supabase
    .from("videos")
    .select("id, user_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!video || video.user_id !== user.id) return jsonError("Not found", 404);
  if (isActiveStatus(video.status as string)) {
    return jsonError("This video is already processing", 409);
  }

  await requeueVideo(id, user.id);
  after(() => runWorkerTick(1).catch(() => {}));
  return NextResponse.json({ ok: true });
}
