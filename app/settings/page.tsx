import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ManageBillingButton } from "@/components/billing-buttons";
import { DeleteAccountButton } from "@/components/delete-account";
import { PrefsForm } from "@/components/prefs-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { formatDurationLimit, planLimits } from "@/lib/plans";
import type { UserPreferences } from "@/lib/preferences";
import { createClient } from "@/lib/supabase/server";
import { monthlyVideoUsage } from "@/lib/videos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/settings");

  const [{ data: prefs }, { data: profile }] = await Promise.all([
    supabase.from("user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name, credit_me, plan, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const plan = (profile?.plan as string | null) ?? "free";
  const limits = planLimits(plan);
  const usage = await monthlyVideoUsage(user.id, plan);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 sm:px-6 py-10">
        <h1 className="mb-8 text-[17px] font-medium text-text-0">Settings</h1>

        <section className="mb-10">
          <h2 className="eyebrow mb-3">Account</h2>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-text-2">Email</dt>
            <dd className="text-text-0">{user.email}</dd>
            <dt className="text-text-2">Plan</dt>
            <dd className="text-text-0">
              {plan === "pro" ? "Pro" : "Free"}
              {plan === "pro" && profile?.stripe_customer_id ? (
                <span className="ml-3 inline-block align-middle">
                  <ManageBillingButton variant="subtle" />
                </span>
              ) : (
                <Link href="/upgrade" className="ml-3 text-accent hover:underline">
                  Upgrade
                </Link>
              )}
            </dd>
            <dt className="text-text-2">Analyses</dt>
            <dd className="text-text-0">
              {usage.used} of {usage.limit} used in the last 30 days
            </dd>
            <dt className="text-text-2">Limits</dt>
            <dd className="text-text-2">
              Segments up to {formatDurationLimit(limits.maxVideoSeconds)} · every shot in the
              segment analyzed · {limits.exports ? "exports included" : "exports on Pro"}
            </dd>
          </dl>
        </section>

        <section className="mb-10">
          <h2 className="eyebrow mb-3">About you</h2>
          <p className="mb-4 text-[13px] text-text-2">
            Used to pitch recreation advice at the right level and gear. Optional.
          </p>
          <PrefsForm
            initial={(prefs as UserPreferences | null) ?? null}
            profile={{
              display_name: (profile?.display_name as string) ?? "",
              credit_me: !!profile?.credit_me,
            }}
            redirectTo="/settings"
          />
        </section>

        <section className="mb-10 border-t border-line pt-6">
          <h2 className="eyebrow mb-3">Your data</h2>
          <p className="mb-4 text-[13px] leading-relaxed text-text-2">
            Deleting a video permanently removes its source file, every extracted frame and every
            shot detected from it — including shots you added to collections or that others saved.
            Deleting your account does all of that for every video, cancels any subscription, and
            removes the account itself. Neither is reversible.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/videos"
              className="inline-flex h-9 items-center rounded-[3px] border border-line px-3 text-[13px] text-text-0 hover:border-line-strong hover:bg-ink-2"
            >
              Manage videos
            </Link>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-[3px] px-3 text-[13px] text-text-2 hover:text-text-0"
              >
                Sign out
              </button>
            </form>
          </div>
        </section>

        <section className="border-t border-line pt-6">
          <h2 className="eyebrow mb-3">Delete account</h2>
          <DeleteAccountButton email={user.email ?? ""} />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
