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
 * One answer per process. The Price is a piece of configuration that changes
 * when someone edits it in the dashboard, not per request, and a redeploy
 * re-reads it. A definite answer is cached; a failed retrieve is not, so a
 * blip does not pin the wrong answer for the life of the instance.
 */
let priceVerdict: { priceId: string; matches: boolean } | null = null;

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
  if (priceVerdict?.priceId === priceId) return priceVerdict.matches;

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
  priceVerdict = { priceId, matches };
  return matches;
}
