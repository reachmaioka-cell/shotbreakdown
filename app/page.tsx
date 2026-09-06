import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { JsonLd } from "@/components/json-ld";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { UpgradedBanner } from "@/components/upgraded-banner";
import { getAppUrl } from "@/lib/env";
import { DEPARTMENTS, DEPARTMENT_LABELS } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";

// Reading the session cookie to send signed-in users straight to the app rules
// out static rendering, so the marketing page is dynamic and does no data reads.
export const dynamic = "force-dynamic";

const TAGLINE =
  "Upload a segment of a video and get one breakdown of it, department by department.";

export const metadata: Metadata = {
  title: "ShotBreakdown — break down a segment, department by department",
  description:
    "Upload a segment of a video, say what you want to know about it, and get back what happens in it, how every shot was made and cut, and what each film department has to do to recreate it.",
  alternates: { canonical: getAppUrl() },
  openGraph: {
    type: "website",
    title: "ShotBreakdown",
    description: TAGLINE,
    url: getAppUrl(),
  },
};

const STEPS = [
  {
    n: "01",
    title: "Upload a segment",
    body: "Trim to the part you care about — the scene, the sequence, the ten seconds you keep rewinding.",
  },
  {
    n: "02",
    title: "Say what you want to know",
    body: "Optional. Ask about the lighting, the coverage, the grade, the sound design — or ask nothing and get everything.",
  },
  {
    n: "03",
    title: "Every shot in it is detected and analyzed",
    body: "Shot boundaries are found in the footage itself, then each shot is read for framing, movement, lens, light, colour and cut.",
  },
  {
    n: "04",
    title: "You get one breakdown, department by department",
    body: "Not a pile of per-shot cards. One document for the segment, written for the people who have to make it.",
  },
];

const SECTIONS = [
  {
    title: "Your question, answered first",
    body: "If you asked something, that answer opens the document, in the voice of the department it concerns.",
  },
  {
    title: "What happens",
    body: "Who is in it, where they are, what they do, and what turns. The setting, and how the segment was covered.",
  },
  {
    title: "Every shot, and every cut",
    body: "Shot by shot with timecodes: what happens in it, how it was made, and why the cut into and out of it lands where it does.",
  },
  {
    title: "Shot list, prep and budget",
    body: "A shot list you can hand to a crew, what has to be true before the camera rolls, and three budget tiers from a phone to a funded shoot.",
  },
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/library");

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "ShotBreakdown",
          applicationCategory: "MultimediaApplication",
          operatingSystem: "Web",
          description: TAGLINE,
          url: getAppUrl(),
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }}
      />

      <main id="main" className="flex-1">
        <Suspense fallback={null}>
          <UpgradedBanner />
        </Suspense>

        <section className="border-b border-line">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-14 sm:py-20">
            <div className="max-w-3xl">
              <p className="eyebrow mb-4">Segment breakdowns for film crews</p>
              <h1 className="text-[32px] sm:text-[46px] font-medium leading-[1.08] tracking-tight text-text-0">
                Upload a segment. Get the breakdown
                <br className="hidden sm:block" /> every department needs to recreate it.
              </h1>
              <p className="mt-5 max-w-2xl text-[15px] sm:text-[16px] leading-relaxed text-text-1">
                You upload a segment of a video, say what you want to know about it, and get back
                what happens in it, how every shot was made and cut, and what the director,
                camera, lighting, art, editorial, colour, VFX, sound and production departments
                each have to do.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  href="/upload"
                  className="inline-flex h-11 items-center rounded-[3px] bg-accent px-5 text-[14px] font-medium text-accent-ink hover:brightness-110"
                >
                  Break down a segment
                </Link>
                <Link
                  href="/auth/login"
                  className="inline-flex h-11 items-center rounded-[3px] border border-line px-5 text-[14px] text-text-0 hover:border-line-strong hover:bg-ink-2"
                >
                  Sign in
                </Link>
              </div>
              <p className="mt-3 text-[12px] text-text-3">
                Free to start · no card required · your uploads stay private
              </p>
            </div>
          </div>
        </section>

        <section className="border-b border-line">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-14">
            <h2 className="mb-8 text-[20px] font-medium text-text-0">How it works</h2>
            <ol className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step) => (
                <li key={step.n} className="border-t border-line pt-4">
                  <span className="mono text-[11px] text-accent">{step.n}</span>
                  <h3 className="mt-1.5 text-[15px] font-medium text-text-0">{step.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-text-1">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-b border-line">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-14">
            <h2 className="mb-3 text-[20px] font-medium text-text-0">
              What a breakdown looks like
            </h2>
            <p className="max-w-2xl text-[14px] leading-relaxed text-text-1">
              One document for the whole segment. It opens with what actually happens on screen,
              beat by beat, then walks every shot in the segment — framing, movement, lens
              character, lighting, colour and how it is cut — and then reads the same segment
              again department by department, so the people who have to build it each get their
              own part of the answer.
            </p>
            {/*
              * The shape of the answer, not a sample of one. Writing a
              * convincing fake breakdown here would be the one dishonest thing
              * on the page: everything listed below is a real section of the
              * real output, named from the same vocabulary the pipeline uses.
              */}
            <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr]">
              <ol className="flex flex-col gap-0 border-t border-line">
                {SECTIONS.map((section) => (
                  <li key={section.title} className="border-b border-line py-3">
                    <h3 className="text-[14px] text-text-0">{section.title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-text-2">{section.body}</p>
                  </li>
                ))}
              </ol>

              <div>
                <p className="eyebrow mb-3">And a brief for every department</p>
                <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {DEPARTMENTS.map((role) => (
                    <li
                      key={role}
                      className="flex items-baseline gap-2 border-b border-line py-2 text-[13px] text-text-1"
                    >
                      <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-accent" />
                      {DEPARTMENT_LABELS[role]}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 max-w-lg text-[13px] leading-relaxed text-text-2">
                  Each one gets a headline, ordered steps, the gear with a cheap substitute
                  beside it, and the mistakes that would miss this particular shot. A
                  department with nothing to do says so in one line, which is worth knowing
                  too.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-16 text-center">
            <h2 className="text-[24px] font-medium text-text-0">
              Break down your first segment in a couple of minutes.
            </h2>
            <Link
              href="/upload"
              className="mt-6 inline-flex h-11 items-center rounded-[3px] bg-accent px-6 text-[14px] font-medium text-accent-ink hover:brightness-110"
            >
              Get started
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
