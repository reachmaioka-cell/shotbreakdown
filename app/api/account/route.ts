import { NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { UPLOAD_BUCKET } from "@/lib/constants";
import { jsonError } from "@/lib/http";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const Body = z.object({ confirm: z.literal("DELETE") });

/**
 * Permanent account deletion.
 *
 * Cancels any subscription first (so we stop charging), removes every stored
 * object the user owns, then deletes the auth user — which cascades through
 * profiles, videos, shots, frames, collections, saves, shares and preferences.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  if (!Body.safeParse(raw).success) {
    return jsonError("Type DELETE to confirm", 400);
  }

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, plan")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.stripe_customer_id) {
    try {
      if (stripeConfigured()) {
        const stripe = getStripe();
        const subs = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id as string,
          status: "active",
          limit: 10,
        });
        for (const sub of subs.data) {
          await stripe.subscriptions.cancel(sub.id);
        }
      }
    } catch (e) {
      // A billing failure must not block the user from deleting their data.
      console.error("cancel subscription on delete", e instanceof Error ? e.message : e);
    }
  }

  // Storage does not cascade, so enumerate and remove the user's folder.
  try {
    const paths = new Set<string>();
    const { data: frames } = await admin
      .from("shot_frames")
      .select("storage_path, thumb_path")
      .eq("user_id", user.id);
    for (const frame of frames ?? []) {
      if (frame.storage_path) paths.add(frame.storage_path as string);
      if (frame.thumb_path) paths.add(frame.thumb_path as string);
    }
    const { data: videos } = await admin
      .from("videos")
      .select("file_path")
      .eq("user_id", user.id);
    for (const video of videos ?? []) {
      if (video.file_path) paths.add(video.file_path as string);
    }

    const list = [...paths];
    for (let i = 0; i < list.length; i += 100) {
      await admin.storage.from(UPLOAD_BUCKET).remove(list.slice(i, i + 100));
    }
  } catch (e) {
    console.error("storage cleanup on delete", e instanceof Error ? e.message : e);
  }

  // Analytics rows keep a null user_id by FK rule; scrub them anyway so nothing
  // ties historical behaviour to a deleted account.
  await admin.from("analytics_events").delete().eq("user_id", user.id);

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return jsonError(error.message, 500);

  trackAsync("account_deleted", { properties: { plan: (profile?.plan as string) ?? "free" } });

  await supabase.auth.signOut().catch(() => {});
  return NextResponse.json({ ok: true });
}
