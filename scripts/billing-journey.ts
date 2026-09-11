/**
 * The money path, once, for real, in Stripe test mode.
 *
 * Signs in as a local user, creates a Checkout Session through the real route,
 * pays with a test card, and then asks the database whether the webhook
 * actually granted Pro — then cancels and asks again. Nothing here is stubbed:
 * if it passes, a card can buy the product and get it, and cancelling takes it
 * away. `tests/billing.test.ts` proves the handler in isolation; this proves
 * the wiring between Stripe, the routes, the webhook and the profile row.
 *
 * What it needs, none of it optional:
 *
 *   1. A *secret* test key: STRIPE_SECRET_KEY=sk_test_… in .env.local.
 *      A restricted key (rk_test_…) may or may not carry the scopes this uses,
 *      so the script refuses one rather than half-failing later.
 *   2. STRIPE_PRICE_ID pointing at a test-mode recurring Price for the amount
 *      /upgrade advertises. The preflight checks that through the same
 *      assertPriceMatches() the checkout route uses.
 *   3. The Stripe CLI forwarding events, in its own terminal, for the whole run:
 *
 *        stripe listen --forward-to 127.0.0.1:3002/api/webhooks/stripe
 *
 *      It prints a signing secret. Put that in .env.local as
 *      STRIPE_WEBHOOK_SECRET and restart `npm run dev`, or every event is
 *      rejected as an invalid signature and nothing ever becomes Pro.
 *   4. `npm run dev` (127.0.0.1:3002) and the local Supabase stack running.
 *   5. For the default browser path, Google Chrome — Checkout is a hosted page,
 *      so it is filled through the devtools protocol.
 *
 *   npx tsx --env-file=.env.local scripts/billing-journey.ts [baseUrl] [--api-card]
 *
 * `--api-card` skips the browser and subscribes the customer through the API
 * with a test payment method. Checkout's hosted page renders its card fields
 * inside js.stripe.com iframes behind an hCaptcha, and headless Chrome does not
 * always get that far; the events the subscription then fires are the same ones
 * a real payment fires, so the half this script exists to prove — webhook to
 * entitlement — is still proven. The browser path additionally proves that the
 * session the route built is payable and returns to /?upgraded=1.
 *
 * Test mode only, by construction: a live key is refused.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createAdminClient } from "../lib/supabase/admin";
import { assertPriceMatches, getStripe } from "../lib/stripe";

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3002";
const API_CARD = process.argv.includes("--api-card");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9342;
const TEST_CARD = "4242424242424242";
/** The webhook is usually there in under a second; this is the patience limit. */
const ENTITLEMENT_TIMEOUT_MS = 30_000;

let passed = 0;
let failed = 0;

function step(name: string) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    console.log(
      `  \x1b[31m✗ ${name}\x1b[0m${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`
    );
  }
}
function note(text: string) {
  console.log(`  \x1b[2m· ${text}\x1b[0m`);
}
function stop(reason: string): never {
  console.error(`\n\x1b[31m${reason}\x1b[0m\n`);
  process.exit(1);
}

/** Cookie-carrying fetch against the dev server, same as the other journeys. */
class Session {
  private cookies = new Map<string, string>();
  private absorb(res: Response) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      if (i === -1) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === "" || /Max-Age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  get authed(): boolean {
    return [...this.cookies.keys()].some((k) => k.startsWith("sb-"));
  }
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.set("cookie", cookie);
    const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
    this.absorb(res);
    return res;
  }
  async follow(path: string, hops = 5): Promise<Response> {
    let res = await this.fetch(path);
    let next = res.headers.get("location");
    while (next && hops-- > 0) {
      const url = next.startsWith("http") ? new URL(next).pathname + new URL(next).search : next;
      res = await this.fetch(url);
      next = res.headers.get("location");
    }
    return res;
  }
}

/**
 * Headless Chrome over the devtools protocol — the screenshot helper's shape
 * with typing and clicking added.
 *
 * Two things about Checkout drive the design. Its card fields live in
 * js.stripe.com iframes, not in the page, so every evaluation has to be able to
 * name a frame's execution context; and with site isolation on, those frames
 * are separate targets whose contexts never appear here at all, which is why
 * the process flags below turn it off. Measured on 2026-09-11: 2 contexts with
 * isolation on, 18 with it off.
 */
