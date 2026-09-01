import Stripe from "stripe";

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
