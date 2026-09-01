import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { JsonLd } from "@/components/json-ld";
import { ShotTile } from "@/components/shot-tile";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { UpgradedBanner } from "@/components/upgraded-banner";
import { getAppUrl } from "@/lib/env";
import { searchShots, shotHref } from "@/lib/shots";
import { TAXONOMY_GROUPS } from "@/lib/taxonomy";

export const revalidate = 600;

const TAGLINE = "Turn any video into a searchable cinematography reference library.";

export const metadata: Metadata = {
  title: "ShotBreakdown — searchable cinematography references from your own footage",
  description:
    "Upload a video. ShotBreakdown detects every shot, picks the strongest frame, analyzes the camera, lens, lighting, colour and mood, and turns it into a searchable visual reference library.",
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
    title: "Upload a video",
    body: "Drop in a cut, a rushes reel, a music video, a spot. Up to 30 minutes on Pro.",
  },
  {
    n: "02",
    title: "Every shot is detected",
    body: "Shot boundaries are found in the footage itself — not guessed from a thumbnail.",
  },
  {
    n: "03",
    title: "The strongest frame is chosen",
    body: "Candidate frames are extracted from each shot and scored for clarity and framing. Override it whenever you disagree.",
  },
  {
    n: "04",
    title: "The cinematography is analyzed",
    body: "Camera move, shot size, angle, lens character, lighting scheme, palette, environment, subject and mood — per shot.",
  },
  {
    n: "05",
    title: "Search it like a library",
    body: "“Slow dolly in.” “Moody nighttime portrait.” “Hard side light, commercial.” Meaning, not keywords.",
  },
  {
    n: "06",
    title: "Collect, sequence, share",
    body: "Build decks and ordered shot lists, then send a link or export a PDF contact sheet.",
  },
];

const FAQ = [
  {
    q: "What kind of video can I analyze?",
    a: "Any MP4, MOV, M4V, WebM or MKV you have the right to use — your own footage, a client cut, a reference edit. You can also paste a YouTube, TikTok or Instagram link, which analyzes the cover frame as a single shot.",
  },
  {
    q: "How accurate is the analysis?",
    a: "Shot detection, framing, lighting scheme, colour and mood are read directly from the image and are reliable. Focal length, aperture and sensor format cannot be measured from a picture — those are labelled Estimated everywhere they appear, and you can correct any field.",
  },
  {
    q: "Is my footage private?",
    a: "Yes. Uploads are private by default, stored in a private bucket and served through short-lived signed URLs. Nothing is public unless you publish it, and sharing a link makes an item unlisted rather than public.",
  },
  {
    q: "What happens if I delete a video?",
    a: "The source file, every extracted frame and every detected shot are permanently deleted, including from collections and other people's saved shots. There is no soft-delete.",
  },
  {
    q: "Do I have to wait with the page open?",
    a: "No. Processing runs as a durable server job. Close the tab, come back later, and your shots will be waiting.",
  },
];

