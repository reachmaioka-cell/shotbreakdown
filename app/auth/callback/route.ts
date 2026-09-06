import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { trackAsync } from "@/lib/analytics";
import { FEATURES } from "@/lib/features";
import { safeRedirectPath } from "@/lib/safe-url";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set<EmailOtpType>(["magiclink", "signup", "invite", "recovery", "email_change", "email"]);

/**
 * Auth callback for both delivery styles Supabase can use:
 * a PKCE `code`, and a `token_hash` + `type` pair (the server-side email
 * template). Supporting only one silently breaks sign-in when the project or
 * email template is configured the other way.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeRedirectPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const supabase = await createClient();
  let signedIn = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    signedIn = !error;
  } else if (tokenHash && type && OTP_TYPES.has(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    signedIn = !error;
  }

  if (!signedIn) {
    return NextResponse.redirect(`${origin}/auth/login?error=link_expired`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!prefs) {
      trackAsync("signup", { userId: user.id });
      // First sign-in lands in the app rather than the marketing page, unless the
      // user was heading somewhere specific — in which case honour that. The
      // onboarding interstitial is flagged off and 404s, so with the flag down we
      // send people straight to their library; turning FEATURE_ONBOARDING back on
      // restores the interstitial rather than leaving it unreachable.
      const first = FEATURES.onboarding ? "/onboarding" : "/library";
      if (next === "/") return NextResponse.redirect(`${origin}${first}`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
