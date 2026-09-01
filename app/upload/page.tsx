import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { UploadForm } from "@/components/upload-form";
import { planLimits } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { monthlyVideoUsage } from "@/lib/videos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Analyze a video",
  description:
    "Upload a video and ShotBreakdown detects every shot, picks the strongest frame, and analyzes the cinematography of each one.",
  robots: { index: false, follow: true },
};

export default async function UploadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let plan: string | null = null;
  let remaining = 0;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();
    plan = (profile?.plan as string | null) ?? "free";
    const usage = await monthlyVideoUsage(user.id, plan);
    remaining = usage.remaining;
  }

  const limits = planLimits(plan);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main id="main" className="flex-1 w-full mx-auto max-w-2xl px-4 sm:px-6 py-12">
        <h1 className="text-[19px] font-medium text-text-0">Analyze a video</h1>
        <p className="mt-2 mb-8 text-[14px] leading-relaxed text-text-1">
          ShotBreakdown detects every shot, picks the strongest frame from each, and analyzes the
          cinematography — camera, lens, lighting, colour, environment and mood. You can close this
          tab; processing continues on the server.
        </p>

        <UploadForm limits={limits} authed={!!user} remaining={user ? remaining : limits.videosPerMonth} />

        <section className="mt-12 border-t border-line pt-6">
          <h2 className="eyebrow mb-3">What happens next</h2>
          <ol className="flex flex-col gap-2.5 text-[13px] text-text-1">
            <li className="flex gap-3">
              <span className="mono text-text-3">01</span>
              Shot boundaries are detected from the footage itself.
            </li>
            <li className="flex gap-3">
              <span className="mono text-text-3">02</span>
              Candidate frames are extracted from each shot and the strongest is chosen.
            </li>
            <li className="flex gap-3">
              <span className="mono text-text-3">03</span>
              Each shot is analyzed and indexed for search.
            </li>
            <li className="flex gap-3">
              <span className="mono text-text-3">04</span>
              Your shots appear in{" "}
              <Link href="/library?scope=mine" className="text-accent hover:underline">
                My shots
              </Link>
              .
            </li>
          </ol>
          <p className="mt-5 text-[12px] leading-relaxed text-text-3">
            Only upload footage you have the right to use. Camera, lens and lighting values are
            estimates from image analysis, not verified production data.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
