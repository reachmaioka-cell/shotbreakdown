/**
 * The webhook is the only thing standing between a payment and the customer
 * getting what they paid for, and between a redelivered event and a paying
 * customer being downgraded. So these tests run the real route handler over
 * real signed bodies and check what landed in the real database — no mock of
 * the handler, no mock of PostgREST. A mock cannot tell us that the update
 * matched a row, and that is the failure that costs a customer.
 *
 * `generateTestHeaderString` signs a body with a secret we make up here, so
 * the whole file runs with no Stripe credentials and no network.
 */
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";
import { PRO_PRICE_USD_MONTHLY } from "@/lib/plans";
import { PRO_PRICE_UNIT_AMOUNT, priceMatchesPlan } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

const WEBHOOK_SECRET = "whsec_billing_test_secret";
const ready = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);
const suite = ready ? describe : describe.skip;

/** Signing only; no key is ever used to reach Stripe from these tests. */
const signer = new Stripe("sk_test_billing_tests_never_call_out");

let counter = 0;
const eventIds: string[] = [];

/**
 * `created` is Stripe's clock, and it is the only thing that orders Stripe's
 * events. The ordering tests below set it explicitly; everything else takes
 * "now", which is what a delivery that arrives in order looks like.
 */
function event(
  type: string,
  object: Record<string, unknown>,
  options: { id?: string; created?: number } = {}
) {
  const eventId = options.id ?? `evt_test_${Date.now()}_${counter++}`;
  if (!eventIds.includes(eventId)) eventIds.push(eventId);
  return {
    id: eventId,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: options.created ?? Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  };
}

async function post(payload: unknown, options: { tamperedBody?: string } = {}) {
  const signed = JSON.stringify(payload);
  const header = signer.webhooks.generateTestHeaderString({
    payload: signed,
    secret: WEBHOOK_SECRET,
  });
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": header, "content-type": "application/json" },
      body: options.tamperedBody ?? signed,
    })
  );
}

