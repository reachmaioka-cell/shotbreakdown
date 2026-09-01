import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { checkoutConfigured, getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  if (!checkoutConfigured()) {
    return jsonError("Billing is not configured", 503);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.plan === "pro") return jsonError("Already on Pro", 400);

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) return jsonError("Billing is not configured", 503);

  const origin = getAppUrl(request);
  const customerId =
    typeof profile?.stripe_customer_id === "string" && profile.stripe_customer_id
      ? profile.stripe_customer_id
      : null;

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${origin}/?upgraded=1`,
      cancel_url: `${origin}/upgrade`,
      ...(customerId
        ? { customer: customerId }
        : user.email
          ? { customer_email: user.email }
          : {}),
    });

    if (!session.url) return jsonError("Checkout session missing url", 500);
    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Checkout failed";
    console.error("checkout.session.create failed", message);
    return jsonError("Checkout failed", 500);
  }
}
