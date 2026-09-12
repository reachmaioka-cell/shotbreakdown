import type { Metadata } from "next";
import Link from "next/link";
import { ManageBillingButton, UpgradeButton } from "@/components/billing-buttons";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { PLANS, PRO_PRICE_USD_MONTHLY, formatBytes, formatDurationLimit } from "@/lib/plans";
import { checkoutConfigured } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Built from the plans rather than written out, because a description that
// quotes a price or an allowance is the surface that goes stale first.
export const metadata: Metadata = {
  title: "Pricing",
  description: `ShotBreakdown pricing. Start free with ${PLANS.free.videosPerMonth} segment analyses a month, up to ${formatDurationLimit(PLANS.free.maxVideoSeconds)} each; Pro is $${PRO_PRICE_USD_MONTHLY} a month for ${PLANS.pro.videosPerMonth}, with exports and priority processing.`,
};

function Feature({ children, included = true }: { children: React.ReactNode; included?: boolean }) {
  return (
    <li className="flex items-start gap-2 text-[13px] leading-relaxed">
      <span
        aria-hidden
        className={`mt-[3px] inline-block h-3 w-3 shrink-0 ${included ? "text-accent" : "text-text-3"}`}
      >
        {included ? "✓" : "·"}
      </span>
      <span className={included ? "text-text-1" : "text-text-3"}>{children}</span>
    </li>
  );
}

export default async function UpgradePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let plan: string | null = null;
  let customerId: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();
    plan = (profile?.plan as string | null) ?? "free";
    customerId = (profile?.stripe_customer_id as string | null) ?? null;
  }

  const isPro = plan === "pro";
  const free = PLANS.free;
  const pro = PLANS.pro;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6 py-12">
        <h1 className="text-[24px] font-medium text-text-0">Pricing</h1>
        <p className="mt-2 mb-10 text-[14px] text-text-1">
          Start free. Upgrade when a project needs more breakdowns a month, exports or priority
          processing.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-[3px] border border-line bg-ink-1 p-5">
            <h2 className="text-[14px] font-medium text-text-0">Free</h2>
            <p className="mt-2 text-[26px] font-medium text-text-0">
              $0<span className="text-[13px] font-normal text-text-2"> / month</span>
            </p>
            <ul className="mt-5 flex flex-col gap-2">
              <Feature>{free.videosPerMonth} segment analyses per month</Feature>
              <Feature>Segments up to {formatDurationLimit(free.maxVideoSeconds)}</Feature>
              <Feature>Every shot in the segment analyzed</Feature>
              <Feature>Uploads to {formatBytes(free.maxUploadBytes)}</Feature>
              <Feature>Semantic search and Find Similar</Feature>
              <Feature>{free.maxSavedShots} saved shots · {free.maxCollections} collections</Feature>
              <Feature>Sharing links</Feature>
              <Feature included={false}>PDF, CSV and JSON export</Feature>
              <Feature included={false}>Priority processing</Feature>
            </ul>
            {!user ? (
              <Link
                href="/auth/login?next=/upload"
                className="mt-6 inline-flex h-10 items-center rounded-[3px] border border-line px-4 text-[13px] text-text-0 hover:border-line-strong hover:bg-ink-2"
              >
                Start free
              </Link>
            ) : (
              <p className="mt-6 text-[12px] text-text-3">
                {isPro ? "Included in Pro" : "Your current plan"}
              </p>
            )}
          </section>

          <section className="rounded-[3px] border border-accent/40 bg-accent/[0.04] p-5">
            <h2 className="text-[14px] font-medium text-accent">Pro</h2>
            <p className="mt-2 text-[26px] font-medium text-text-0">
              ${PRO_PRICE_USD_MONTHLY}
              <span className="text-[13px] font-normal text-text-2"> / month</span>
            </p>
            <ul className="mt-5 flex flex-col gap-2">
              <Feature>{pro.videosPerMonth} segment analyses per month</Feature>
              <Feature>Segments up to {formatDurationLimit(pro.maxVideoSeconds)}</Feature>
              <Feature>Every shot in the segment analyzed</Feature>
              <Feature>Uploads to {formatBytes(pro.maxUploadBytes)}</Feature>
              <Feature>Semantic search and Find Similar</Feature>
              <Feature>Unlimited saved shots and collections</Feature>
              <Feature>PDF contact sheets, CSV and JSON export</Feature>
              <Feature>Priority processing</Feature>
            </ul>

            <div className="mt-6">
              {isPro ? (
                customerId ? (
                  <ManageBillingButton />
                ) : (
                  <p className="text-[13px] text-text-1">You&apos;re on Pro.</p>
                )
              ) : !user ? (
                <Link
                  href="/auth/login?next=/upgrade"
                  className="inline-flex h-10 items-center rounded-[3px] bg-accent px-4 text-[13px] font-medium text-accent-ink hover:brightness-110"
                >
                  Sign in to upgrade
                </Link>
              ) : checkoutConfigured() ? (
                <UpgradeButton />
              ) : (
                // No half-working payment path: a link that takes money without
                // granting entitlement is worse than no link.
                <a
                  href="mailto:hello@shotbreakdown.app?subject=ShotBreakdown%20Pro"
                  className="inline-flex h-10 items-center rounded-[3px] border border-accent/50 px-4 text-[13px] text-accent hover:bg-accent/10"
                >
                  Contact us to upgrade
                </a>
              )}
            </div>
          </section>
        </div>

        <p className="mt-8 text-[13px] leading-relaxed text-text-1">
          Both plans analyze a segment of up to {formatDurationLimit(pro.maxVideoSeconds)}. That is
          the unit: a breakdown names every shot inside it — what happens, how it was shot and cut,
          and what each department has to do — which is an answer about one take or one hook, not
          about a whole film.
        </p>

        <p className="mt-4 text-[12px] leading-relaxed text-text-3">
          Limits are enforced on the server. Cancel any time from Settings; cancelling stops future
          charges and keeps everything you have already analyzed. By subscribing you agree to the{" "}
          <Link href="/terms" className="text-text-2 hover:text-text-0">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-text-2 hover:text-text-0">
            Privacy Policy
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
