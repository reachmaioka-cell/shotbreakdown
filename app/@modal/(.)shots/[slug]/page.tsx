import { ShotMetadataPanel } from "@/components/shot-metadata";
import { ShotOverlay } from "@/components/shot/shot-overlay";
import { ShotViewTracker } from "@/components/shot-view-tracker";
import { savedShotIds } from "@/lib/collections";
import { getShot, getShotFrames } from "@/lib/shots";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The same lookup app/shots/[slug]/page.tsx does. Copied rather than shared:
 * exporting it from that route file would make it a second module export on a
 * page, and that page is owned elsewhere.
 */
async function loadShot(slugOrId: string, viewerId: string | null) {
  return UUID.test(slugOrId)
    ? getShot(slugOrId, viewerId)
    : getShot(slugOrId, viewerId, { bySlug: true });
}

/**
 * A shot opened from the grid. Interception only happens on a client
 * navigation, so a reload of this URL renders the full page instead.
 */
export default async function InterceptedShotPage({ params }: { params: Params }) {
  const { slug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const shot = await loadShot(slug, user?.id ?? null);
  // Not notFound(): a 404 here would replace the grid the overlay is floating
  // over. Rendering nothing lets the navigation land on the real page, which
  // decides for itself whether this is a miss.
  if (!shot) return null;

  const isOwner = user !== null && shot.userId === user.id;

  const [saved, frames] = await Promise.all([
    savedShotIds(user?.id ?? null, [shot.id]),
    // Frames are owner-only on the full page; the overlay does not get to be a
    // looser door onto the same data.
    isOwner ? getShotFrames(shot.id, user?.id ?? null) : Promise.resolve([]),
  ]);

  return (
    <>
      {/* The full page counts a view on every open. Opening the same shot from
          the grid is the same read, and once interception shipped it stopped
          counting, because the tracker lives only on the page this route now
          stands in front of. The endpoint dedupes per viewer per shot per day,
          so a shot opened in the overlay and then reloaded is still one view. */}
      {shot.visibility === "public" ? <ShotViewTracker shotId={shot.id} /> : null}
      <ShotOverlay
        shot={{
          id: shot.id,
          slug: shot.slug,
          videoId: shot.videoId,
          shotIndex: shot.shotIndex,
          title: shot.title,
          summary: shot.metadata?.one_line_summary ?? null,
          description: shot.metadata?.description ?? null,
          posterUrl: shot.posterUrl,
          playbackUrl: shot.playbackUrl,
          sourceUrl: shot.video?.sourceUrl ?? null,
          startSeconds: shot.startSeconds,
          endSeconds: shot.endSeconds,
          durationSeconds: shot.durationSeconds,
          width: shot.width,
          height: shot.height,
          tags: shot.tags,
          videoTitle: shot.video?.title ?? null,
        }}
        saved={saved.has(shot.id)}
        frames={frames.map((frame) => ({
          id: frame.id,
          thumbUrl: frame.thumbUrl,
          timestampSeconds: frame.timestampSeconds,
        }))}
        // Rendered here so the metadata panel and everything it pulls in stays
        // on the server; the overlay only places it.
        specs={shot.metadata ? <ShotMetadataPanel metadata={shot.metadata} /> : null}
      />
    </>
  );
}
