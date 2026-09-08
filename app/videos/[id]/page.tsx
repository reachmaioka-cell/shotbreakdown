import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteVideoButton } from "@/components/delete-video-button";
import { RefocusDialog } from "@/components/segment/refocus-dialog";
import { ShareButton } from "@/components/share-button";
import { AppShell } from "@/components/shell/app-shell";
import { VideoWorkspace, type VideoState } from "@/components/video-workspace";
import { savedShotIds } from "@/lib/collections";
import { getAppUrl } from "@/lib/env";
import { FEATURES } from "@/lib/features";
import { resolveMediaUrl } from "@/lib/media";
import { overlayBreakdown } from "@/lib/overlay";
import { getShare } from "@/lib/shares";
import { formatDuration, formatTimecode } from "@/lib/shot-format";
import { searchShots } from "@/lib/shots";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  DEPARTMENTS,
  ShotMetadataSchema,
  StoredAiRecreationSchema,
  readSegmentBreakdown,
  type Department,
  type ShotMetadata,
} from "@/lib/validation";
import type { AiRecreationStatusValue } from "@/components/segment/ai-recreation";
import type { BreakdownStatusValue } from "@/components/segment/breakdown-status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const DEPARTMENT_SET = new Set<string>(DEPARTMENTS);

/** user_preferences.role also allows "other", which opens no department. */
function toDepartment(value: unknown): Department | null {
  return typeof value === "string" && DEPARTMENT_SET.has(value) ? (value as Department) : null;
}

function toNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * "trimmed from 1:12 to 1:42 of a 3:20 upload".
 *
 * Only ever said when the uploader actually chose a range. A whole file that
 * was analysed end to end has no provenance to state, and inventing one would
 * describe a trim that never happened.
 */
