import { NextResponse } from "next/server";
import { isVerified } from "@/lib/auth-guard";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";
import { FREE_LIMIT } from "@/lib/constants";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ authed: false });

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, breakdown_count, is_admin, display_name")
    .eq("id", user.id)
    .maybeSingle();

  const plan = (profile?.plan as string) ?? "free";
  const used = (profile?.breakdown_count as number) ?? 0;

  return NextResponse.json({
    authed: true,
    // The spending routes refuse an unconfirmed address, so the client needs to
    // be able to say why before the user has spent an upload finding out.
    verified: isVerified(user),
    plan,
    isPro: plan === "pro",
    // Only advertise the console when it is actually reachable.
    isAdmin: !!profile?.is_admin && FEATURES.adminReview,
    breakdownCount: used,
    breakdownLimit: plan === "pro" ? null : FREE_LIMIT,
    breakdownRemaining: plan === "pro" ? null : Math.max(0, FREE_LIMIT - used),
    displayName: profile?.display_name ?? null,
  });
}
