import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
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

  /*
   * Each call creates a Stripe session. Authenticated is not the same as
   * unlimited: without this a signed-in user can spin up sessions in a loop and
   * burn our Stripe API quota. The bucket already existed and was simply never
   * applied here.
   */
  const limited = await enforceRateLimit("billing", request, user.id);
  if (limited) return limited;

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