suite("stripe webhook", () => {
  const admin = createAdminClient();
  const customerId = `cus_test_${Date.now()}`;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing_tests_never_call_out");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);

    const email = `billing-${Date.now()}@shotbreakdown.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: `pw-${Math.random().toString(36).slice(2)}A1!`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    userId = data.user.id;

    // The profile row is created by the on_auth_user_created trigger; the
    // customer mapping is what checkout would have written.
    const { error: mapError } = await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", userId);
    if (mapError) throw new Error(`map customer: ${mapError.message}`);
  });

  afterAll(async () => {
    if (eventIds.length) await admin.from("billing_events").delete().in("id", eventIds);
    if (userId) await admin.auth.admin.deleteUser(userId);
    vi.unstubAllEnvs();
  });

  /*
   * Clearing the watermark is part of the reset: null means "no event has
   * decided anything yet", so a test that does not care about ordering gets
   * the pre-watermark behaviour and cannot inherit a mark from the test before
   * it. The ordering tests below set the timeline themselves, with events.
   */
  async function setPlan(plan: "free" | "pro", proSince: string | null = null) {
    const { error } = await admin
      .from("profiles")
      .update({
        plan,
        pro_since: proSince,
        billing_event_at: null,
        billing_subscription_id: null,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
  }

  async function profile() {
    const { data, error } = await admin
      .from("profiles")
      .select("plan, pro_since, stripe_customer_id, billing_event_at, billing_subscription_id")
      .eq("id", userId)
      .single();
    if (error) throw new Error(error.message);
    return data as {
      plan: string;
      pro_since: string | null;
      stripe_customer_id: string | null;
      billing_event_at: string | null;
      billing_subscription_id: string | null;
    };
  }

  beforeEach(async () => {
    await setPlan("free");
  });

  describe("signature", () => {
    it("accepts a body signed with the configured secret", async () => {
      const res = await post(event("customer.subscription.updated", { customer: customerId, status: "active" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true });
    });

    it("rejects a body that was changed after signing", async () => {
      const payload = event("customer.subscription.deleted", { customer: customerId });
      await setPlan("pro");
      const tampered = JSON.stringify(payload).replace(customerId, "cus_someone_else");
      const res = await post(payload, { tamperedBody: tampered });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid signature" });
      expect((await profile()).plan).toBe("pro");
    });

    it("rejects a body with no signature header at all", async () => {
      const res = await POST(
        new Request("http://localhost/api/webhooks/stripe", {
          method: "POST",
          body: JSON.stringify(event("invoice.paid", { customer: customerId })),
        })
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Missing stripe-signature" });
    });
  });

  describe("entitlement", () => {
    it("grants Pro on checkout.session.completed and records the customer", async () => {
      const res = await post(
        event("checkout.session.completed", {
          client_reference_id: userId,
          customer: customerId,
        })
      );
      expect(res.status).toBe(200);
      const row = await profile();
      expect(row.plan).toBe("pro");
      expect(row.stripe_customer_id).toBe(customerId);
      expect(row.pro_since).not.toBeNull();
    });

    /*
     * The session completes when the buyer finishes the form, not when the
     * money settles. Granting on an unpaid one hands out Pro for the ~23 hours
     * Stripe takes to give up and send incomplete_expired.
     */
    it("does not grant Pro on a checkout session whose payment has not settled", async () => {
      const res = await post(
        event("checkout.session.completed", {
          client_reference_id: userId,
          customer: customerId,
          payment_status: "unpaid",
        })
      );
      expect(res.status).toBe(200);
      const row = await profile();
      expect(row.plan).toBe("free");
      expect(row.pro_since).toBeNull();
      // The mapping is still recorded, so the invoice that settles it can find the account.
      expect(row.stripe_customer_id).toBe(customerId);
    });

    it("grants Pro once the invoice for that session is paid", async () => {
      await post(
        event("checkout.session.completed", {
          client_reference_id: userId,
          customer: customerId,
          payment_status: "unpaid",
        })
      );
      expect((await profile()).plan).toBe("free");

      const res = await post(
        event("invoice.paid", { customer: customerId, billing_reason: "subscription_create" })
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("pro");
    });

    it("acknowledges a checkout session with no client_reference_id and changes nothing", async () => {
      const res = await post(event("checkout.session.completed", { customer: customerId }));
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("free");
    });

    it("grants Pro on the first invoice and on each renewal", async () => {
      for (const billing_reason of ["subscription_create", "subscription_cycle"]) {
        await setPlan("free");
        const res = await post(event("invoice.paid", { customer: customerId, billing_reason }));
        expect(res.status).toBe(200);
        expect((await profile()).plan).toBe("pro");
      }
    });

    it("leaves a one-off invoice alone", async () => {
      const res = await post(event("invoice.paid", { customer: customerId, billing_reason: "manual" }));
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("free");
    });

    it("does not move pro_since on a renewal", async () => {
      const firstDay = "2026-01-02T03:04:05.000Z";
      await setPlan("pro", firstDay);
      const res = await post(
        event("invoice.paid", { customer: customerId, billing_reason: "subscription_cycle" })
      );
      expect(res.status).toBe(200);
      const row = await profile();
      expect(row.plan).toBe("pro");
      expect(new Date(row.pro_since ?? 0).toISOString()).toBe(firstDay);
    });

    /*
     * The starting plan is free on purpose: an entitled status has to *grant*
     * Pro for the assertion to mean anything. If `trialing` or `past_due` is
     * dropped from the entitled set the event falls through and the row stays
     * free, which is exactly the regression to catch.
     */
    it("treats a trial as Pro", async () => {
      const res = await post(
        event("customer.subscription.updated", { customer: customerId, status: "trialing" })
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("pro");
    });

    it("keeps Pro while Stripe retries a declined card (past_due)", async () => {
      const res = await post(
        event("customer.subscription.updated", { customer: customerId, status: "past_due" })
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("pro");
    });

    it("revokes Pro when the subscription is canceled or given up on", async () => {
      for (const status of ["canceled", "unpaid"]) {
        await setPlan("pro");
        const res = await post(event("customer.subscription.updated", { customer: customerId, status }));
        expect(res.status).toBe(200);
        expect((await profile()).plan).toBe("free");
      }
    });

    it("revokes Pro when the subscription is deleted", async () => {
      await setPlan("pro");
      const res = await post(event("customer.subscription.deleted", { customer: customerId }));
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("free");
    });

    it("acknowledges an event for a customer we have never seen", async () => {
      const res = await post(
        event("customer.subscription.deleted", { customer: "cus_not_ours_at_all" })
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("free");
    });

    it("acknowledges an event type it does not handle", async () => {
      await setPlan("pro");
      const res = await post(event("charge.refunded", { customer: customerId }));
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("pro");
    });
  });

  describe("failed payments", () => {
    it("keeps Pro on the first decline", async () => {
      await setPlan("pro");
      const res = await post(
        event("invoice.payment_failed", { customer: customerId, attempt_count: 1 })
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("pro");
    });

    it("keeps Pro on the second decline", async () => {
      await setPlan("pro");
      const res = await post(
        event("invoice.payment_failed", { customer: customerId, attempt_count: 2 })
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("pro");
    });

    it("revokes Pro once Stripe has tried three times", async () => {
      await setPlan("pro");
      const res = await post(
        event("invoice.payment_failed", { customer: customerId, attempt_count: 3 })
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("free");
    });

    it("revokes Pro on the first decline if Stripe has already given up on the subscription", async () => {
      await setPlan("pro");
      const res = await post(
        event("invoice.payment_failed", {
          customer: customerId,
          attempt_count: 1,
          parent: { subscription_details: { subscription: { id: "sub_test", status: "unpaid" } } },
        })
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("free");
    });
  });

  describe("redelivery", () => {
    it("records the event id it handled", async () => {
      const payload = event("customer.subscription.updated", { customer: customerId, status: "active" });
      await post(payload);
      const { data } = await admin
        .from("billing_events")
        .select("id, type")
        .eq("id", payload.id)
        .single();
      expect(data).toMatchObject({ id: payload.id, type: "customer.subscription.updated" });
    });

    /*
     * The expensive case: the customer cancelled, re-subscribed, and Stripe
     * redelivers the cancellation. Without the id check the second delivery
     * takes Pro away from somebody who is paying for it right now.
     */
    it("ignores a redelivered cancellation after the customer re-subscribed", async () => {
      const payload = event("customer.subscription.deleted", { customer: customerId });
      await setPlan("pro");

      const first = await post(payload);
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ received: true });
      expect((await profile()).plan).toBe("free");

      await setPlan("pro");
      const second = await post(payload);
      expect(second.status).toBe(200);
      expect((await profile()).plan).toBe("pro");
      expect(await second.json()).toEqual({ received: true, duplicate: true });
    });

    it("ignores a redelivered payment as well, so pro_since is not rewritten", async () => {
      const payload = event("invoice.paid", {
        customer: customerId,
        billing_reason: "subscription_create",
      });
      await post(payload);
      const first = await profile();
      expect(first.plan).toBe("pro");

      await setPlan("free");
      const second = await post(payload);
      expect((await profile()).plan).toBe("free");
      expect(await second.json()).toEqual({ received: true, duplicate: true });
    });
  });

  /*
   * Stripe promises no delivery order and retries a failed delivery for days,
   * so "the event we are handling is the newest thing that happened" is not
   * true. Every test here is two FIRST deliveries of two DIFFERENT events --
   * the id table in 0030 sees nothing wrong with any of them.
   *
   * `at` is seconds on Stripe's clock. Each test owns its own timeline and
   * starts from a cleared watermark (see setPlan), so nothing here depends on
   * the test that ran before it.
   */
  describe("out-of-order delivery", () => {
    const at = Math.floor(Date.now() / 1000);

    it("does not let a cancelled old subscription undo a newer re-subscribe", async () => {
      await setPlan("free");

      const bought = await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_new" },
          { created: at }
        )
      );
      expect(bought.status).toBe(200);
      expect((await profile()).plan).toBe("pro");

      // The cancellation of the subscription they replaced, delayed ten minutes.
      const stale = await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_old", customer: customerId },
          { created: at - 600 }
        )
      );
      expect(stale.status).toBe(200);
      expect((await profile()).plan).toBe("pro");
    });

    it("does not let a stale active update re-grant Pro after a cancellation", async () => {
      await setPlan("pro");

      const cancelled = await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_gone", customer: customerId },
          { created: at }
        )
      );
      expect(cancelled.status).toBe(200);
      expect((await profile()).plan).toBe("free");

      const stale = await post(
        event(
          "customer.subscription.updated",
          { id: "sub_gone", customer: customerId, status: "active" },
          { created: at - 600 }
        )
      );
      expect(stale.status).toBe(200);
      expect((await profile()).plan).toBe("free");
    });

    it("still downgrades when the cancellation really is the newest event", async () => {
      await setPlan("free");

      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_only" },
          { created: at - 600 }
        )
      );
      expect((await profile()).plan).toBe("pro");

      await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_only", customer: customerId },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("free");
    });

    it("still grants when the re-subscribe really is the newest event", async () => {
      await setPlan("pro");

      await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_old", customer: customerId },
          { created: at - 600 }
        )
      );
      expect((await profile()).plan).toBe("free");

      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_new" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");
    });

    /*
     * event.created has one-second resolution and Stripe ships no per-customer
     * sequence number, so two events stamped the same second cannot be ordered
     * by anything we hold. The watermark deliberately admits an event equal to
     * it -- arrival order decides -- and these two pin that, in both
     * directions, so the choice is visible rather than accidental. Using `>`
     * instead would drop the second half of every cancellation Stripe sends
     * (updated{canceled} and deleted share a second).
     */
    it("applies two events created in the same second in arrival order (revoke last)", async () => {
      await setPlan("free");

      await post(
        event(
          "customer.subscription.updated",
          { id: "sub_same", customer: customerId, status: "active" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");

      await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_same", customer: customerId },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("free");
    });

    it("applies two events created in the same second in arrival order (grant last)", async () => {
      await setPlan("pro");

      await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_same2", customer: customerId },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("free");

      await post(
        event(
          "customer.subscription.updated",
          { id: "sub_same2", customer: customerId, status: "active" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");
    });

    /*
     * The timestamp alone cannot save this one: the cancellation of the old
     * subscription is genuinely NEWER than the purchase of the new one, which
     * is what happens when somebody starts the replacement before cancelling
     * what it replaces. Only knowing which subscription the account is on
     * refuses it.
     */
    it("ignores a cancellation of a subscription the account is no longer on, even when it is newer", async () => {
      await setPlan("free");

      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_b" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");

      await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_a", customer: customerId },
          { created: at + 600 }
        )
      );
      expect((await profile()).plan).toBe("pro");
    });

    it("still cancels when the newest event is about the subscription the account is on", async () => {
      await setPlan("free");

      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_b" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");

      await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_b", customer: customerId },
          { created: at + 600 }
        )
      );
      expect((await profile()).plan).toBe("free");
    });

    it("ignores a run of failed payments on a subscription the account is no longer on", async () => {
      await setPlan("free");

      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_live" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");

      await post(
        event(
          "invoice.payment_failed",
          {
            customer: customerId,
            attempt_count: 4,
            parent: { subscription_details: { subscription: "sub_dead" } },
          },
          { created: at + 600 }
        )
      );
      expect((await profile()).plan).toBe("pro");
    });

    it("still downgrades on failed payments for the subscription the account is on", async () => {
      await setPlan("free");

      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_live" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");

      await post(
        event(
          "invoice.payment_failed",
          {
            customer: customerId,
            attempt_count: 4,
            parent: { subscription_details: { subscription: "sub_live" } },
          },
          { created: at + 600 }
        )
      );
      expect((await profile()).plan).toBe("free");
    });

    /*
     * checkout.session.completed is the only event that maps a Stripe customer
     * to an account, and the only thing that grants a first purchase. It can
     * arrive after the subscription events, so the watermark must not be able
     * to lock it out -- and it cannot, because until it lands there is nothing
     * for a customer-keyed event to match and therefore no watermark to beat.
     */
    it("records the customer when the checkout session arrives after the subscription events", async () => {
      await setPlan("free");
      await admin.from("profiles").update({ stripe_customer_id: null }).eq("id", userId);
      try {
        await post(
          event(
            "customer.subscription.updated",
            { id: "sub_first", customer: customerId, status: "active" },
            { created: at }
          )
        );
        expect((await profile()).plan).toBe("free");

        const res = await post(
          event(
            "checkout.session.completed",
            { client_reference_id: userId, customer: customerId, subscription: "sub_first" },
            { created: at + 5 }
          )
        );
        expect(res.status).toBe(200);
        const row = await profile();
        expect(row.plan).toBe("pro");
        expect(row.stripe_customer_id).toBe(customerId);
      } finally {
        await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", userId);
      }
    });

    /*
     * The two halves of the gate are ANDed, and nothing else here proves it:
     * every other refusal in this block would also be refused by the half
     * being tested on its own. This cancellation names the subscription the
     * account is actually on, so identity waves it through -- only the
     * timestamp can refuse it. If a second `.or()` ever replaced the first
     * instead of narrowing it, this is the test that notices, and the
     * customer it protects is one who is paying right now.
     */
    it("refuses a stale cancellation even when it names the current subscription", async () => {
      await setPlan("free");

      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_current" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");

      await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_current", customer: customerId },
          { created: at - 600 }
        )
      );
      expect((await profile()).plan).toBe("pro");
    });

    /*
     * Three deliveries, two subscriptions, none of them in order: the customer
     * moved from A to B, the cancellation of A turns up between the two
     * purchases, and only the cancellation of B may end the entitlement.
     */
    it("keeps the newest subscription across three interleaved events", async () => {
      await setPlan("free");

      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_first" },
          { created: at }
        )
      );
      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_second" },
          { created: at + 100 }
        )
      );
      expect((await profile()).billing_subscription_id).toBe("sub_second");

      await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_first", customer: customerId },
          { created: at + 50 }
        )
      );
      expect((await profile()).plan).toBe("pro");

      await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_second", customer: customerId },
          { created: at + 200 }
        )
      );
      expect((await profile()).plan).toBe("free");
    });

    /*
     * Stripe delivers in parallel, so the two events of a cancel race each
     * other rather than queueing. The gate is in the WHERE clause precisely so
     * that the loser of the race re-checks its predicate against what the
     * winner committed; whichever order the two land in, the newer event is
     * the one standing at the end. A read-then-write would pass this only by
     * luck, so it runs a few rounds.
     */
    it("settles on the newer event when two deliveries race", async () => {
      for (let round = 0; round < 5; round++) {
        await setPlan("free");
        await Promise.all([
          post(
            event(
              "customer.subscription.updated",
              { id: "sub_race", customer: customerId, status: "active" },
              { created: at }
            )
          ),
          post(
            event(
              "customer.subscription.deleted",
              { id: "sub_race", customer: customerId },
              { created: at + 10 }
            )
          ),
        ]);
        expect((await profile()).plan).toBe("free");
      }
    });

    /*
     * `created` is on every event Stripe has ever sent, so this is about what
     * happens if one ever arrives without it. Dating it ourselves is the least
     * bad answer: throwing on `new Date(NaN).toISOString()` would answer 500,
     * and Stripe redelivers a 500 for days and eventually disables an endpoint
     * that keeps doing it -- which would take the whole of billing down over
     * one malformed event.
     */
    it("still handles an event that carries no created at all", async () => {
      await setPlan("pro");
      const payload: Record<string, unknown> = {
        ...event("customer.subscription.deleted", { id: "sub_undated", customer: customerId }),
      };
      delete payload.created;

      const res = await post(payload);
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("free");
    });

    it("renews Pro on an invoice that names no subscription at all", async () => {
      await setPlan("free");

      await post(
        event(
          "customer.subscription.updated",
          { id: "sub_live", customer: customerId, status: "active" },
          { created: at }
        )
      );
      await post(
        event(
          "invoice.paid",
          { customer: customerId, billing_reason: "subscription_cycle" },
          { created: at + 600 }
        )
      );
      expect((await profile()).plan).toBe("pro");
    });
  });

  /*
   * A subscription that never took a first payment. Stripe ends it as
   * `incomplete_expired`, which is terminal: it will never be paid, and
   * nothing further arrives for it. checkout.session.completed has already
   * granted Pro by then -- the session completes before the payment is
   * settled -- so leaving this unhandled leaves an unpaid account on Pro for
   * good.
   */
  describe("a subscription that never completed", () => {
    const at = Math.floor(Date.now() / 1000);

    it("revokes Pro when the subscription the account is on expires unpaid", async () => {
      await setPlan("free");

      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_never" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");

      const res = await post(
        event(
          "customer.subscription.updated",
          { id: "sub_never", customer: customerId, status: "incomplete_expired" },
          { created: at + 60 }
        )
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("free");
    });

    it("leaves Pro alone when some other subscription expires unpaid", async () => {
      await setPlan("free");

      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_paid" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");

      const res = await post(
        event(
          "customer.subscription.updated",
          { id: "sub_abandoned", customer: customerId, status: "incomplete_expired" },
          { created: at + 60 }
        )
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("pro");
    });

    it("leaves an in-flight incomplete subscription alone", async () => {
      await setPlan("pro");
      const res = await post(
        event(
          "customer.subscription.updated",
          { id: "sub_pending", customer: customerId, status: "incomplete" },
          { created: at }
        )
      );
      expect(res.status).toBe(200);
      expect((await profile()).plan).toBe("pro");
    });
  });

  /*
   * The window before `checkout.session.completed` lands. It is the only event
   * that writes `stripe_customer_id`, so until it arrives nothing keyed on the
   * customer can find the account -- and a cancellation delivered ahead of it
   * used to be dropped as "no such account", leaving the checkout behind it to
   * grant Pro for a subscription that was already dead. Nothing later ever
   * corrects that: Stripe has finished sending events for a subscription it
   * has deleted.
   *
   * Our own checkout stamps `subscription_data.metadata.user_id`, so the
   * subscription names the account even when the mapping does not exist yet.
   */
  describe("a customer whose mapping has not landed yet", () => {
    const at = Math.floor(Date.now() / 1000);

    async function withoutMapping(run: () => Promise<void>) {
      await admin.from("profiles").update({ stripe_customer_id: null }).eq("id", userId);
      try {
        await run();
      } finally {
        await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", userId);
      }
    }

    it("revokes on a cancellation delivered before the checkout that created it", async () => {
      await setPlan("free");
      await withoutMapping(async () => {
        const cancelled = await post(
          event(
            "customer.subscription.deleted",
            { id: "sub_quick", customer: customerId, metadata: { user_id: userId } },
            { created: at + 100 }
          )
        );
        expect(cancelled.status).toBe(200);
        // The mapping is a fact about the account, not an entitlement, so it
        // is recorded even by the event that takes the plan away.
        expect((await profile()).stripe_customer_id).toBe(customerId);

        await post(
          event(
            "checkout.session.completed",
            { client_reference_id: userId, customer: customerId, subscription: "sub_quick" },
            { created: at }
          )
        );
        expect((await profile()).plan).toBe("free");
      });
    });

    /*
     * The same ordering against the subscription that never took a payment. It
     * is the shape `incomplete_expired` exists for -- an account that never
     * paid -- and it is most likely of all to be a first purchase, which is
     * exactly when the mapping is missing.
     */
    it("revokes when a subscription expires unpaid before the checkout arrives", async () => {
      await setPlan("free");
      await withoutMapping(async () => {
        await post(
          event(
            "customer.subscription.updated",
            {
              id: "sub_never_paid",
              customer: customerId,
              status: "incomplete_expired",
              metadata: { user_id: userId },
            },
            { created: at + 100 }
          )
        );
        await post(
          event(
            "checkout.session.completed",
            { client_reference_id: userId, customer: customerId, subscription: "sub_never_paid" },
            { created: at }
          )
        );
        expect((await profile()).plan).toBe("free");
      });
    });

    /*
     * The fallback matches on the account, so it can reach a profile that is
     * already mapped to a DIFFERENT Stripe customer -- which happens for real:
     * checkout passes `customer_email` when there is no mapping yet, so an
     * abandoned first attempt leaves a second customer behind with its own
     * subscription. The identity half of the gate is what stops that dead
     * subscription's expiry from downgrading the one the customer is paying
     * for, and this is the only place the fallback and that gate meet.
     */
    it("ignores an abandoned first attempt that expires under another customer", async () => {
      await setPlan("free");
      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_paid_for" },
          { created: at }
        )
      );
      expect((await profile()).plan).toBe("pro");

      const res = await post(
        event(
          "customer.subscription.updated",
          {
            id: "sub_abandoned_attempt",
            customer: `${customerId}_other`,
            status: "incomplete_expired",
            metadata: { user_id: userId },
          },
          { created: at + 100 }
        )
      );
      expect(res.status).toBe(200);
      const row = await profile();
      expect(row.plan).toBe("pro");
      // and the mapping still points at the customer who is paying
      expect(row.stripe_customer_id).toBe(customerId);
    });

    /*
     * The metadata is interpolated into a filter on a uuid column, so anything
     * that is not one has to be refused before it gets there: PostgREST
     * answers a malformed uuid with an error, the handler would answer 500,
     * and Stripe would redeliver that forever.
     */
    it("ignores metadata that is not one of our account ids", async () => {
      await setPlan("pro");
      await withoutMapping(async () => {
        const res = await post(
          event(
            "customer.subscription.deleted",
            { id: "sub_junk", customer: customerId, metadata: { user_id: "not-a-uuid" } },
            { created: at }
          )
        );
        expect(res.status).toBe(200);
        expect((await profile()).plan).toBe("pro");
      });
    });
  });

  /*
   * Stripe sends an id where the object was not expanded and the object where
   * it was, and either can turn up on the same event type.
   */
  describe("the shapes a Stripe field comes in", () => {
    const at = Math.floor(Date.now() / 1000);

    it("matches a customer sent as an expanded object", async () => {
      const res = await post(
        event(
          "customer.subscription.updated",
          { id: "sub_expanded", customer: { id: customerId, object: "customer" }, status: "active" },
          { created: at }
        )
      );
      expect(res.status).toBe(200);
      const row = await profile();
      expect(row.plan).toBe("pro");
      expect(row.billing_subscription_id).toBe("sub_expanded");
    });

    it("reads the subscription id out of an expanded subscription object", async () => {
      await post(
        event(
          "checkout.session.completed",
          {
            client_reference_id: userId,
            customer: customerId,
            subscription: { id: "sub_object", object: "subscription", status: "active" },
          },
          { created: at }
        )
      );
      expect((await profile()).billing_subscription_id).toBe("sub_object");
    });

    /*
     * A checkout that names no subscription still grants, but it must not
     * erase which subscription the entitlement is resting on -- the next
     * cancellation is checked against that id.
     */
    it("grants on a checkout with no subscription without forgetting the old id", async () => {
      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_known" },
          { created: at }
        )
      );
      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: null },
          { created: at + 10 }
        )
      );
      const row = await profile();
      expect(row.plan).toBe("pro");
      expect(row.billing_subscription_id).toBe("sub_known");
    });
  });

  /*
   * The ordinary life of a subscription, end to end, with the watermark in the
   * way of every step. None of these are ordering puzzles; they are the paths
   * every paying customer takes, and the gate must be invisible on all of them.
   */
  describe("the ordinary life of a subscription", () => {
    const at = Math.floor(Date.now() / 1000);

    it("keeps Pro from a cancel-at-period-end until the subscription actually ends", async () => {
      await setPlan("free");
      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_period" },
          { created: at }
        )
      );
      // Stripe leaves the status `active` and only sets the flag; access runs
      // to the end of the period the customer has already paid for.
      await post(
        event(
          "customer.subscription.updated",
          { id: "sub_period", customer: customerId, status: "active", cancel_at_period_end: true },
          { created: at + 10 }
        )
      );
      expect((await profile()).plan).toBe("pro");

      await post(
        event(
          "customer.subscription.deleted",
          { id: "sub_period", customer: customerId },
          { created: at + 2000 }
        )
      );
      expect((await profile()).plan).toBe("free");
    });

    it("puts a customer back on Pro when the card is fixed after a downgrade", async () => {
      await setPlan("free");
      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_dunning" },
          { created: at }
        )
      );
      await post(
        event(
          "invoice.payment_failed",
          {
            customer: customerId,
            attempt_count: 3,
            parent: { subscription_details: { subscription: "sub_dunning" } },
          },
          { created: at + 100 }
        )
      );
      expect((await profile()).plan).toBe("free");

      await post(
        event(
          "invoice.paid",
          {
            customer: customerId,
            billing_reason: "subscription_cycle",
            parent: { subscription_details: { subscription: "sub_dunning" } },
          },
          { created: at + 200 }
        )
      );
      expect((await profile()).plan).toBe("pro");
    });

    /*
     * `paused` is not a decision either way, so it must not move the watermark
     * -- an event that decides nothing must not be allowed to supersede the
     * one that decides something next.
     */
    it("leaves both the plan and the watermark alone on a paused subscription", async () => {
      await setPlan("free");
      await post(
        event(
          "checkout.session.completed",
          { client_reference_id: userId, customer: customerId, subscription: "sub_paused" },
          { created: at }
        )
      );
      const before = await profile();

      await post(
        event(
          "customer.subscription.updated",
          { id: "sub_paused", customer: customerId, status: "paused" },
          { created: at + 100 }
        )
      );
      const after = await profile();
      expect(after.plan).toBe("pro");
      expect(after.billing_event_at).toBe(before.billing_event_at);
      expect(after.billing_subscription_id).toBe(before.billing_subscription_id);
    });
  });
});

describe("the advertised price", () => {
  it("matches a $12 monthly Price", () => {
    expect(PRO_PRICE_UNIT_AMOUNT).toBe(PRO_PRICE_USD_MONTHLY * 100);
    expect(priceMatchesPlan({ unit_amount: PRO_PRICE_UNIT_AMOUNT, recurring: { interval: "month" } as never })).toBe(true);
  });

  it("does not match a different amount or a different interval", () => {
    expect(priceMatchesPlan({ unit_amount: 2400, recurring: { interval: "month" } as never })).toBe(false);
    expect(priceMatchesPlan({ unit_amount: PRO_PRICE_UNIT_AMOUNT, recurring: { interval: "year" } as never })).toBe(false);
    expect(priceMatchesPlan({ unit_amount: PRO_PRICE_UNIT_AMOUNT, recurring: null })).toBe(false);
  });
});

/*
 * assertPriceMatches talks to Stripe, so the Stripe client is replaced here —
 * the rule under test is ours, the retrieve is theirs. Fresh module registry
 * per case because the verdict is cached for the life of the process.
 */
describe("checking the live price", () => {
  async function withPrices(retrieve: (id: string) => Promise<unknown>) {
    vi.resetModules();
    vi.doMock("stripe", () => ({
      default: class {
        prices = { retrieve };
      },
    }));
    return import("@/lib/stripe");
  }

  afterAll(() => {
    vi.doUnmock("stripe");
    vi.resetModules();
  });

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_price_check");
    vi.stubEnv("STRIPE_PRICE_ID", "price_test_check");
  });

  it("allows checkout when the Price is the advertised one, and asks Stripe once", async () => {
    const retrieve = vi.fn(async () => ({
      unit_amount: PRO_PRICE_UNIT_AMOUNT,
      recurring: { interval: "month" },
    }));
    const { assertPriceMatches } = await withPrices(retrieve);
    expect(await assertPriceMatches()).toBe(true);
    expect(await assertPriceMatches()).toBe(true);
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it("blocks checkout when the Price charges something else", async () => {
    const retrieve = vi.fn(async () => ({ unit_amount: 9900, recurring: { interval: "month" } }));
    const { assertPriceMatches } = await withPrices(retrieve);
    expect(await assertPriceMatches()).toBe(false);
  });

  it("blocks checkout when the Price is not monthly", async () => {
    const retrieve = vi.fn(async () => ({
      unit_amount: PRO_PRICE_UNIT_AMOUNT,
      recurring: { interval: "year" },
    }));
    const { assertPriceMatches } = await withPrices(retrieve);
    expect(await assertPriceMatches()).toBe(false);
  });

  it("lets checkout through when Stripe cannot be reached, and asks again next time", async () => {
    const retrieve = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const { assertPriceMatches } = await withPrices(retrieve);
    expect(await assertPriceMatches()).toBe(true);
    expect(await assertPriceMatches()).toBe(true);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  /*
   * The verdict used to last for the life of the process, so a Price corrected
   * in the dashboard needed a redeploy before checkout would take money again.
   * The clock is faked rather than waited on; the point is that the cache
   * expires at all, and that the cheap path is still cheap.
   */
  it("picks a corrected Price up without a redeploy", async () => {
    let unitAmount = 9900;
    const retrieve = vi.fn(async () => ({ unit_amount: unitAmount, recurring: { interval: "month" } }));
    const { assertPriceMatches, PRICE_MISMATCH_TTL_MS } = await withPrices(retrieve);

    expect(await assertPriceMatches()).toBe(false);
    unitAmount = PRO_PRICE_UNIT_AMOUNT; // fixed in the Stripe dashboard
    expect(await assertPriceMatches()).toBe(false);
    expect(retrieve).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(PRICE_MISMATCH_TTL_MS + 1000);
      expect(await assertPriceMatches()).toBe(true);
      expect(retrieve).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-reads a Price that was right, on a slower clock", async () => {
    let unitAmount = PRO_PRICE_UNIT_AMOUNT;
    const retrieve = vi.fn(async () => ({ unit_amount: unitAmount, recurring: { interval: "month" } }));
    const { assertPriceMatches, PRICE_MATCH_TTL_MS, PRICE_MISMATCH_TTL_MS } =
      await withPrices(retrieve);

    // The steady state is cached for longer than the broken one, on purpose.
    expect(PRICE_MATCH_TTL_MS).toBeGreaterThan(PRICE_MISMATCH_TTL_MS);

    expect(await assertPriceMatches()).toBe(true);
    unitAmount = 9900; // somebody edits the Price to the wrong number
    expect(await assertPriceMatches()).toBe(true);
    expect(retrieve).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(PRICE_MATCH_TTL_MS + 1000);
      expect(await assertPriceMatches()).toBe(false);
      expect(retrieve).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

/*
 * The checkout route, with only Stripe and the session mocked — the guard, the
 * gate order and the price check under test are the route's own.
 */
describe("starting a subscription", () => {
  type CheckoutUser = { id: string; email: string; email_confirmed_at: string | null };

  const verifiedUser: CheckoutUser = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "buyer@example.com",
    email_confirmed_at: new Date().toISOString(),
  };

  async function loadCheckout(options: {
    user: CheckoutUser | null;
    unitAmount?: number;
    interval?: string;
  }) {
    const sessionCreate = vi.fn(async () => ({ url: "https://checkout.stripe.com/c/pay/test" }));
    const priceRetrieve = vi.fn(async () => ({
      unit_amount: options.unitAmount ?? PRO_PRICE_UNIT_AMOUNT,
      recurring: { interval: options.interval ?? "month" },
    }));
    const enforceRateLimit = vi.fn(async () => null);

    vi.resetModules();
    vi.doMock("stripe", () => ({
      default: class {
        prices = { retrieve: priceRetrieve };
        checkout = { sessions: { create: sessionCreate } };
      },
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: options.user } }) },
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { plan: "free", stripe_customer_id: null } }) }),
          }),
        }),
      }),
    }));
    vi.doMock("@/lib/rate-limit", () => ({ enforceRateLimit }));

    const { POST } = await import("@/app/api/billing/checkout/route");
    const res = await POST(new Request("http://localhost/api/billing/checkout", { method: "POST" }));
    return { res, sessionCreate, priceRetrieve, enforceRateLimit };
  }

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_checkout");
    vi.stubEnv("STRIPE_PRICE_ID", "price_test_checkout");
  });

  afterAll(() => {
    vi.doUnmock("stripe");
    vi.doUnmock("@/lib/supabase/server");
    vi.doUnmock("@/lib/rate-limit");
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("sends a verified buyer to Stripe", async () => {
    const { res, sessionCreate } = await loadCheckout({ user: verifiedUser });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/test" });
    expect(sessionCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses an unconfirmed address before it costs a rate-limit token", async () => {
    const { res, sessionCreate, enforceRateLimit } = await loadCheckout({
      user: { ...verifiedUser, email_confirmed_at: null },
    });
    expect(res.status).toBe(403);
    // The button renders `message`; `error` is for code. Both are the contract.
    expect(await res.json()).toMatchObject({
      error: "verify_email",
      message: expect.stringContaining("Confirm your email"),
    });
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("refuses to charge an amount the page never showed", async () => {
    const { res, sessionCreate } = await loadCheckout({ user: verifiedUser, unitAmount: 9900 });
    expect(res.status).toBe(503);
    expect(sessionCreate).not.toHaveBeenCalled();
  });
});

/*
 * An event whose customer belongs to no account here is the shape of "we took
 * the money and granted nothing": a PostgREST update that matches no row is
 * not an error, so before the `.select()` went in this was silent. The report
 * is the whole point of the branch, so it is what these assert — the plan not
 * moving would look identical if the write simply vanished.
 */
suite("an event we cannot match to an account", () => {
  const strayIds: string[] = [];

  async function postWithReporter(payload: Record<string, unknown>) {
    const reportError = vi.fn();
    vi.resetModules();
    vi.doMock("@/lib/errors", () => ({ reportError }));
    const { POST: handler } = await import("@/app/api/webhooks/stripe/route");
    const body = JSON.stringify(payload);
    const header = signer.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });
    const res = await handler(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": header, "content-type": "application/json" },
        body,
      })
    );
    return { res, reportError };
  }

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unmatched");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  });

  afterAll(async () => {
    vi.doUnmock("@/lib/errors");
    vi.resetModules();
    vi.unstubAllEnvs();
    if (strayIds.length) await createAdminClient().from("billing_events").delete().in("id", strayIds);
  });

  it("reports a customer id that maps to no profile", async () => {
    const payload = event("customer.subscription.deleted", { customer: "cus_belongs_to_nobody" });
    strayIds.push(payload.id);
    const { res, reportError } = await postWithReporter(payload);
    expect(res.status).toBe(200);
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        source: "billing.webhook_unmatched",
        event: "customer.subscription.deleted",
        filter: "stripe_customer_id",
        value: "cus_belongs_to_nobody",
      })
    );
  });

  it("stays quiet when the customer does map to an account", async () => {
    const admin = createAdminClient();
    const customerId = `cus_matched_${Date.now()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email: `matched-${Date.now()}@shotbreakdown.test`,
      password: `pw-${Math.random().toString(36).slice(2)}A1!`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", data.user.id);

    const payload = event("customer.subscription.updated", { customer: customerId, status: "active" });
    strayIds.push(payload.id);
    try {
      const { res, reportError } = await postWithReporter(payload);
      expect(res.status).toBe(200);
      expect(reportError).not.toHaveBeenCalled();

      const { data: row } = await admin.from("profiles").select("plan").eq("id", data.user.id).single();
      expect((row as { plan: string }).plan).toBe("pro");
    } finally {
      // A failed assertion must not leave an account behind for the next run.
      await admin.auth.admin.deleteUser(data.user.id);
    }
  });

  it("does not report a superseded event as an unmatched account", async () => {
    const admin = createAdminClient();
    const customerId = `cus_superseded_${Date.now()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email: `superseded-${Date.now()}@shotbreakdown.test`,
      password: `pw-${Math.random().toString(36).slice(2)}A1!`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);

    // A decision already taken an hour into the future: anything arriving now
    // is older news, and must be dropped quietly rather than reported as money
    // taken for an account that does not exist.
    await admin
      .from("profiles")
      .update({
        stripe_customer_id: customerId,
        plan: "pro",
        billing_event_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .eq("id", data.user.id);

    const payload = event("customer.subscription.deleted", { id: "sub_old", customer: customerId });
    strayIds.push(payload.id);
    try {
      const { res, reportError } = await postWithReporter(payload);
      expect(res.status).toBe(200);
      expect(reportError).not.toHaveBeenCalled();

      const { data: row } = await admin.from("profiles").select("plan").eq("id", data.user.id).single();
      expect((row as { plan: string }).plan).toBe("pro");
    } finally {
      await admin.auth.admin.deleteUser(data.user.id);
    }
  });

  it("reports a completed checkout whose account has since been deleted", async () => {
    const goneUserId = "99999999-9999-4999-8999-999999999999";
    const payload = event("checkout.session.completed", {
      client_reference_id: goneUserId,
      customer: "cus_paid_for_a_ghost",
    });
    strayIds.push(payload.id);
    const { res, reportError } = await postWithReporter(payload);
    expect(res.status).toBe(200);
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        source: "billing.webhook_unmatched",
        event: "checkout.session.completed",
        filter: "id",
        value: goneUserId,
      })
    );
  });
});