class Browser {
  private ws!: WebSocket;
  private chrome!: ReturnType<typeof spawn>;
  private nextId = 0;
  private pending = new Map<number, (m: Record<string, unknown>) => void>();
  private contexts: number[] = [];

  async launch(profileDir: string) {
    if (!existsSync(CHROME)) stop(`Google Chrome not found at ${CHROME}`);
    this.chrome = spawn(
      CHROME,
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--disable-site-isolation-trials",
        "--disable-features=IsolateOrigins,site-per-process",
        "--window-size=1280,1400",
        "about:blank",
      ],
      { stdio: "ignore" }
    );
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break;
      } catch {
        // Chrome is still starting.
      }
      await sleep(250);
    }
    const target = (await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })
    ).json()) as { webSocketDebuggerUrl: string };
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("could not attach to Chrome"));
    });
    this.ws.onmessage = (ev) => {
      const message = JSON.parse(String(ev.data)) as {
        id?: number;
        method?: string;
        params?: { context?: { id: number } };
      };
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)!(message as Record<string, unknown>);
        this.pending.delete(message.id);
        return;
      }
      if (message.method === "Runtime.executionContextCreated" && message.params?.context) {
        this.contexts.push(message.params.context.id);
      } else if (message.method === "Runtime.executionContextsCleared") {
        this.contexts = [];
      }
    };
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  /** Evaluate in the page, or in one frame when a context is named. */
  async evaluate<T>(expression: string, contextId?: number): Promise<T | undefined> {
    const response = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...(contextId === undefined ? {} : { contextId }),
    })) as { result?: { result?: { value?: T } } };
    return response.result?.result?.value;
  }

  async goto(url: string) {
    await this.send("Page.navigate", { url });
    await sleep(3000);
  }

  async url(): Promise<string> {
    return (await this.evaluate<string>("location.href")) ?? "";
  }

  /** The first (context, selector) pair that exists anywhere in the page. */
  async findField(
    selectors: string[],
    timeoutMs = 25_000
  ): Promise<{ contextId: number; selector: string } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const contextId of [undefined, ...this.contexts]) {
        for (const selector of selectors) {
          const found = await this.evaluate<boolean>(
            `!!document.querySelector(${JSON.stringify(selector)})`,
            contextId
          );
          if (found) return { contextId: contextId ?? 0, selector };
        }
      }
      await sleep(500);
    }
    return null;
  }

  async waitForUrl(match: RegExp, timeoutMs = 90_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (match.test(await this.url())) return true;
      await sleep(500);
    }
    return false;
  }

  /**
   * Type the way a person does. The fields are React-controlled and often in
   * another frame, so the value cannot be assigned: focus the element in its
   * own context, then let the browser deliver the keystrokes.
   */
  async type(field: { contextId: number; selector: string }, text: string) {
    await this.evaluate(
      `document.querySelector(${JSON.stringify(field.selector)})?.focus()`,
      field.contextId || undefined
    );
    await sleep(150);
    await this.send("Input.insertText", { text });
    await sleep(150);
  }

  async click(field: { contextId: number; selector: string }) {
    await this.evaluate(
      `document.querySelector(${JSON.stringify(field.selector)})?.click()`,
      field.contextId || undefined
    );
    await sleep(2500);
  }

  /** Click the first button or link whose text matches. Stripe renames ids; the words are steadier. */
  async clickByText(pattern: RegExp): Promise<boolean> {
    for (const contextId of [undefined, ...this.contexts]) {
      const clicked = await this.evaluate<boolean>(
        `(() => {
          const re = ${pattern.toString()};
          const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
          const hit = nodes.find((n) => re.test((n.textContent || '').trim()));
          if (!hit) return false;
          hit.click();
          return true;
        })()`,
        contextId
      );
      if (clicked) {
        await sleep(2500);
        return true;
      }
    }
    return false;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Already gone.
    }
    this.chrome.kill();
  }
}

async function waitForPlan(userId: string, want: "pro" | "free"): Promise<boolean> {
  const admin = createAdminClient();
  const deadline = Date.now() + ENTITLEMENT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data } = await admin.from("profiles").select("plan").eq("id", userId).maybeSingle();
    if (data?.plan === want) return true;
    await sleep(1000);
  }
  return false;
}

