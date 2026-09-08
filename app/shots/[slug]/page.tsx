import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCollection } from "@/components/add-to-collection";
import { AskPanel } from "@/components/ask-panel";
import { FramePicker } from "@/components/frame-picker";
import { ClipPlayer } from "@/components/clip-player";
import { JsonLd } from "@/components/json-ld";
import { MetadataEditor } from "@/components/metadata-editor";
import { SaveButton } from "@/components/save-button";
import { ShareButton } from "@/components/share-button";
import { ShotMetadataPanel, ShotSummaryStrip } from "@/components/shot-metadata";
import { ShotViewTracker } from "@/components/shot-view-tracker";
import { SimilarShots } from "@/components/similar-shots";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Pill } from "@/components/ui/primitives";
import { savedShotIds } from "@/lib/collections";
import { getAppUrl } from "@/lib/env";
import { FEATURES } from "@/lib/features";
import { humanize } from "@/lib/filters";
import { getShare } from "@/lib/shares";
import { formatDuration, formatTimecode, getShot, getShotFrames } from "@/lib/shots";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadShot(slugOrId: string, viewerId: string | null) {
  return UUID.test(slugOrId)
    ? getShot(slugOrId, viewerId)
    : getShot(slugOrId, viewerId, { bySlug: true });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const shot = await loadShot(slug, null);
  if (!shot) return { title: "Shot not found", robots: { index: false } };

  const title = shot.metadata?.one_line_summary ?? shot.title ?? "Cinematography shot";
  const description =
    shot.metadata?.description ??
    shot.metadata?.one_line_summary ??
    "A cinematography reference shot analyzed by ShotBreakdown.";
  const canonical = `${getAppUrl()}/shots/${shot.slug ?? shot.id}`;
  const isPublic = shot.visibility === "public";

  return {
    title,
    description: description.slice(0, 160),
    alternates: { canonical },
    robots: isPublic ? undefined : { index: false, follow: false },
    openGraph: {
      type: "article",
      title,
      description: description.slice(0, 200),
      url: canonical,
      images: shot.posterUrl ? [{ url: shot.posterUrl }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: description.slice(0, 200),
      images: shot.posterUrl ? [shot.posterUrl] : undefined,
    },
  };
}

export default async function ShotPage({ params }: { params: Params }) {
  const { slug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const shot = await loadShot(slug, user?.id ?? null);
  if (!shot) notFound();

  const isOwner = user !== null && shot.userId === user.id;
  const metadata = shot.metadata;

  const [saved, frames, share] = await Promise.all([
    savedShotIds(user?.id ?? null, [shot.id]),
    isOwner ? getShotFrames(shot.id, user?.id ?? null) : Promise.resolve([]),
    isOwner ? getShare("shot", shot.id, user!.id) : Promise.resolve(null),
  ]);

  const origin = getAppUrl();
  const canonical = `${origin}/shots/${shot.slug ?? shot.id}`;

  const structured =
    shot.visibility === "public"
      ? {
          "@context": "https://schema.org",
          "@type": "ImageObject",
          name: metadata?.one_line_summary ?? shot.title ?? "Cinematography shot",
          description: metadata?.description ?? undefined,
          contentUrl: shot.posterUrl ?? undefined,
          url: canonical,
          keywords: shot.tags.join(", "),
          datePublished: shot.createdAt,
          isPartOf: { "@type": "VideoObject", name: shot.video?.title ?? undefined },
        }
      : null;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      {structured ? <JsonLd data={structured} /> : null}
      {shot.visibility === "public" ? <ShotViewTracker shotId={shot.id} /> : null}

      <main id="main" className="flex-1 w-full mx-auto max-w-[1600px] px-4 sm:px-6 py-5">
        <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-text-2">
          <Link href="/library" className="hover:text-text-0">Library</Link>
          {shot.video?.title ? (
            <>
              <span aria-hidden>/</span>
              <Link href={`/videos/${shot.videoId}`} className="hover:text-text-0 truncate max-w-[16rem]">
                {shot.video.title}
              </Link>
            </>
          ) : null}
          <span aria-hidden>/</span>
          <span className="text-text-1">Shot {shot.shotIndex + 1}</span>
        </nav>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <div
              className="relative overflow-hidden rounded-[3px] bg-ink-1 border border-line"
              style={{
                aspectRatio:
                  shot.width && shot.height ? `${shot.width} / ${shot.height}` : "16 / 9",
              }}
            >
              <ClipPlayer
                posterUrl={shot.posterUrl}
                sourceUrl={shot.video?.sourceUrl ?? null}
                playbackUrl={shot.playbackUrl}
                startSeconds={shot.startSeconds}
                endSeconds={shot.endSeconds}
                alt={metadata?.description ?? shot.title ?? "Shot"}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SaveButton shotId={shot.id} initialSaved={saved.has(shot.id)} />
              <AddToCollection shotId={shot.id} />
              {isOwner ? (
                <ShareButton
                  resourceType="shot"
                  resourceId={shot.id}
                  existingUrl={share ? `${origin}/s/${share.token}` : null}
                  visibility={shot.visibility}
                />
              ) : null}
              <div className="ml-auto flex items-center gap-3 text-[12px] text-text-3">
                {shot.durationSeconds > 0 ? (
                  <span className="mono">
                    {formatTimecode(shot.startSeconds)}–{formatTimecode(shot.endSeconds)} ·{" "}
                    {formatDuration(shot.durationSeconds)}
                  </span>
                ) : null}
                {FEATURES.publicLibrary && shot.visibility === "public" ? (
                  <span>{shot.viewCount} views</span>
                ) : null}
              </div>
            </div>

            <header className="mt-6">
              <h1 className="text-[19px] leading-snug font-medium text-text-0 max-w-2xl">
                {metadata?.one_line_summary ?? shot.title ?? "Untitled shot"}
              </h1>
              {metadata?.description ? (
                <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-text-1">
                  {metadata.description}
                </p>
              ) : null}
            </header>

            {metadata ? (
              <div className="mt-6 border-t border-line pt-5">
                <ShotSummaryStrip metadata={metadata} />
              </div>
            ) : null}

            {metadata?.why_it_works ? (
              <section className="mt-6 border-l-2 border-accent/60 pl-4">
                <h2 className="eyebrow mb-1.5">Why it works</h2>
                <p className="max-w-2xl text-[14px] leading-relaxed text-text-1">
                  {metadata.why_it_works}
                </p>
              </section>
            ) : null}

            {shot.tags.length > 0 ? (
              <ul className="mt-6 flex flex-wrap gap-1.5">
                {shot.tags.map((tag) => (
                  <li key={tag}>
                    {/* /tags/[tag] 404s while the flag is off, so the tag reads
                        as a label rather than a dead link. */}
                    {FEATURES.tagPages ? (
                      <Link href={`/tags/${encodeURIComponent(tag)}`}>
                        <Pill>{humanize(tag)}</Pill>
                      </Link>
                    ) : (
                      <Pill>{humanize(tag)}</Pill>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}

            {isOwner && frames.length > 1 ? (
              <section className="mt-8 border-t border-line pt-5">
                <h2 className="eyebrow mb-3">Representative frame</h2>
                <p className="mb-3 max-w-2xl text-[13px] text-text-2">
                  ShotBreakdown picked the frame below automatically. Scrub the shot and choose a
                  different one if it reads better.
                </p>
                <FramePicker
                  shotId={shot.id}
                  frames={frames}
                  currentFrameId={shot.representativeFrameId}
                />
              </section>
            ) : null}

            {isOwner && metadata ? (
              <section className="mt-8 border-t border-line pt-5">
                <h2 className="eyebrow mb-3">Corrections</h2>
                <p className="mb-3 max-w-2xl text-[13px] text-text-2">
                  Anything the analysis got wrong can be corrected here. Corrections are kept
                  separately from the original record and are re-indexed for search.
                </p>
                <MetadataEditor shotId={shot.id} metadata={metadata} tags={shot.tags} />
              </section>
            ) : null}

            {metadata ? (
              <section className="mt-8 border-t border-line pt-5">
                <h2 className="eyebrow mb-3">Ask about this shot</h2>
                <AskPanel shotId={shot.id} />
              </section>
            ) : null}

            {FEATURES.similarShots ? (
              <section className="mt-8 border-t border-line pt-5">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="eyebrow">Visually similar</h2>
                </div>
                <SimilarShots shotId={shot.id} />
              </section>
            ) : null}
          </div>

          <aside className="lg:sticky lg:top-16 lg:self-start">
            {shot.video ? (
              <div className="mb-4 rounded-[3px] border border-line bg-ink-1 p-3">
                <p className="eyebrow mb-1.5">Source</p>
                <Link
                  href={`/videos/${shot.videoId}`}
                  className="block text-[13px] text-text-0 hover:text-accent"
                >
                  {shot.video.title ?? "Untitled video"}
                </Link>
                <p className="mt-1 text-[12px] text-text-2">
                  {shot.video.shotCount} shot{shot.video.shotCount === 1 ? "" : "s"}
                  {shot.video.durationSeconds
                    ? ` · ${formatDuration(shot.video.durationSeconds)}`
                    : ""}
                  {" · "}
                  {humanize(shot.video.sourceType)}
                </p>
                {/*
                  The breakdown is the reason most people opened this shot, and
                  it lives on the segment. Link at the answer rather than at the
                  top of it, and say plainly when there is not one yet.
                */}
                {shot.video.hasBreakdown ? (
                  <ul className="mt-2.5 flex flex-col gap-1 border-t border-line pt-2.5">
                    {shot.video.hasTechnique ? (
                      <li>
                        <Link
                          href={`/videos/${shot.videoId}#how-it-was-made`}
                          className="text-[12px] text-accent hover:underline"
                        >
                          How it was made, in camera and in post
                        </Link>
                      </li>
                    ) : null}
                    <li>
                      <Link
                        href={`/videos/${shot.videoId}#departments`}
                        className="text-[12px] text-accent hover:underline"
                      >
                        What each department has to do
                      </Link>
                    </li>
                  </ul>
                ) : (
                  <p className="mt-2 text-[12px] text-text-3">
                    No breakdown for this segment yet.
                  </p>
                )}
                {shot.video.sourceUrl ? (
                  <a
                    href={shot.video.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="mt-1.5 inline-block text-[12px] text-text-2 hover:text-text-0"
                  >
                    Open original ↗
                  </a>
                ) : null}
              </div>
            ) : null}

            {metadata ? (
              <ShotMetadataPanel metadata={metadata} />
            ) : (
              <p className="text-[13px] text-text-2">
                {shot.status === "failed"
                  ? shot.errorMessage ?? "This shot could not be analyzed."
                  : "This shot has not been analyzed yet."}
              </p>
            )}
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
