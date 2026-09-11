import { describe, expect, it, vi } from "vitest";
import { isVerified, requireVerifiedUser, verifyEmailResponse } from "@/lib/auth-guard";
import { readCode } from "./read-source";

const session = vi.hoisted(() => ({
  user: null as { id: string; email_confirmed_at?: string } | null,
  profile: { plan: "free", breakdown_count: 2, is_admin: false, display_name: "Ken" } as
    | Record<string, unknown>
    | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: session.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: session.profile }) }) }),
    }),
  }),
}));

/**
 * The guard that stands between a stranger with no inbox and our model bill.
 * Every assertion here fails if the guard is loosened or if a route drops it.
 */

/** The routes that spend on a model or start a Stripe subscription. Any one of them missing the guard is the hole. */
const GUARDED_ROUTES = [
  "app/api/videos/route.ts",
  "app/api/videos/[id]/breakdown/route.ts",
  "app/api/videos/[id]/ai-recreation/route.ts",
  "app/api/videos/[id]/ask/route.ts",
  "app/api/videos/[id]/retry/route.ts",
  "app/api/shots/[id]/recreation-guide/route.ts",
  "app/api/shots/[id]/frame/route.ts",
  // Answers questions about any shot the caller can read, which includes every
  // public one, so an unverified stranger reaches it without owning anything.
  "app/api/shots/[id]/ask/route.ts",
  // Checkout hands Stripe an address we have never emailed; the receipts and
  // every dunning message would go to somebody who never asked for them.
  "app/api/billing/checkout/route.ts",
];

describe("isVerified", () => {
  it("accepts a user with email_confirmed_at", () => {
    expect(isVerified({ email_confirmed_at: "2026-09-11T10:00:00Z" })).toBe(true);
  });

  it("accepts the older confirmed_at alone", () => {
    expect(isVerified({ confirmed_at: "2026-09-11T10:00:00Z" })).toBe(true);
  });

  it("refuses a user with neither field — an unknown shape is not evidence of an inbox", () => {
    expect(isVerified({})).toBe(false);
  });

  it("refuses a user carrying both fields explicitly empty", () => {
    expect(isVerified({ email_confirmed_at: undefined, confirmed_at: undefined })).toBe(false);
  });

  it("refuses null and undefined", () => {
    expect(isVerified(null)).toBe(false);
    expect(isVerified(undefined)).toBe(false);
  });
});

describe("requireVerifiedUser", () => {
  it("lets a confirmed user through", () => {
    expect(requireVerifiedUser({ email_confirmed_at: "2026-09-11T10:00:00Z" })).toBeNull();
  });

  it("refuses an unconfirmed user with 403 verify_email", async () => {
    const response = requireVerifiedUser({});
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    await expect(response!.json()).resolves.toEqual({
      error: "verify_email",
      message: "Confirm your email address first — check your inbox for the link.",
    });
  });

  it("fails closed on a missing user rather than letting the call through", () => {
    expect(requireVerifiedUser(null)).not.toBeNull();
  });
});

describe("verifyEmailResponse", () => {
  it("is the body the upload and segment pages are written against", async () => {
    const body = await verifyEmailResponse().json();
    // Verbatim: the client keys off `error` and prints `message`.
    expect(body.error).toBe("verify_email");
    expect(body.message).toBe(
      "Confirm your email address first — check your inbox for the link."
    );
  });
});

describe("every spending route applies the guard", () => {
  /*
   * Read from the route files rather than executed, so a route added later
   * cannot quietly forget the guard: the list above is the contract, and a new
   * spending route is added to it in the same change that adds the route.
   */
  it.each(GUARDED_ROUTES)("%s imports requireVerifiedUser", (route) => {
    expect(readCode(route)).toMatch(
      /import \{[^}]*requireVerifiedUser[^}]*\} from "@\/lib\/auth-guard"/
    );
  });

  it.each(GUARDED_ROUTES)("%s calls it and returns its response", (route) => {
    const text = readCode(route);
    expect(text).toMatch(
      /^\s*const unverified = requireVerifiedUser\(user\);\s*\n\s*if \(unverified\) return unverified;$/m
    );
  });

  it.each(GUARDED_ROUTES)("%s runs the guard before it spends a rate-limit token", (route) => {
    const text = readCode(route);
    const guardAt = text.indexOf("requireVerifiedUser(user)");
    const limitAt = text.search(/await enforce(Ip)?RateLimit\(/);
    expect(guardAt).toBeGreaterThan(-1);
    // /ask has no rate limit before the guard; the others must not consume one first.
    if (limitAt > -1) expect(guardAt).toBeLessThan(limitAt);
  });
});

describe("the client shows the guard's message, not its code", () => {
  /*
   * "verify_email" on screen is a bug report; the sentence beside it is what a
   * reader can act on. These are the four surfaces that POST to a guarded route.
   */
  it.each([
    ["components/segment/breakdown-status.tsx", /data\.message \?\? data\.error \?\? "Could not start the breakdown/],
    ["components/segment/ai-recreation.tsx", /data\.message \?\? data\.error \?\? "Could not start the AI guide/],
    ["components/segment/refocus-dialog.tsx", /data\.message \?\? data\.error \?\? "Could not start the rewrite/],
    ["components/segment/segment-ask.tsx", /setError\(data\.message \?\? "Could not get an answer/],
    ["components/ask-panel.tsx", /setError\(data\.message \?\? "Could not get an answer/],
  ])("%s prefers the server's message", (file, pattern) => {
    expect(readCode(file)).toMatch(pattern);
  });

  it("the upload form prefers it too", () => {
    expect(readCode("components/upload-form.tsx")).toMatch(
      /setError\(data\.message \?\? data\.error \?\? "Could not start the analysis"\)/
    );
  });
});

describe("/api/me tells the client whether the address is confirmed", () => {
  it("reports verified for a confirmed user and keeps the rest of the shape", async () => {
    session.user = { id: "user-a", email_confirmed_at: "2026-09-11T10:00:00Z" };
    const { GET } = await import("@/app/api/me/route");
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(body.verified).toBe(true);
    // The fields the header, the upload page and the upgrade banner already read.
    expect(Object.keys(body).sort()).toEqual(
      [
        "authed",
        "breakdownCount",
        "breakdownLimit",
        "breakdownRemaining",
        "displayName",
        "isAdmin",
        "isPro",
        "plan",
        "verified",
      ].sort()
    );
  });

  it("reports unverified for an account that never confirmed", async () => {
    session.user = { id: "user-b" };
    const { GET } = await import("@/app/api/me/route");
    const body = (await (await GET()).json()) as { verified: boolean };
    expect(body.verified).toBe(false);
  });

  it("says nothing about verification when nobody is signed in", async () => {
    session.user = null;
    const { GET } = await import("@/app/api/me/route");
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(body).toEqual({ authed: false });
  });
});
