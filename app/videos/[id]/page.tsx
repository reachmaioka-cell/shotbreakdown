import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteVideoButton } from "@/components/delete-video-button";
import { ShareButton } from "@/components/share-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { VideoWorkspace, type VideoState } from "@/components/video-workspace";
import { savedShotIds } from "@/lib/collections";
import { resolveMediaUrl } from "@/lib/media";
import { getShare } from "@/lib/shares";
import { getAppUrl } from "@/lib/env";
import { formatDuration, searchShots } from "@/lib/shots";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { humanize } from "@/lib/filters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data: video } = await admin
    .from("videos")
    .select(
      "id, user_id, title, status, stage_detail, progress, shot_count, analyzed_shot_count, duration_seconds, error_message, source_url, source_type, file_path, visibility, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!video) notFound();

  const isOwner = user !== null && video.user_id === user.id;
  if (!isOwner && video.visibility !== "public") notFound();

  const [result, playbackUrl, share] = await Promise.all([
    searchShots({
      filters: { video_id: id },
      limit: 96,
      viewerId: user?.id ?? null,
      scope: isOwner ? "mine" : "public",
    }),
    video.source_type === "video_upload" && video.file_path && isOwner
      ? resolveMediaUrl(video.file_path as string)
      : Promise.resolve(null),
    isOwner ? getShare("video", id, user!.id) : Promise.resolve(null),
  ]);

  const shots = [...result.shots].sort((a, b) => a.shotIndex - b.shotIndex);
  const saved = await savedShotIds(user?.id ?? null, shots.map((s) => s.id));

  const state: VideoState = {
    id: video.id as string,
    title: (video.title as string | null) ?? null,
    status: video.status as string,
    stageDetail: (video.stage_detail as string | null) ?? null,
    progress: (video.progress as number) ?? 0,
    shotCount: (video.shot_count as number) ?? 0,
    analyzedShotCount: (video.analyzed_shot_count as number) ?? 0,
    durationSeconds: video.duration_seconds !== null ? Number(video.duration_seconds) : null,
    errorMessage: (video.error_message as string | null) ?? null,
    sourceUrl: (video.source_url as string | null) ?? null,
    sourceType: video.source_type as string,
    playbackUrl,
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main id="main" className="flex-1 w-full mx-auto max-w-[1600px] px-4 sm:px-6 py-5">
        <nav aria-label="Breadcrumb" className="mb-3 text-[12px] text-text-2">
          <Link href="/videos" className="hover:text-text-0">Videos</Link>
          <span aria-hidden className="mx-1.5">/</span>
          <span className="text-text-1">{state.title ?? "Untitled"}</span>
        </nav>

        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[17px] font-medium text-text-0 truncate">
              {state.title ?? "Untitled video"}
            </h1>
            <p className="mt-1 text-[12px] text-text-2">
              {humanize(state.sourceType)}
              {state.durationSeconds ? ` · ${formatDuration(state.durationSeconds)}` : ""}
              {state.shotCount ? ` · ${state.shotCount} shots` : ""}
              {" · "}
              {new Date(video.created_at as string).toLocaleDateString()}
            </p>
          </div>
          {isOwner ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/library?video_id=${id}`}
                className="inline-flex h-9 items-center rounded-[3px] border border-line px-3 text-[13px] text-text-0 hover:border-line-strong hover:bg-ink-2"
              >
                Search these shots
              </Link>
              <ShareButton
                resourceType="video"
                resourceId={id}
                existingUrl={share ? `${getAppUrl()}/s/${share.token}` : null}
                visibility={video.visibility as string}
              />
              <DeleteVideoButton videoId={id} shotCount={state.shotCount} />
            </div>
          ) : null}
        </div>

        <VideoWorkspace video={state} shots={shots} savedIds={[...saved]} isOwner={isOwner} />
      </main>
      <SiteFooter />
    </div>
  );
}