export default async function Home() {
  let recent: Awaited<ReturnType<typeof searchShots>> = {
    shots: [],
    total: 0,
    usedSemantic: false,
    degraded: true,
  };
  try {
    recent = await searchShots({ limit: 12, scope: "public" });
  } catch (e) {
    console.error("home search_shots", e instanceof Error ? e.message : e);
  }

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
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        }}
      />

      <main id="main" className="flex-1">
        <Suspense fallback={null}>
          <UpgradedBanner />
        </Suspense>

        <section className="border-b border-line">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-14 sm:py-20">
            <div className="max-w-3xl">
              <p className="eyebrow mb-4">AI cinematography analysis</p>
              <h1 className="text-[32px] sm:text-[46px] font-medium leading-[1.08] tracking-tight text-text-0">
                Turn any video into a searchable
                <br className="hidden sm:block" /> cinematography reference library.
              </h1>
              <p className="mt-5 max-w-2xl text-[15px] sm:text-[16px] leading-relaxed text-text-1">
                ShotBreakdown detects every shot in your footage, picks the strongest frame from
                each, and reads the camera, lens, lighting, colour and mood — so a whole edit
                becomes a library you can search by how it looks.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  href="/upload"
                  className="inline-flex h-11 items-center rounded-[3px] bg-accent px-5 text-[14px] font-medium text-accent-ink hover:brightness-110"
                >
                  Analyze a video
                </Link>
                <Link
                  href="/library"
                  className="inline-flex h-11 items-center rounded-[3px] border border-line px-5 text-[14px] text-text-0 hover:border-line-strong hover:bg-ink-2"
                >
                  Browse the library
                </Link>
              </div>
              <p className="mt-3 text-[12px] text-text-3">
                Free to start · no card required · your uploads stay private
              </p>
            </div>
          </div>
        </section>

        {recent.shots.length > 0 ? (
          <section className="border-b border-line">
            <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-8">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="eyebrow">Real shots, really analyzed</h2>
                <Link href="/library" className="text-[12px] text-text-2 hover:text-text-0">
                  All shots →
                </Link>
              </div>
              <div className="shot-grid">
                {recent.shots.map((shot, index) => (
                  <ShotTile
                    key={shot.id}
                    shot={shot}
                    href={shotHref(shot)}
                    priority={index < 4}
                    showMeta={false}
                    sizes="(max-width: 640px) 50vw, 240px"
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="border-b border-line">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-14">
            <h2 className="mb-8 text-[20px] font-medium text-text-0">How it works</h2>
            <ol className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
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
          <div className="mx-auto grid max-w-[1600px] gap-10 px-4 sm:px-6 py-14 lg:grid-cols-2">
            <div>
              <h2 className="text-[20px] font-medium text-text-0">Search by how it looks</h2>
              <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-text-1">
                Every shot is indexed on what is actually in the frame — composition, subject,
                light, colour, camera. A search for something you can picture but cannot name still
                finds it.
              </p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {[
                  "girl walking through Tokyo at night",
                  "wide shots with blue lighting",
                  "slow dolly in",
                  "close ups with shallow depth of field",
                  "symmetrical compositions",
                  "handheld, documentary",
                ].map((example) => (
                  <li key={example}>
                    <Link
                      href={`/library?q=${encodeURIComponent(example)}`}
                      className="inline-flex rounded-[3px] border border-line bg-ink-1 px-2.5 py-1.5 text-[12px] text-text-1 hover:border-accent/50 hover:text-accent"
                    >
                      {example}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-[20px] font-medium text-text-0">Built for real work</h2>
              <ul className="mt-3 flex flex-col gap-3">
                {[
                  ["Shot lists and treatments", "Order shots into a sequence with notes and shot numbers, then export a PDF."],
                  ["Client and collaborator links", "Share a deck or a sequence with a link that works without an account."],
                  ["Your own reference library", "Save shots from anywhere in the library into decks you can nest however you like."],
                  ["Corrections that stick", "Fix anything the analysis got wrong; corrections are kept and re-indexed."],
                ].map(([title, body]) => (
                  <li key={title} className="border-t border-line pt-3">
                    <h3 className="text-[14px] text-text-0">{title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-text-2">{body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="border-b border-line">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-14">
            <h2 className="mb-6 text-[20px] font-medium text-text-0">Browse by technique</h2>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {TAXONOMY_GROUPS.slice(0, 4).map((group) => (
                <div key={group.segment}>
                  <p className="eyebrow mb-2">{group.label}</p>
                  <ul className="flex flex-col gap-1.5">
                    {group.entries.slice(0, 6).map((entry) => (
                      <li key={entry.slug}>
                        <Link
                          href={`/${group.segment}/${entry.slug}`}
                          className="text-[13px] text-text-1 hover:text-text-0"
                        >
                          {entry.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-line">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 py-14">
            <h2 className="mb-6 text-[20px] font-medium text-text-0">Questions</h2>
            <dl className="flex flex-col">
              {FAQ.map((item) => (
                <div key={item.q} className="border-t border-line py-4">
                  <dt className="text-[14px] text-text-0">{item.q}</dt>
                  <dd className="mt-1.5 text-[13px] leading-relaxed text-text-1">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-16 text-center">
            <h2 className="text-[24px] font-medium text-text-0">
              Analyze your first video in a couple of minutes.
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
