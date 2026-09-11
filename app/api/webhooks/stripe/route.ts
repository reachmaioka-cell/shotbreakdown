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

/**
 * Statuses that end the entitlement.
 *
 * `incomplete_expired` is the subscription that never took a first payment —
 * the buyer abandoned the 3-D Secure step, or the card was refused at
 * creation. Stripe gives up after 23 hours and nothing further is ever sent
 * for it. It has to be in here because `checkout.session.completed` has
 * already granted Pro by then: the session completes when the buyer finishes
 * the form, not when the money settles. Without it an account that never paid
 * keeps Pro for good.
 *
 * `incomplete` (still in flight) and `paused` (a trial that ended with no
 * payment method, collection paused) are deliberately absent: neither is a
 * decision, and acting on `incomplete` would revoke the plan for the few
 * seconds between a checkout and its first invoice.
 */
const REVOKED_STATUSES = new Set<Stripe.Subscription.Status>([
  "canceled",
  "unpaid",
  "incomplete_expired",
]);

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

/** Whatever a Stripe field holding a subscription is: an id, an object, or nothing. */
function subscriptionIdOf(value: unknown): string | null {
  let id: string | null = null;
  if (typeof value === "string") id = value;
  else if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    id = value.id;
  }
  if (!id) return null;
  /*
   * This id is interpolated into a PostgREST filter expression below, where a
   * comma or a bracket would change which rows the filter matches. Stripe ids
   * are `sub_` plus base62, so anything else did not come from Stripe and is
   * treated as no id at all — which costs only the subscription half of the
   * watermark, never a wrong write.
   */
  return /^[A-Za-z0-9_]+$/.test(id) ? id : null;
}

/** The shape Postgres will accept as a `profiles.id`. */
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The account our own checkout stamped on the subscription
 * (`subscription_data.metadata.user_id`), when the event carries it.
 *
 * `checkout.session.completed` is the only event that writes
 * `stripe_customer_id`, so until it lands there is nothing for a
 * customer-keyed event to match — and a cancellation delivered before it is
 * therefore dropped, leaving the checkout to grant Pro for a subscription that
 * is already dead. The metadata is the one other thread back to the account,
 * and it is written by this application, never by the customer: the Customer
 * Portal cannot set subscription metadata.
 */
function accountIdOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const userId = (metadata as Record<string, unknown>).user_id;
  return typeof userId === "string" && ACCOUNT_ID.test(userId) ? userId : null;
}

/**
 * Stripe's clock for this event.
 *
 * `created` is on every real event, so the fallback is for the shape that
 * should not exist. It is here because the alternative is worse than dating
 * the event ourselves: `new Date(NaN).toISOString()` throws, the handler
 * answers 500, and Stripe redelivers for days — and an endpoint that fails
 * long enough is one Stripe disables, which takes every other event with it.
 */
