import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { UploadForm } from "@/components/upload-form";
import { FEATURES } from "@/lib/features";
import { formatDurationLimit, planLimits } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { monthlyVideoUsage } from "@/lib/videos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Break down a segment",
  description:
    "Upload a segment of a video and ShotBreakdown detects the shots inside it and analyzes the cinematography of each one.",
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
        <h1 className="text-[19px] font-medium text-text-0">Break down a segment</h1>
        <p className="mt-2 mb-8 text-[14px] leading-relaxed text-text-1">
          Upload a segment — the hook, one take, a handful of cuts — rather than a whole film. Trim
          it to the part you care about, up to {formatDurationLimit(limits.maxVideoSeconds)}, and say
          what you want to know about it. You get one breakdown of that segment: what happens, how
          it was shot and cut, and what each department has to do to make it. You can close this
          tab; processing continues on the server.
        </p>

        <UploadForm
          limits={limits}
          authed={!!user}
          remaining={user ? remaining : limits.videosPerMonth}
          linkSourcesEnabled={FEATURES.linkSources}
          stillUploadsEnabled={FEATURES.stillUploads}
        />

        <section className="mt-12 border-t border-line pt-6">
          <h2 className="eyebrow mb-3">What happens next</h2>
          <ol className="flex flex-col gap-2.5 text-[13px] text-text-1">
            <li className="flex gap-3">
              <span className="mono text-text-3">01</span>
              The segment you chose is cut from your file and its shot boundaries are detected.
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
              The breakdown is written for the segment as a whole, department by department, and
              it answers what you asked.
            </li>
            <li className="flex gap-3">
              <span className="mono text-text-3">05</span>
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
