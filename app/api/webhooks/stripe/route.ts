import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { jsonError } from "@/lib/http";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function customerIdOf(customer: unknown): string | null {
  if (!customer) return null;
  if (typeof customer === "string") return customer;
  if (typeof customer === "object" && "id" in customer && typeof customer.id === "string") {
    return customer.id;
  }
  return null;
}

async function markPro(customerId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ plan: "pro", pro_since: new Date().toISOString() })
    .eq("stripe_customer_id", customerId);
  if (error) {
    console.error("failed to mark profile pro", error.message);
    throw error;
  }
}

async function markFree(customerId: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ plan: "free" }).eq("stripe_customer_id", customerId);
  if (error) {
    console.error("failed to mark profile free", error.message);
    throw error;
  }
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeConfigured() || !webhookSecret) {
    return jsonError("Billing is not configured", 503);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return jsonError("Missing stripe-signature", 400);

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch {
    return jsonError("Invalid signature", 400);
  }

  const admin = createAdminClient();

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id;
      if (!userId) {
        console.warn("checkout.session.completed missing client_reference_id");
        return NextResponse.json({ received: true });
      }

      const customerId = customerIdOf(session.customer);
      const { error } = await admin
        .from("profiles")
        .update({
          plan: "pro",
          ...(customerId ? { stripe_customer_id: customerId } : {}),
          pro_since: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) throw error;
    } else if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      const customerId = customerIdOf(invoice.customer);
      if (!customerId) {
        console.warn("invoice.paid missing customer id");
        return NextResponse.json({ received: true });
      }
      if (invoice.billing_reason === "subscription_create" || invoice.billing_reason === "subscription_cycle") {
        await markPro(customerId);
      }
    } else if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object;
      const customerId = customerIdOf(subscription.customer);
      if (!customerId) {
        console.warn("customer.subscription.updated missing customer id");
        return NextResponse.json({ received: true });
      }
      if (subscription.status === "active") {
        await markPro(customerId);
      } else if (subscription.status === "canceled" || subscription.status === "unpaid") {
        await markFree(customerId);
      }
    } else if (event.type === "customer.subscription.deleted" || event.type === "invoice.payment_failed") {
      const customerId = customerIdOf(event.data.object.customer);
      if (!customerId) {
        console.warn(`${event.type} missing customer id`);
        return NextResponse.json({ received: true });
      }
      await markFree(customerId);
    }
  } catch {
    return jsonError("Profile update failed", 500);
  }

  return NextResponse.json({ received: true });
}
