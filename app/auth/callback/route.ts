import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { trackAsync } from "@/lib/analytics";
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
      // First sign-in goes to onboarding, unless the user was heading somewhere
      // specific — in which case honour that and let them onboard later.
      if (next === "/") return NextResponse.redirect(`${origin}/onboarding`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
