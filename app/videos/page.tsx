import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { EmptyState, LinkButton } from "@/components/ui/primitives";
import { humanize } from "@/lib/filters";
import { resolveMediaUrl } from "@/lib/media";
import { formatDuration } from "@/lib/shots";
import { createClient } from "@/lib/supabase/server";
import { isActiveStatus, STAGE_LABELS, type VideoStatus } from "@/lib/videos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My videos",
  robots: { index: false, follow: false },
};

export default async function VideosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/videos");

  const { data: rows } = await supabase
    .from("videos")
    .select(
      "id, title, status, stage_detail, progress, shot_count, analyzed_shot_count, duration_seconds, poster_path, source_type, error_message, created_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const videos = await Promise.all(
    (rows ?? []).map(async (row) => ({
      ...row,
      posterUrl: await resolveMediaUrl(row.poster_path as string | null),
    }))
  );

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main id="main" className="flex-1 w-full mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h1 className="text-[17px] font-medium text-text-0">My videos</h1>
          <LinkButton href="/upload" variant="primary" size="sm">
            Analyze a video
          </LinkButton>
        </div>

        {videos.length === 0 ? (
          <EmptyState
            title="No videos yet"
            body="Upload a video and ShotBreakdown will detect every shot and analyze the cinematography of each one."
            action={
              <LinkButton href="/upload" variant="primary">
                Analyze your first video
              </LinkButton>
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {videos.map((video) => {
              const status = video.status as VideoStatus;
              const active = isActiveStatus(status);
              return (
                <li key={video.id}>
                  <Link
                    href={`/videos/${video.id}`}
                    className="flex items-center gap-4 py-3 group"
                  >
                    <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-[3px] bg-ink-2">
                      {video.posterUrl ? (
                        <Image
                          src={video.posterUrl}
                          alt=""
                          fill
                          sizes="96px"
                          className="object-cover"
                        />
                      ) : active ? (
                        <div className="absolute inset-0 skeleton" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] text-text-0 group-hover:text-accent">
                        {(video.title as string | null) ?? "Untitled video"}
                      </p>
                      <p className="mt-0.5 text-[12px] text-text-2">
                        {humanize(video.source_type as string)}
                        {video.duration_seconds
                          ? ` · ${formatDuration(Number(video.duration_seconds))}`
                          : ""}
                        {video.shot_count ? ` · ${video.shot_count} shots` : ""}
                        {" · "}
                        {new Date(video.created_at as string).toLocaleDateString()}
                      </p>
                      {active ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-0.5 w-28 overflow-hidden bg-ink-3">
                            <div
                              className="h-full bg-accent transition-all"
                              style={{ width: `${(video.progress as number) ?? 0}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-accent">
                            {(video.stage_detail as string | null) ?? STAGE_LABELS[status]}
                          </span>
                        </div>
                      ) : status === "failed" ? (
                        <p className="mt-1 text-[11px] text-danger">
                          {(video.error_message as string | null) ?? "Analysis failed"}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[11px] text-text-3">
                      {status === "complete" ? `${video.analyzed_shot_count} analyzed` : STAGE_LABELS[status]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
