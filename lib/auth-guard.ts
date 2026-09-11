import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * A caller who has never received an email from us is not allowed to spend.
 *
 * Supabase can be configured to hand a password sign-up a session before the
 * address is confirmed — verified against production on 2026-09-11, where
 * `POST /auth/v1/signup` for a domain that does not exist returned an access
 * token — and every plan limit is per account, so an unverified account is an
 * unbounded model budget. The app's own sign-in is magic-link only, and
 * verifying an OTP *is* confirmation, so this only ever refuses the raw
 * password path.
 *
 * The dashboard toggle ("Confirm email") closes the same hole. This guard
 * exists so the guarantee does not depend on that toggle staying set.
 */

/** The fields of a Supabase user this decision reads. */
type VerifiableUser = Pick<User, "email_confirmed_at" | "confirmed_at">;

/**
 * Fails closed: a user object carrying neither timestamp is unverified. Older
 * Supabase versions set only `confirmed_at`, current ones set both, and a shape
 * we do not recognise is not evidence that an inbox was reached.
 */
export function isVerified(user: VerifiableUser | null | undefined): boolean {
  if (!user) return false;
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

/** The one 403 every spending route returns. Shape is part of the client contract. */
export function verifyEmailResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "verify_email",
      message: "Confirm your email address first — check your inbox for the link.",
    },
    { status: 403 }
  );
}

/**
 * Guard a spending route. Returns the 403 to return early, or null to continue,
 * the same shape as `enforceRateLimit` so a route reads as a list of gates.
 *
 * Takes the user the route already fetched rather than re-reading the session:
 * `getUser()` is a network call to Supabase, and every caller has its own copy
 * for the unauthenticated case. Call it straight after that check and before
 * any rate limit, so an unverified caller does not spend a bucket token either.
 */
export function requireVerifiedUser(user: VerifiableUser | null | undefined): NextResponse | null {
  return isVerified(user) ? null : verifyEmailResponse();
}
