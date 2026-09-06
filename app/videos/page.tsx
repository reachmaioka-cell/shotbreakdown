import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SegmentsProgress } from "@/components/segment/segments-progress";
import { AppShell } from "@/components/shell/app-shell";
import { buttonClass } from "@/components/ui/primitives";
import { FEATURES } from "@/lib/features";
import { resolveMediaUrlMap } from "@/lib/media";
import { formatDuration, formatTimecode } from "@/lib/shot-format";
import { createClient } from "@/lib/supabase/server";
import { DEPARTMENTS } from "@/lib/validation";
import { isActiveStatus, STAGE_LABELS, type VideoStatus } from "@/lib/videos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Segments",
  robots: { index: false, follow: false },
};

/**
 * The three states a breakdown can be in, and nothing else.
 *
 * `breakdown_status` is null for every segment uploaded before the breakdown
 * existed and for any segment whose breakdown has not been asked for yet. Null
 * gets no indicator at all rather than a fourth invented state.
 */
const BREAKDOWN_STATES = {
  ready: { label: "Breakdown ready", dot: "bg-ok", text: "text-ok" },
  pending: { label: "Writing the breakdown", dot: "bg-accent", text: "text-accent" },
  failed: { label: "Breakdown failed", dot: "bg-danger", text: "text-danger" },
} as const;

type BreakdownState = keyof typeof BREAKDOWN_STATES;

function breakdownState(value: string | null) {
  if (!value) return null;
  return value in BREAKDOWN_STATES ? BREAKDOWN_STATES[value as BreakdownState] : null;
}

/** The columns the card reads. Every number it prints comes from one of these. */
type SegmentRow = {
  id: string;
  title: string | null;
  status: VideoStatus;
  stage_detail: string | null;
  progress: number | null;
  shot_count: number | null;
  analyzed_shot_count: number | null;
  duration_seconds: number | null;
  source_duration_seconds: number | null;
  segment_start: number | null;
  segment_end: number | null;
  poster_path: string | null;
  /** Only used to hang the poster at the shape it was actually shot in. */
  width: number | null;
  height: number | null;
  focus: string | null;
  breakdown_status: string | null;
  error_message: string | null;
  created_at: string;
};

