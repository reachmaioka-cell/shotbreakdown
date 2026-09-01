import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { getStripe, stripeConfigured } from "@/lib/stripe";

export async function POST(request: Request) {
  if (!stripeConfigured()) {
    return jsonError("Billing is not configured", 503);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  const customerId = profile?.stripe_customer_id;
  if (!customerId || typeof customerId !== "string") {
    return jsonError("No billing account", 400);
  }

  const origin = getAppUrl(request);

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/settings`,
    });
    if (!session.url) return jsonError("Portal session missing url", 500);
    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Portal failed";
    console.error("billingPortal.sessions.create failed", message);
    return jsonError("Portal failed", 500);
  }
}
