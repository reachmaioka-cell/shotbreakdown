import { NextResponse } from "next/server";
import { trackAsync } from "@/lib/analytics";
import { jsonError } from "@/lib/http";
import { planLimits } from "@/lib/plans";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Save a shot to My Shots. One click, no modal. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to save shots", 401);

  const limited = await enforceRateLimit("save", request, user.id);
  if (limited) return limited;

  const admin = createAdminClient();

  // A shot can only be saved if the user is allowed to see it.
  const { data: shot } = await admin
    .from("shots")
    .select("id, user_id, visibility")
    .eq("id", id)
    .maybeSingle();
  if (!shot) return jsonError("Not found", 404);
  if (shot.visibility === "private" && shot.user_id !== user.id) {
    return jsonError("Not found", 404);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();
  const limits = planLimits(profile?.plan as string | null);

  const { count } = await admin
    .from("saved_shots")
    .select("shot_id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((count ?? 0) >= limits.maxSavedShots) {
    return NextResponse.json(
      { error: "plan_limit_reached", message: `Your plan holds ${limits.maxSavedShots} saved shots.` },
      { status: 402 }
    );
  }

  const { error } = await supabase
    .from("saved_shots")
    .upsert({ user_id: user.id, shot_id: id }, { onConflict: "user_id,shot_id" });
  if (error) return jsonError(error.message, 500);

  trackAsync("shot_saved", { userId: user.id, properties: { shotId: id } });
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const limited = await enforceRateLimit("save", request, user.id);
  if (limited) return limited;

  const { error } = await supabase
    .from("saved_shots")
    .delete()
    .eq("user_id", user.id)
    .eq("shot_id", id);
  if (error) return jsonError(error.message, 500);

  trackAsync("shot_unsaved", { userId: user.id, properties: { shotId: id } });
  return NextResponse.json({ saved: false });
}