function preflight() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) stop("STRIPE_SECRET_KEY is not set. This script needs a test-mode secret key.");
  if (key.startsWith("rk_")) {
    stop(
      "STRIPE_SECRET_KEY is a restricted key (rk_…). It may not carry the subscription and\n" +
        "customer scopes this journey uses, so the run would fail somewhere in the middle with\n" +
        "a permissions error instead of a result. Put a test-mode secret key (sk_test_…) in\n" +
        ".env.local: Stripe dashboard → Test mode → Developers → API keys → Secret key."
    );
  }
  if (key.startsWith("sk_live_")) {
    stop("STRIPE_SECRET_KEY is a LIVE key. This script pays with a test card; it never runs live.");
  }
  if (!key.startsWith("sk_test_")) stop(`STRIPE_SECRET_KEY is not a test secret key (${key.slice(0, 8)}…).`);
  if (!process.env.STRIPE_PRICE_ID) stop("STRIPE_PRICE_ID is not set.");
  if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
    stop(
      "STRIPE_WEBHOOK_SECRET is missing or not a signing secret. Run\n" +
        `  stripe listen --forward-to ${BASE.replace(/^https?:\/\//, "")}/api/webhooks/stripe\n` +
        "and put the whsec_… it prints into .env.local, then restart the dev server."
    );
  }
}

/**
 * Pay the session in the browser, the way a customer does.
 * Returns false when the hosted page could not be driven; the caller says so
 * rather than pretending the leg passed.
 */
async function payInBrowser(browser: Browser, checkoutUrl: string): Promise<boolean> {
  await browser.launch(`${process.env.TMPDIR ?? "/tmp/"}billing-journey-chrome`);
  await browser.goto(checkoutUrl);

  const email = await browser.findField(["#email", "input[name='email']"], 8_000);
  if (email) await browser.type(email, `journey+${Date.now()}@shotbreakdown.test`);

  const cardTab = await browser.findField(["#payment-method-accordion-item-title-card"], 5_000);
  if (cardTab) await browser.click(cardTab);

  const number = await browser.findField([
    "#cardNumber",
    "input[name='cardNumber']",
    "#Field-numberInput",
    "input[name='number']",
  ]);
  if (!number) {
    check("Checkout rendered its card field", false, await browser.url());
    return false;
  }
  await browser.type(number, TEST_CARD);

  const expiry = await browser.findField(["#cardExpiry", "#Field-expiryInput", "input[name='expiry']"], 5_000);
  if (expiry) await browser.type(expiry, `12${String(new Date().getFullYear() + 2).slice(2)}`);
  const cvc = await browser.findField(["#cardCvc", "#Field-cvcInput", "input[name='cvc']"], 5_000);
  if (cvc) await browser.type(cvc, "123");
  const name = await browser.findField(["#billingName", "#Field-nameInput"], 3_000);
  if (name) await browser.type(name, "Billing Journey");

  if (!(await browser.clickByText(/^(Subscribe|Pay|Start trial)/i))) {
    check("Checkout offered a pay button", false, await browser.url());
    return false;
  }
  check("the card was entered and submitted", true);
  return true;
}

/** Subscribe through the API with a test payment method — same events, no browser. */
async function payThroughApi(customerId: string) {
  const stripe = getStripe();
  const method = await stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: method.id },
  });
  await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: process.env.STRIPE_PRICE_ID! }],
  });
}

