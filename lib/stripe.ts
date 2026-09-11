import Stripe from "stripe";
import { reportError } from "@/lib/errors";
import { PRO_PRICE_USD_MONTHLY } from "@/lib/plans";

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function checkoutConfigured(): boolean {
  return stripeConfigured() && Boolean(process.env.STRIPE_PRICE_ID);
}

/** Lazy so importing this module does not throw when keys are missing. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  if (!client) {
    client = new Stripe(key);
  }
  return client;
}

/** Cents the pricing page promises. Stripe amounts are integers, not dollars. */
export const PRO_PRICE_UNIT_AMOUNT = PRO_PRICE_USD_MONTHLY * 100;

/**
 * Does the live Price charge what the pricing page says it charges?
 *
 * Split out from the retrieve so the comparison itself is testable without a
 * Stripe key: this is the rule, `assertPriceMatches` is the plumbing.
 */
export function priceMatchesPlan(price: Pick<Stripe.Price, "unit_amount" | "recurring">): boolean {
  return price.unit_amount === PRO_PRICE_UNIT_AMOUNT && price.recurring?.interval === "month";
}

/*
 * How long a definite answer is trusted before Stripe is asked again.
 *
 * The verdict used to be cached for the life of the process, which made a
 * mismatch a deploy-to-clear condition: someone corrects the Price in the
 * dashboard, and every running instance goes on refusing checkout until it
 * happens to be replaced. So the cache is a TTL, and the two TTLs differ
 * because the two states are not alike. A match is the steady state and stays
 * cached long enough that the common path costs nothing — one call per
 * instance per ten minutes, not one per checkout. A mismatch is an outage
 * somebody is actively standing in the dashboard fixing, so it is re-checked
 * within the minute; the cost of being wrong in that direction is a refused
 * sale, and the cost of the extra call is nothing, because nobody is buying
 * while it is refused.
 */
export const PRICE_MATCH_TTL_MS = 10 * 60 * 1000;
export const PRICE_MISMATCH_TTL_MS = 60 * 1000;

/*
 * The Price is configuration, not per-request data. A definite answer is
 * cached until it expires; a failed retrieve is not cached at all, so a blip
 * does not pin the wrong answer.
 */
let priceVerdict: { priceId: string; matches: boolean; expiresAt: number } | null = null;

/**
 * True when checkout may proceed.
 *
 * False only on a *definite* mismatch — the Price exists and charges something
 * other than what the page showed. A network failure or a Stripe outage
 * returns true: refusing every upgrade because we could not reach Stripe costs
 * more than the risk it would avoid, and Checkout itself would fail loudly a
 * moment later anyway.
 */
export async function assertPriceMatches(): Promise<boolean> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) return true;
  if (priceVerdict?.priceId === priceId && Date.now() < priceVerdict.expiresAt) {
    return priceVerdict.matches;
  }

  let price: Stripe.Price;
  try {
    price = await getStripe().prices.retrieve(priceId);
  } catch (e) {
    reportError(e, { source: "billing.price_check_unavailable", priceId });
    return true;
  }

  const matches = priceMatchesPlan(price);
  if (!matches) {
    reportError(
      new Error("Stripe Price does not match the advertised plan"),
      {
        source: "billing.price_mismatch",
        priceId,
        expectedUnitAmount: PRO_PRICE_UNIT_AMOUNT,
        actualUnitAmount: price.unit_amount ?? "null",
        actualInterval: price.recurring?.interval ?? "none",
      }
    );
  }
  priceVerdict = {
    priceId,
    matches,
    expiresAt: Date.now() + (matches ? PRICE_MATCH_TTL_MS : PRICE_MISMATCH_TTL_MS),
  };
  return matches;
}
