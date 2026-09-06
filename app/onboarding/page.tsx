import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false, follow: false },
};

/**
 * Onboarding is one screen and one action. The activation moment is a first
 * successful analysis, not a profile form — preferences live in Settings and
 * only sharpen recreation advice later.
 */
export default async function OnboardingPage() {
  if (!FEATURES.onboarding) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/onboarding");

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 sm:px-6 py-16">
        <p className="eyebrow mb-3">Welcome to ShotBreakdown</p>
        <h1 className="text-[26px] font-medium leading-tight text-text-0">
          Turn videos into searchable cinematography references.
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-text-1">
          Upload a video and every shot in it is detected, framed and analyzed — camera, lens,
          lighting, colour, environment and mood — then indexed so you can search it by how it
          looks.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/upload"
            className="inline-flex h-11 items-center rounded-[3px] bg-accent px-5 text-[14px] font-medium text-accent-ink hover:brightness-110"
          >
            Analyze your first video
          </Link>
          <Link
            href="/library"
            className="inline-flex h-11 items-center rounded-[3px] border border-line px-5 text-[14px] text-text-0 hover:border-line-strong hover:bg-ink-2"
          >
            Browse the library first
          </Link>
        </div>

        <p className="mt-6 text-[12px] text-text-3">
          You can tell us about your kit later in{" "}
          <Link href="/settings" className="underline hover:text-text-1">
            Settings
          </Link>{" "}
          — it sharpens recreation advice, and nothing needs it to work.
        </p>
      </main>
    </div>
  );
}
