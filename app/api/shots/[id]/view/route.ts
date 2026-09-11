import { NextResponse } from "next/server";
import { clientKey, consumeRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { jsonError } from "@/lib/http";

/**
 * View counter. Deduped per viewer per shot per day so a refresh loop cannot
 * inflate it, and only shots somebody could actually open are counted.
 *
 * The visibility check is the point: the counter took any id at all, so a
 * private row — a customer's upload, or an editorial row waiting for review —
 * could have its count run up by anyone who guessed its id. Nothing leaks
 * either way (the response says only whether it counted), but view_count is a
 * number the library may one day rank by, and a ranking signal anyone can write
 * is not a signal.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Invalid id", 400);

  const dedupe = await consumeRateLimit("view", `${clientKey(request)}:${id}`, {
    limit: 1,
    windowSeconds: 24 * 60 * 60,
  });
  if (!dedupe.allowed) return NextResponse.json({ counted: false });

  const admin = createAdminClient();
  const { data: shot } = await admin
    .from("shots")
    .select("visibility")
    .eq("id", id)
    .maybeSingle();
  if (!shot || shot.visibility === "private") return NextResponse.json({ counted: false });

  const { error } = await admin.rpc("increment_shot_view", { p_shot_id: id });
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ counted: true });
}
