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

function event(type: string, object: Record<string, unknown>, id?: string) {
  const eventId = id ?? `evt_test_${Date.now()}_${counter++}`;
  if (!eventIds.includes(eventId)) eventIds.push(eventId);
  return {
    id: eventId,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: Math.floor(Date.now() / 1000),
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

  async function setPlan(plan: "free" | "pro", proSince: string | null = null) {
    const { error } = await admin
      .from("profiles")
      .update({ plan, pro_since: proSince })
      .eq("id", userId);
    if (error) throw new Error(error.message);
  }

  async function profile() {
    const { data, error } = await admin
      .from("profiles")
      .select("plan, pro_since, stripe_customer_id")
      .eq("id", userId)
      .single();
    if (error) throw new Error(error.message);
    return data as { plan: string; pro_since: string | null; stripe_customer_id: string | null };
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
