import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipPlayer } from "@/components/clip-player";
import { CollectionBoard } from "@/components/collection-board";
import { ExportMenu } from "@/components/export-menu";
import { ShotMetadataPanel } from "@/components/shot-metadata";
import { SiteFooter } from "@/components/site-footer";
import { getCollection } from "@/lib/collections";
import { humanize } from "@/lib/filters";
import { resolveShare } from "@/lib/shares";
import { formatDuration, formatTimecode, getShot, searchShots } from "@/lib/shots";
import { createAdminClient } from "@/lib/supabase/admin";
import { trackAsync } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// Shared links are private-by-invitation; they must never enter an index.
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Params = Promise<{ token: string }>;

/**
 * A shared page must look finished enough to send to a client, and must work
 * with no account. Nothing here requires authentication; authorization comes
 * entirely from possession of an unrevoked token.
 */
export default async function SharePage({ params }: { params: Params }) {
  const { token } = await params;
  const share = await resolveShare(token);
  if (!share) notFound();

  trackAsync("share_viewed", { properties: { resourceType: share.resourceType } });

  if (share.resourceType === "collection") {
    const collection = await getCollection({ id: share.resourceId }, share.userId, {
      allowUnlisted: true,
    });
    if (!collection) notFound();

    return (
      <div className="min-h-screen flex flex-col">
        <ShareHeader />
        <main id="main" className="flex-1 w-full mx-auto max-w-[1400px] px-4 sm:px-6 py-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow mb-1">{collection.kind === "sequence" ? "Sequence" : "Collection"}</p>
              <h1 className="text-[22px] font-medium text-text-0">{collection.name}</h1>
              {collection.description ? (
                <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-text-1">
                  {collection.description}
                </p>
              ) : null}
              <p className="mt-1.5 text-[12px] text-text-3">
                {collection.itemCount} shot{collection.itemCount === 1 ? "" : "s"}
              </p>
            </div>
            <ExportMenu resourceType="collection" resourceId={collection.id} />
          </div>

          <CollectionBoard
            collectionId={collection.id}
            kind={collection.kind}
            items={collection.items}
            editable={false}
          />
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (share.resourceType === "video") {
    const admin = createAdminClient();
    const { data: video } = await admin
      .from("videos")
      .select("id, title, duration_seconds, shot_count, source_type")
      .eq("id", share.resourceId)
      .maybeSingle();
    if (!video) notFound();

    const result = await searchShots({
      filters: { video_id: share.resourceId },
      limit: 96,
      viewerId: share.userId,
      scope: "mine",
    });
    const shots = [...result.shots].sort((a, b) => a.shotIndex - b.shotIndex);

    return (
      <div className="min-h-screen flex flex-col">
        <ShareHeader />
        <main id="main" className="flex-1 w-full mx-auto max-w-[1400px] px-4 sm:px-6 py-8">
          <p className="eyebrow mb-1">Shot breakdown</p>
          <h1 className="text-[22px] font-medium text-text-0">{video.title ?? "Untitled video"}</h1>
          <p className="mt-1.5 mb-6 text-[12px] text-text-3">
            {shots.length} shot{shots.length === 1 ? "" : "s"}
            {video.duration_seconds ? ` · ${formatDuration(Number(video.duration_seconds))}` : ""}
            {" · "}
            {humanize(video.source_type as string)}
          </p>

          <div className="shot-grid">
            {shots.map((shot) => (
              <figure key={shot.id}>
                <div
                  className="relative overflow-hidden rounded-[3px] bg-ink-2"
                  style={{ aspectRatio: shot.width && shot.height ? `${shot.width} / ${shot.height}` : "16 / 9" }}
                >
                  {shot.thumbnailUrl ? (
                    <Image
                      src={shot.thumbnailUrl}
                      alt={shot.description ?? ""}
                      fill
                      sizes="(max-width: 640px) 50vw, 280px"
                      className="object-cover"
                    />
                  ) : null}
                  <span className="mono absolute left-1 top-1 rounded-[2px] bg-black/75 px-1 py-0.5 text-[9px] text-text-1">
                    {String(shot.shotIndex + 1).padStart(2, "0")}
                  </span>
                  <span className="mono absolute bottom-1 right-1 rounded-[2px] bg-black/75 px-1 py-0.5 text-[9px] text-text-1">
                    {formatTimecode(shot.startSeconds)}
                  </span>
                </div>
                <figcaption className="mt-1.5 line-clamp-2 text-[12px] text-text-2">
                  {shot.description ?? shot.summary}
                </figcaption>
              </figure>
            ))}
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const shot = await getShot(share.resourceId, share.userId, { allowUnlisted: true });
  if (!shot) notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <ShareHeader />
      <main id="main" className="flex-1 w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div
              className="relative overflow-hidden rounded-[3px] border border-line bg-ink-1"
              style={{ aspectRatio: shot.width && shot.height ? `${shot.width} / ${shot.height}` : "16 / 9" }}
            >
              <ClipPlayer
                posterUrl={shot.posterUrl}
                sourceUrl={shot.video?.sourceUrl ?? null}
                playbackUrl={shot.playbackUrl}
                startSeconds={shot.startSeconds}
                endSeconds={shot.endSeconds}
                alt={shot.metadata?.description ?? shot.title ?? "Shot"}
              />
            </div>
            <h1 className="mt-4 text-[18px] font-medium text-text-0">
              {shot.metadata?.one_line_summary ?? shot.title}
            </h1>
            {shot.metadata?.description ? (
              <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-text-1">
                {shot.metadata.description}
              </p>
            ) : null}
            {shot.metadata?.why_it_works ? (
              <section className="mt-5 border-l-2 border-accent/60 pl-4">
                <h2 className="eyebrow mb-1.5">Why it works</h2>
                <p className="max-w-2xl text-[14px] leading-relaxed text-text-1">
                  {shot.metadata.why_it_works}
                </p>
              </section>
            ) : null}
          </div>
          <aside>{shot.metadata ? <ShotMetadataPanel metadata={shot.metadata} /> : null}</aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function ShareHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-12 max-w-[1400px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-3.5 w-3.5 border border-accent"
            style={{
              background:
                "linear-gradient(135deg, var(--accent) 0 45%, transparent 45% 55%, var(--accent) 55% 100%)",
            }}
          />
          <span className="text-[13px] font-medium tracking-tight">ShotBreakdown</span>
        </Link>
        <Link
          href="/upload"
          className="inline-flex h-8 items-center rounded-[3px] border border-line px-3 text-[12px] text-text-1 hover:border-line-strong hover:text-text-0"
        >
          Analyze your own video
        </Link>
      </div>
    </header>
  );
}