function num(value: number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const STEPS = [
  {
    title: "Upload a segment",
    body: "A scene, a take, one commercial. Trim it to the part you care about.",
  },
  {
    title: "Say what you want to know",
    body: "One line of focus, if you have one. It steers what the breakdown answers.",
  },
  {
    title: "Get the breakdown",
    body: `What happens, how it was shot and cut, and what each of the ${DEPARTMENTS.length} departments has to do.`,
  },
];

export default async function VideosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/videos");

  const [{ data: rows, count: totalSegments }, { data: profile }] = await Promise.all([
    supabase
      .from("videos")
      .select(
        "id, title, status, stage_detail, progress, shot_count, analyzed_shot_count, duration_seconds, source_duration_seconds, segment_start, segment_end, poster_path, width, height, focus, breakdown_status, error_message, created_at",
        // The list is capped at 60 rows; the header still has to say how many
        // segments the user actually has rather than how many fitted on it.
        { count: "exact" }
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("profiles")
      .select("plan, is_admin, display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  // One signing round trip for the whole grid, not one per card.
  const segmentRows = (rows ?? []) as SegmentRow[];
  const posterUrls = await resolveMediaUrlMap(segmentRows.map((row) => row.poster_path));
  const segments = segmentRows.map((row) => ({
    ...row,
    posterUrl: row.poster_path ? (posterUrls.get(row.poster_path) ?? null) : null,
  }));

  const total = totalSegments ?? segments.length;
  const plan = (profile?.plan as string | null) ?? "free";
  const shell = {
    authed: true,
    isPro: plan === "pro",
    // The console is only advertised where it is actually reachable.
    isAdmin: !!profile?.is_admin && FEATURES.adminReview,
    displayName: (profile?.display_name as string | null) ?? null,
    email: user.email ?? null,
  };

  /*
   * Only the segments that are actually mid-pipeline. An empty list mounts the
   * poller as a no-op, so the common case (nothing processing) costs nothing.
   */
  const activeIds = segments
    .filter((segment) => isActiveStatus(segment.status) || segment.breakdown_status === "pending")
    .map((segment) => segment.id);

  return (
    <AppShell
      {...shell}
      topbar={
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[13px] font-medium text-text-0">Segments</h1>
          {total > 0 ? (
            <span className="mono text-[11px] text-text-3">
              {total} {total === 1 ? "segment" : "segments"}
            </span>
          ) : null}
        </div>
      }
    >
      <SegmentsProgress activeIds={activeIds} />

      {segments.length === 0 ? (
        <div className="mx-auto max-w-2xl px-1 py-6 sm:py-10">
          {/*
            A real link, not a dropzone that swallows a file and does nothing.
            The uploader on the other side is where a drop is actually handled.
          */}
          <Link
            href="/upload"
            className="group flex flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-dashed border-line-strong bg-ink-1/50 px-6 py-16 text-center transition-colors hover:border-accent/60 hover:bg-ink-1 sm:py-24"
          >
            <span className="text-[17px] text-text-0">Drop a segment here</span>
            <span className="max-w-sm text-[13px] leading-relaxed text-text-2">
              A scene, a take, one commercial — not a whole film. The uploader takes the file
              and lets you trim it first.
            </span>
            <span className={buttonClass("accent", "md", "mt-2")}>Break down a segment</span>
          </Link>

          <ol className="mt-6 grid gap-px overflow-hidden rounded-[var(--radius)] border border-line bg-line sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="bg-ink-1 p-4">
                <p className="mono text-[11px] text-text-3">{i + 1}</p>
                <p className="mt-1.5 text-[13px] text-text-0">{step.title}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-text-2">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-3 gap-y-6">
          {segments.map((segment) => {
            const status = segment.status;
            const active = isActiveStatus(status);
            const title = segment.title ?? "Untitled segment";
            const stage = segment.stage_detail ?? STAGE_LABELS[status] ?? "";
            const progress = num(segment.progress) ?? 0;

            const duration = num(segment.duration_seconds);
            const sourceDuration = num(segment.source_duration_seconds);
            const start = num(segment.segment_start);
            const end = num(segment.segment_end);
            const shotCount = num(segment.shot_count) ?? 0;
            const analyzed = num(segment.analyzed_shot_count) ?? 0;

            const width = num(segment.width);
            const height = num(segment.height);
            const aspect = width && height ? `${width} / ${height}` : "16 / 9";

            const meta = [
              duration !== null ? formatDuration(duration) : null,
              shotCount > 0
                ? analyzed < shotCount
                  ? `${analyzed}/${shotCount} shots analyzed`
                  : `${shotCount} ${shotCount === 1 ? "shot" : "shots"}`
                : null,
              new Date(segment.created_at).toLocaleDateString(),
            ].filter(Boolean);

            // Provenance, not an offset: after ingest every shot timecode is
            // relative to the segment, so this only says where it was cut from.
            const cut =
              start !== null && end !== null
                ? `${formatTimecode(start)}–${formatTimecode(end)}`
                : null;
            const range = cut
              ? sourceDuration !== null
                ? `${cut} of ${formatDuration(sourceDuration)}`
                : cut
              : null;

            const breakdown = breakdownState(segment.breakdown_status);

            return (
              <li key={segment.id}>
                <Link href={`/videos/${segment.id}`} className="group block">
                  <div
                    className="relative overflow-hidden rounded-[var(--radius)] border border-line bg-ink-2 transition-colors group-hover:border-line-strong"
                    style={{ aspectRatio: aspect }}
                  >
                    {segment.posterUrl ? (
                      <Image
                        src={segment.posterUrl}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px"
                        className="object-cover"
                      />
                    ) : active ? (
                      <div className="absolute inset-0 skeleton" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center eyebrow">
                        No frame
                      </span>
                    )}
                  </div>

                  <p
                    title={title}
                    className="mt-2 truncate text-[13px] text-text-0 transition-colors group-hover:text-accent"
                  >
                    {title}
                  </p>

                  <p className="mt-0.5 truncate text-[12px] text-text-2">{meta.join(" · ")}</p>

                  {range ? (
                    <p
                      className="mono mt-0.5 truncate text-[11px] text-text-3"
                      title={`Trimmed from ${cut} of the uploaded file`}
                    >
                      {range}
                    </p>
                  ) : null}

                  {segment.focus ? (
                    <p
                      title={segment.focus}
                      className="mt-1.5 truncate text-[12px] italic text-text-1"
                    >
                      “{segment.focus}”
                    </p>
                  ) : null}

                  {breakdown ? (
                    <p className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${breakdown.text}`}>
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${breakdown.dot}`} />
                      {breakdown.label}
                    </p>
                  ) : null}

                  {active ? (
                    // The stage and the bar move as the pipeline works, so the
                    // pair is announced rather than left to a silent repaint.
                    <span className="mt-1.5 flex items-center gap-2" aria-live="polite">
                      <span
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                        aria-label={`${title}: ${stage}`}
                        className="block h-0.5 w-20 overflow-hidden bg-ink-3"
                      >
                        <span
                          className="block h-full bg-accent transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </span>
                      <span className="truncate text-[11px] text-accent">{stage}</span>
                    </span>
                  ) : status === "failed" ? (
                    <p className="mt-1.5 truncate text-[11px] text-danger" title={segment.error_message ?? undefined}>
                      {segment.error_message ?? "Analysis failed"}
                    </p>
                  ) : status !== "complete" ? (
                    // Settled but not finished — canceled today. Without this a
                    // canceled segment reads exactly like a finished one.
                    <p className="mt-1.5 truncate text-[11px] text-text-3">
                      {STAGE_LABELS[status]}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
