import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { reportError } from "@/lib/errors";
import { jsonError } from "@/lib/http";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Subscription statuses that keep the customer on Pro.
 *
 * `past_due` and `trialing` are deliberately in here. Stripe retries a
 * declined card for days before giving up; taking the product away on the
 * first decline loses a customer who is one tap from fixing their card, and
 * the give-up transitions (`unpaid`, `canceled`) revoke access anyway.
 */
const ENTITLED_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);
const REVOKED_STATUSES = new Set<Stripe.Subscription.Status>(["canceled", "unpaid"]);

/**
 * Failed charges tolerated before the plan goes back to free.
 *
 * Stripe's default retry schedule is four attempts over about two weeks. By
 * the third the card is not going to work, and `attempt_count` is the only
 * number on the invoice that says how far down that road we are.
 */
const FAILED_ATTEMPTS_BEFORE_DOWNGRADE = 3;

function customerIdOf(customer: unknown): string | null {
  if (!customer) return null;
  if (typeof customer === "string") return customer;
  if (typeof customer === "object" && "id" in customer && typeof customer.id === "string") {
    return customer.id;
  }
  return null;
}

/**
 * The subscription status carried by an invoice, when Stripe sent the object
 * rather than the id. Unexpanded is the normal case, and then there is nothing
 * to read here: the definite `unpaid` transition arrives separately as
 * `customer.subscription.updated`, which revokes on its own.
 */
function subscriptionStatusOf(invoice: Stripe.Invoice): Stripe.Subscription.Status | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  return subscription && typeof subscription === "object" ? subscription.status : null;
}

/**
 * A profile update that matched no row means we took the money and granted
 * nothing — the customer id on the event belongs to no account here. Silent
 * until now, because a PostgREST update that matches nothing is not an error.
 */
function reportUnmatched(event: string, filter: string, value: string) {
  reportError(new Error(`${event} matched no profile`), {
    source: "billing.webhook_unmatched",
    event,
    filter,
    value,
  });
}

async function markPro(customerId: string, eventType: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .update({ plan: "pro" })
    .eq("stripe_customer_id", customerId)
    .select("id, pro_since");
  if (error) {
    console.error("failed to mark profile pro", error.message);
    throw error;
  }
  if (!data?.length) {
    reportUnmatched(eventType, "stripe_customer_id", customerId);
    return;
  }
  await stampProSince(data);
}

/**
 * `pro_since` is when this account first became Pro, so a renewal must not
 * move it. Only rows that have never carried one get stamped.
 */
async function stampProSince(rows: { id: string; pro_since: string | null }[]) {
  const firstTime = rows.filter((row) => !row.pro_since).map((row) => row.id);
  if (!firstTime.length) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ pro_since: new Date().toISOString() })
    .in("id", firstTime);
  if (error) {
    console.error("failed to stamp pro_since", error.message);
    throw error;
  }
}

async function markFree(customerId: string, eventType: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .update({ plan: "free" })
    .eq("stripe_customer_id", customerId)
    .select("id");
  if (error) {
    console.error("failed to mark profile free", error.message);
    throw error;
  }
  if (!data?.length) reportUnmatched(eventType, "stripe_customer_id", customerId);
}

/**
 * Claim the event, or discover somebody already has it.
 *
 * The insert goes in before any of the work. Recording it afterwards leaves a
 * window where the profile moved and the id did not land, and the redelivery
 * that follows repeats the work — which, for `customer.subscription.deleted`
 * arriving after a re-subscribe, means downgrading a paying customer.
 */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.from("billing_events").insert({ id: event.id, type: event.type });
  if (!error) return true;
  // 23505: the primary key is already there, so this is a redelivery.
  if (error.code === "23505") return false;
  throw error;
}

/**
 * Give the claim back when the work failed, so Stripe's retry can do it.
 * Without this a transient database error would leave the event marked
 * handled and the entitlement never granted.
 */
async function releaseEvent(eventId: string) {
  try {
    const admin = createAdminClient();
    await admin.from("billing_events").delete().eq("id", eventId);
  } catch (e) {
    reportError(e, { source: "billing.webhook_release_failed", eventId });
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id;
    if (!userId) {
      console.warn("checkout.session.completed missing client_reference_id");
      return;
    }

    const admin = createAdminClient();
    const customerId = customerIdOf(session.customer);
    const { data, error } = await admin
      .from("profiles")
      .update({
        plan: "pro",
        ...(customerId ? { stripe_customer_id: customerId } : {}),
      })
      .eq("id", userId)
      .select("id, pro_since");

    if (error) throw error;
    if (!data?.length) {
      reportUnmatched(event.type, "id", userId);
      return;
    }
    await stampProSince(data);
    return;
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object;
    const customerId = customerIdOf(invoice.customer);
    if (!customerId) {
      console.warn("invoice.paid missing customer id");
      return;
    }
    if (invoice.billing_reason === "subscription_create" || invoice.billing_reason === "subscription_cycle") {
      await markPro(customerId, event.type);
    }
    return;
  }

  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object;
    const customerId = customerIdOf(subscription.customer);
    if (!customerId) {
      console.warn("customer.subscription.updated missing customer id");
      return;
    }
    if (ENTITLED_STATUSES.has(subscription.status)) {
      await markPro(customerId, event.type);
    } else if (REVOKED_STATUSES.has(subscription.status)) {
      await markFree(customerId, event.type);
    }
    return;
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;
    const customerId = customerIdOf(invoice.customer);
    if (!customerId) {
      console.warn("invoice.payment_failed missing customer id");
      return;
    }
    const attempts = invoice.attempt_count ?? 0;
    const givenUp = subscriptionStatusOf(invoice) === "unpaid";
    if (attempts < FAILED_ATTEMPTS_BEFORE_DOWNGRADE && !givenUp) {
      console.warn(`invoice.payment_failed attempt ${attempts}: keeping plan while Stripe retries`);
      return;
    }
    await markFree(customerId, event.type);
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const customerId = customerIdOf(event.data.object.customer);
    if (!customerId) {
      console.warn("customer.subscription.deleted missing customer id");
      return;
    }
    await markFree(customerId, event.type);
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

  let claimed: boolean;
  try {
    claimed = await claimEvent(event);
  } catch (e) {
    reportError(e, { source: "billing.webhook_claim_failed", eventId: event.id, type: event.type });
    return jsonError("Event bookkeeping failed", 500);
  }
  // Already handled. 200, and nothing touched — that is the whole point.
  if (!claimed) return NextResponse.json({ received: true, duplicate: true });

  try {
    await handleEvent(event);
  } catch (e) {
    reportError(e, { source: "billing.webhook_failed", eventId: event.id, type: event.type });
    await releaseEvent(event.id);
    return jsonError("Profile update failed", 500);
  }

  return NextResponse.json({ received: true });
}