function provenanceLine(
  start: number | null,
  end: number | null,
  sourceDuration: number | null
): string | null {
  if (start === null || end === null) return null;
  const of =
    sourceDuration !== null && sourceDuration > 0
      ? `a ${formatTimecode(sourceDuration)} upload`
      : "the upload";
  return `trimmed from ${formatTimecode(start)} to ${formatTimecode(end)} of ${of}`;
}

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
      `id, user_id, title, status, stage_detail, progress, shot_count, analyzed_shot_count,
       duration_seconds, error_message, source_url, source_type, file_path, visibility, created_at,
       focus, segment_start, segment_end, source_duration_seconds,
       breakdown, breakdown_status, breakdown_error,
       ai_recreation, ai_recreation_status, ai_recreation_error,
       ai_recreation_prompt_version, ai_recreation_generated_at`
    )
    .eq("id", id)
    .maybeSingle();

  if (!video) notFound();

  const isOwner = user !== null && video.user_id === user.id;
  if (!isOwner && video.visibility !== "public") notFound();

  const [result, playbackUrl, share, profileRow, prefsRow] = await Promise.all([
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
    user
      ? supabase.from("profiles").select("plan, is_admin, display_name").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    /*
     * Which department the reader works in decides which brief opens first. Read
     * through the caller's own session client, so it is only ever their own row
     * — on the page's main path the reader IS the owner, and nobody else's
     * stored role is exposed by a segment being public.
     */
    user
      ? supabase.from("user_preferences").select("role").eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const shots = [...result.shots].sort((a, b) => a.shotIndex - b.shotIndex);
  const shotIds = shots.map((shot) => shot.id);

  /*
   * Full facets for the rail's Shot tab. Fetched for the shots the search
   * already authorised rather than by video id, so visibility is decided once.
   * A segment is a clip, so this is tens of rows at the very most.
   *
   * Run beside savedShotIds rather than before it: neither needs the other, and
   * serialising them puts a second round trip in front of first paint.
   */
  const [metaResult, saved] = await Promise.all([
    shotIds.length > 0
      ? admin.from("shots").select("id, metadata, metadata_edits").in("id", shotIds)
      : Promise.resolve({ data: null }),
    savedShotIds(user?.id ?? null, shotIds),
  ]);

  const shotMetadata: Record<string, ShotMetadata> = {};
  for (const row of (metaResult.data ?? []) as {
    id: string;
    metadata: Record<string, unknown> | null;
    metadata_edits: Record<string, unknown> | null;
  }[]) {
    if (!row.metadata) continue;
    const merged = overlayBreakdown(row.metadata, row.metadata_edits);
    const parsed = ShotMetadataSchema.safeParse(merged);
    if (parsed.success) shotMetadata[row.id] = parsed.data;
  }

  const segmentStart = toNumber(video.segment_start);
  const segmentEnd = toNumber(video.segment_end);
  const sourceDuration = toNumber(video.source_duration_seconds);

  const state: VideoState = {
    id: video.id as string,
    title: (video.title as string | null) ?? null,
    status: video.status as string,
    stageDetail: (video.stage_detail as string | null) ?? null,
    progress: (video.progress as number) ?? 0,
    shotCount: (video.shot_count as number) ?? 0,
    analyzedShotCount: (video.analyzed_shot_count as number) ?? 0,
    durationSeconds: toNumber(video.duration_seconds),
    errorMessage: (video.error_message as string | null) ?? null,
    sourceUrl: (video.source_url as string | null) ?? null,
    sourceType: video.source_type as string,
    playbackUrl,
    focus: (video.focus as string | null) ?? null,
    segmentStart,
    segmentEnd,
    sourceDurationSeconds: sourceDuration,
    breakdownStatus: (video.breakdown_status as BreakdownStatusValue) ?? null,
    // The stored message is the raw pipeline error, so it is the owner's to
    // read; a public reader can do nothing with it.
    breakdownError: isOwner ? ((video.breakdown_error as string | null) ?? null) : null,
    visibility: video.visibility as string,
    createdAt: video.created_at as string,
  };

  const breakdown = readSegmentBreakdown(video.breakdown);

  /*
   * The generative route is written by its own job, on demand, so it arrives
   * independently of the breakdown and may be absent, still running, failed, or
   * written against a shape this build no longer understands. Parse it the way
   * the breakdown is parsed: a document that will not read is treated as no
   * document, so a stale row cannot take the page down with it.
   */
  const aiParsed = StoredAiRecreationSchema.safeParse(video.ai_recreation);
  const aiRecreation = aiParsed.success ? aiParsed.data : null;
  const aiStatus = (video.ai_recreation_status as AiRecreationStatusValue) ?? null;
  // Same rule as breakdownError: the stored message is the raw provider text,
  // so it is the owner's to read and nobody else's.
  const aiError = isOwner ? ((video.ai_recreation_error as string | null) ?? null) : null;
  const openRole = toDepartment((prefsRow.data as { role?: unknown } | null)?.role);
  const profile = profileRow.data as {
    plan?: string | null;
    is_admin?: boolean | null;
    display_name?: string | null;
  } | null;
  const plan = profile?.plan ?? "free";

  const title = state.title ?? "Untitled segment";
  /*
   * The page loads at most 96 shots, so shots.length is a page size, not a
   * count — a 120-shot segment would have its header say 96. result.total is
   * the uncapped count of the shots this reader is allowed to see, which is
   * what the header is claiming.
   */
  const shotTotal = result.total || shots.length;
  const facts = [
    state.durationSeconds ? formatDuration(state.durationSeconds) : null,
    shotTotal > 0 ? `${shotTotal} shot${shotTotal === 1 ? "" : "s"}` : null,
    provenanceLine(segmentStart, segmentEnd, sourceDuration),
  ].filter(Boolean) as string[];

  return (
    <AppShell
      authed={user !== null}
      isPro={plan === "pro"}
      isAdmin={!!profile?.is_admin && FEATURES.adminReview}
      displayName={profile?.display_name ?? null}
      email={user?.email ?? null}
      topbar={
        <nav aria-label="Breadcrumb" className="min-w-0 text-[12px] text-text-2">
          <ol className="flex min-w-0 items-center gap-1.5">
            <li className="shrink-0">
              <Link href="/videos" className="hover:text-text-0">
                Segments
              </Link>
            </li>
            <li aria-hidden className="shrink-0 text-text-3">
              /
            </li>
            <li className="min-w-0 truncate text-text-1" aria-current="page">
              {title}
            </li>
          </ol>
        </nav>
      }
    >
      {/*
        The rail slot is left empty on purpose. The shot strip belongs to the
        player — it drives the playhead and reads the selection the workspace
        owns — and the shell's rail is a sibling of the page, not a child of it,
        so putting the strip there would fork that state across two trees for
        240px of width.
      */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[17px] font-medium text-text-0">{title}</h1>
          {facts.length > 0 ? (
            <p className="mt-1 text-[12px] text-text-2">{facts.join(" · ")}</p>
          ) : null}
        </div>
        {isOwner ? (
          <div className="flex flex-wrap items-center gap-2">
            <RefocusDialog videoId={id} focus={state.focus} />
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

      <VideoWorkspace
        video={state}
        shots={shots}
        savedIds={[...saved]}
        isOwner={isOwner}
        breakdown={breakdown}
        hasBreakdown={breakdown !== null}
        aiStatus={aiStatus}
        aiRecreation={aiRecreation}
        aiError={aiError}
        shotMetadata={shotMetadata}
        openRole={openRole}
      />
    </AppShell>
  );
}