function createdAtOf(event: Stripe.Event): string {
  if (Number.isFinite(event.created)) return new Date(event.created * 1000).toISOString();
  console.warn(`${event.type} ${event.id} carries no usable created; dating it now`);
  return new Date().toISOString();
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

/*
 * ---------------------------------------------------------------------------
 * The entitlement watermark, and why this one.
 *
 * Stripe guarantees no delivery order and retries a failed delivery for days,
 * so the event in hand is not necessarily the newest thing that happened. The
 * `billing_events` id table (0030) only stops the SAME event being applied
 * twice; two DIFFERENT events in the wrong order walk straight through it:
 *
 *   checkout.session.completed (the new subscription)          -> pro
 *   customer.subscription.deleted (the OLD one, created older)  -> free
 *
 * Two columns on `profiles` decide whether an event is still news:
 *
 *   billing_event_at         `event.created` of the newest event allowed to
 *                            decide this account's plan.
 *   billing_subscription_id  the subscription that decision was about.
 *
 * The rule:
 *   - A grant applies when `event.created >= billing_event_at`. Nothing else:
 *     a grant naming a subscription we have not seen is a customer moving onto
 *     a new one, and it takes the watermark over.
 *   - A revoke applies when `event.created >= billing_event_at` AND the event
 *     names the subscription the entitlement is actually resting on (or names
 *     none, or we have not recorded one). The cancellation of a subscription
 *     the customer already replaced says nothing about the one they are paying
 *     for now — whatever its timestamp — and that asymmetry is on purpose:
 *     when the evidence is ambiguous, keep what the customer paid for.
 *
 * Why not `event.created` alone: it is blind to which subscription an event is
 * about, so a cancellation of the old subscription that is genuinely NEWER
 * than the purchase of its replacement (cancel-after-resubscribe, which the
 * portal makes easy) still downgrades a paying customer.
 *
 * Why not fetch `Subscription.status` from Stripe at handling time: it is
 * authoritative and immune to ordering, but it costs an API call on every
 * event, and it makes entitlement depend on Stripe being reachable during a
 * webhook — which is precisely the moment it is not, since an outage is what
 * produces the backlog of retries in the first place. A failed fetch would
 * have no safe default. The right home for that call is a periodic
 * reconciliation job, not this handler.
 *
 * What this still cannot defend against:
 *   - Two entitlement events stamped the same second. `event.created` is whole
 *     seconds and Stripe ships no per-customer sequence number, so the gate
 *     admits an event equal to the watermark and arrival order decides. A
 *     stricter `>` would be worse: `updated{canceled}` and `deleted` share a
 *     second on every cancellation, and dropping the second one is not safe.
 *   - An event that names no subscription (an unexpanded one-off invoice, a
 *     Checkout session with no subscription). Time is the only handle on it.
 *   - A subscription that names no account either: one created in the Stripe
 *     dashboard rather than by our checkout carries no `metadata.user_id`, so
 *     if it is cancelled before the checkout event lands there is nothing to
 *     match it to and the cancellation is reported as unmatched.
 *   - A customer with two live subscriptions at once. `profiles.plan` is one
 *     boolean, so the newest grant wins and the other subscription's
 *     cancellation is ignored — and "the other" can be the one they are
 *     paying for, if the second subscription sent the more recent entitled
 *     status: the identity then names the second, and cancelling the first is
 *     refused until the second ends too. Pro outlives one of two cancellations
 *     rather than either of them going wrong, which is the right way round for
 *     a customer who is still paying for something. It heals when the
 *     remaining subscription ends, because that revoke does name the identity.
 *     Correct for a single-plan product; it is not per-subscription
 *     entitlement, and only that would fix it properly.
 *   - An event Stripe never delivers at all. A watermark orders what arrives;
 *     it cannot invent what does not. Only reconciliation closes that.
 * ---------------------------------------------------------------------------
 */

type PlanChange = {
  plan: "free" | "pro";
  /** `id` for a checkout session (it carries the user), else the customer. */
  match: { column: "id" | "stripe_customer_id"; value: string };
  event: Stripe.Event;
  /** The subscription the event is about: an id, an object, or nothing. */
  subscription: unknown;
  /** Extra columns this event is also authoritative for. */
  also?: Record<string, string>;
  /**
   * The account the subscription names itself, used only when no profile
   * carries this customer id yet. See `accountIdOf`.
   */
  fallbackUserId?: string | null;
};

type PlanWrite = {
  plan: "free" | "pro";
  column: "id" | "stripe_customer_id";
  value: string;
  createdAt: string;
  subscriptionId: string | null;
  also?: Record<string, string>;
};

/** The gated write itself. Returns the rows it moved, which may be none. */
async function writePlan({
  plan,
  column,
  value,
  createdAt,
  subscriptionId,
  also,
}: PlanWrite): Promise<{ id: string; pro_since: string | null }[]> {
  const admin = createAdminClient();

  let update = admin
    .from("profiles")
    .update({
      plan,
      billing_event_at: createdAt,
      // Only when this event said. An invoice that arrives without the id must
      // not erase which subscription the entitlement is resting on.
      ...(subscriptionId ? { billing_subscription_id: subscriptionId } : {}),
      ...also,
    })
    .eq(column, value)
    /*
     * The gate lives in the WHERE clause rather than in a read before the
     * write. Stripe delivers in parallel, and a read-then-write would let two
     * deliveries both pass the check on the same stale row; Postgres re-checks
     * this predicate against the row the other delivery just committed.
     */
    .or(`billing_event_at.is.null,billing_event_at.lte.${createdAt}`);

  if (plan === "free" && subscriptionId) {
    update = update.or(
      `billing_subscription_id.is.null,billing_subscription_id.eq.${subscriptionId}`
    );
  }

  const { data, error } = await update.select("id, pro_since");
  if (error) {
    console.error(`failed to move profile to ${plan}`, error.message);
    throw error;
  }
  return data ?? [];
}

/** Is there a profile behind this filter at all? */
async function profileExists(column: "id" | "stripe_customer_id", value: string) {
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id")
    .eq(column, value)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function applyPlan({
  plan,
  match,
  event,
  subscription,
  also,
  fallbackUserId,
}: PlanChange): Promise<void> {
  const createdAt = createdAtOf(event);
  const subscriptionId = subscriptionIdOf(subscription);

  const moved = await writePlan({
    plan,
    column: match.column,
    value: match.value,
    createdAt,
    subscriptionId,
    also,
  });
  if (moved.length) {
    if (plan === "pro") await stampProSince(moved);
    return;
  }

  /*
   * Nothing moved, and the reasons are not the same thing. A superseded event
   * is the protection working and happens whenever Stripe retries; an account
   * we cannot find is money taken for nothing, and has to be reported.
   */
  const superseded = () =>
    console.warn(
      `${event.type} ${event.id} superseded: created ${createdAt}` +
        (subscriptionId ? `, subscription ${subscriptionId}` : ", no subscription named")
    );

  if (await profileExists(match.column, match.value)) {
    superseded();
    return;
  }

  /*
   * No profile carries this customer id. For a first purchase that is not a
   * missing account, it is a missing mapping: `checkout.session.completed` is
   * the only event that writes one, and it has not arrived. Take the account
   * from the subscription's own metadata and record the mapping while we are
   * here, so a cancellation delivered ahead of the checkout is not dropped
   * only for the checkout to grant Pro on a subscription that is already dead.
   */
  if (fallbackUserId && match.column === "stripe_customer_id") {
    const viaMetadata = await writePlan({
      plan,
      column: "id",
      value: fallbackUserId,
      createdAt,
      subscriptionId,
      also: { ...also, stripe_customer_id: match.value },
    });
    if (viaMetadata.length) {
      console.warn(
        `${event.type} ${event.id} matched ${fallbackUserId} by subscription metadata; ` +
          `the checkout event for ${match.value} has not arrived`
      );
      if (plan === "pro") await stampProSince(viaMetadata);
      return;
    }
    if (await profileExists("id", fallbackUserId)) {
      superseded();
      return;
    }
  }
  reportUnmatched(event.type, match.column, match.value);
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
    const customerId = customerIdOf(session.customer);

    /*
     * The session completes when the buyer finishes the form, not when the
     * money settles. A subscription whose first payment is still in flight —
     * 3-D Secure abandoned, card refused at creation — reports `unpaid` here,
     * and granting on it hands out Pro for the ~23 hours Stripe takes to give
     * up and send `incomplete_expired`. The customer mapping is still worth
     * recording either way: it is what lets every later event about this
     * account find its row, including the one that closes an unpaid attempt.
     */
    if (session.payment_status === "unpaid") {
      if (customerId) {
        await createAdminClient()
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", userId);
      }
      console.warn("checkout.session.completed is unpaid; entitlement waits for the invoice", {
        userId,
        paymentStatus: session.payment_status,
      });
      return;
    }

    await applyPlan({
      plan: "pro",
      match: { column: "id", value: userId },
      event,
      subscription: session.subscription,
      ...(customerId ? { also: { stripe_customer_id: customerId } } : {}),
    });
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
      await applyPlan({
        plan: "pro",
        match: { column: "stripe_customer_id", value: customerId },
        event,
        subscription: invoice.parent?.subscription_details?.subscription,
        fallbackUserId: accountIdOf(invoice.parent?.subscription_details?.metadata),
      });
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
    const match = { column: "stripe_customer_id", value: customerId } as const;
    const fallbackUserId = accountIdOf(subscription.metadata);
    if (ENTITLED_STATUSES.has(subscription.status)) {
      await applyPlan({ plan: "pro", match, event, subscription, fallbackUserId });
    } else if (REVOKED_STATUSES.has(subscription.status)) {
      await applyPlan({ plan: "free", match, event, subscription, fallbackUserId });
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
    await applyPlan({
      plan: "free",
      match: { column: "stripe_customer_id", value: customerId },
      event,
      subscription: invoice.parent?.subscription_details?.subscription,
      fallbackUserId: accountIdOf(invoice.parent?.subscription_details?.metadata),
    });
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const customerId = customerIdOf(subscription.customer);
    if (!customerId) {
      console.warn("customer.subscription.deleted missing customer id");
      return;
    }
    await applyPlan({
      plan: "free",
      match: { column: "stripe_customer_id", value: customerId },
      event,
      subscription,
      fallbackUserId: accountIdOf(subscription.metadata),
    });
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