async function main() {
  preflight();

  const admin = createAdminClient();
  const stripe = getStripe();
  const email = `billing-journey+${Date.now()}@shotbreakdown.test`;
  const browser = new Browser();
  let browserLaunched = false;
  let userId = "";
  let customerId: string | null = null;

  try {
    step("1. Preflight");
    const health = await fetch(`${BASE}/api/webhooks/stripe`, { method: "POST" });
    check("the webhook route is up and configured (400, not 503)", health.status === 400, {
      status: health.status,
      body: await health.text(),
    });
    check("the live Price is the one /upgrade advertises", await assertPriceMatches());

    step("2. Sign in the way a real user does");
    const { data: created, error: userError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (userError || !created.user) throw new Error(`createUser: ${userError?.message}`);
    userId = created.user.id;
    const { data: link } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${BASE}/auth/callback` },
    });
    const session = new Session();
    await session.follow(`/auth/callback?token_hash=${link!.properties!.hashed_token}&type=magiclink`);
    check("session established", session.authed);

    step("3. Start a subscription through the real checkout route");
    const checkout = await session.fetch("/api/billing/checkout", { method: "POST" });
    const checkoutBody = (await checkout.json()) as { url?: string; error?: string };
    check(
      "POST /api/billing/checkout returns a session url",
      checkout.status === 200 && !!checkoutBody.url,
      { status: checkout.status, body: checkoutBody }
    );
    if (!checkoutBody.url) throw new Error("no checkout url; nothing further can be proven");

    step("4. Pay with a test card");
    if (API_CARD) {
      note("--api-card: subscribing through the API, so this run proves the webhook, not the page");
      const customer = await stripe.customers.create({ email, metadata: { user_id: userId } });
      customerId = customer.id;
      const { error: mapError } = await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);
      if (mapError) throw new Error(`map customer: ${mapError.message}`);
      await payThroughApi(customerId);
      check("the subscription was created and paid", true);
    } else {
      browserLaunched = true;
      const paid = await payInBrowser(browser, checkoutBody.url);
      if (!paid) {
        note("Checkout could not be driven headlessly — rerun with --api-card to prove the webhook");
        throw new Error("the hosted page was not payable in this browser");
      }
      check(
        "the card cleared and Stripe returned us to /?upgraded=1",
        await browser.waitForUrl(/\/\?upgraded=1/),
        await browser.url()
      );
    }

    step("5. The webhook grants what was paid for");
    check(
      `profiles.plan is 'pro' within ${ENTITLEMENT_TIMEOUT_MS / 1000}s`,
      await waitForPlan(userId, "pro")
    );
    const me = (await (await session.fetch("/api/me")).json()) as { plan?: string };
    check("/api/me agrees, so the success banner stops saying 'activating'", me.plan === "pro", me);

    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id, pro_since")
      .eq("id", userId)
      .maybeSingle();
    customerId = (profile?.stripe_customer_id as string | null) ?? customerId;
    check("the customer id and pro_since were recorded", !!customerId && !!profile?.pro_since, profile);

    step("6. Cancel, the way a customer does");
    const portal = await session.fetch("/api/billing/portal", { method: "POST" });
    const portalBody = (await portal.json()) as { url?: string; error?: string };
    check(
      "POST /api/billing/portal returns a url (the portal is configured in the dashboard)",
      portal.status === 200 && !!portalBody.url,
      { status: portal.status, body: portalBody }
    );

    let cancelled = false;
    if (portalBody.url && browserLaunched) {
      await browser.goto(portalBody.url);
      if (await browser.clickByText(/^Cancel (plan|subscription)$/i)) {
        cancelled = await browser.clickByText(/^(Cancel (plan|subscription)|Confirm)$/i);
      }
      check("the portal took the cancellation", cancelled, await browser.url());
    }

    if (!cancelled && customerId) {
      /*
       * The portal's markup is Stripe's and changes; what this step is for is
       * the entitlement, not their DOM. Cancel through the API instead and say
       * so, rather than reporting a pass we did not get.
       */
      note("cancelling through the API so the downgrade is still proven");
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
      for (const sub of subs.data) {
        if (sub.status !== "canceled") await stripe.subscriptions.cancel(sub.id);
      }
    }

    step("7. Cancelling takes the entitlement away");
    check(
      `profiles.plan is back to 'free' within ${ENTITLEMENT_TIMEOUT_MS / 1000}s`,
      await waitForPlan(userId, "free")
    );
  } finally {
    if (browserLaunched) browser.close();
    if (customerId) {
      const subs = await stripe.subscriptions
        .list({ customer: customerId, status: "all", limit: 10 })
        .catch(() => null);
      for (const sub of subs?.data ?? []) {
        if (sub.status !== "canceled") await stripe.subscriptions.cancel(sub.id).catch(() => {});
      }
    }
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(
    `\n${failed === 0 ? "\x1b[32m✓" : "\x1b[31m✗"} ${passed} passed, ${failed} failed\x1b[0m\n`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
