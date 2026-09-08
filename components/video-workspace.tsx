"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AddToCollection } from "@/components/add-to-collection";
import { SaveButton } from "@/components/save-button";
import { AiRecreation, type AiRecreationStatusValue } from "@/components/segment/ai-recreation";
import { BreakdownStatus, type BreakdownStatusValue } from "@/components/segment/breakdown-status";
import { SegmentAsk } from "@/components/segment/segment-ask";
import {
  SegmentBreakdown,
  type SegmentBreakdownShot,
} from "@/components/segment/segment-breakdown";
import { ShotMetadataPanel } from "@/components/shot-metadata";
import { Button, Tabs } from "@/components/ui/primitives";
import { humanize } from "@/lib/filters";
import { formatDuration, formatTimecode, shotHref, type ShotCard } from "@/lib/shot-format";
import type {
  Department,
  ShotMetadata,
  StoredAiRecreation,
  StoredSegmentBreakdown,
} from "@/lib/validation";

export type VideoState = {
  id: string;
  title: string | null;
  status: string;
  stageDetail: string | null;
  progress: number;
  shotCount: number;
  analyzedShotCount: number;
  durationSeconds: number | null;
  errorMessage: string | null;
  sourceUrl: string | null;
  sourceType: string;
  playbackUrl: string | null;
  /** What the uploader asked of this segment. Null when they asked nothing. */
  focus: string | null;
  /**
   * The chosen range within the ORIGINAL file. Null on both means the whole
   * file was analysed, and nothing about trimming should be said.
   */
  segmentStart: number | null;
  segmentEnd: number | null;
  sourceDurationSeconds: number | null;
  breakdownStatus: BreakdownStatusValue;
  breakdownError: string | null;
  visibility: string;
  createdAt: string;
};

const ACTIVE = new Set([
  "queued",
  "processing",
  "detecting_shots",
  "extracting_frames",
  "analyzing",
  "indexing",
]);

const STAGES = [
  { key: "detecting_shots", label: "Detect shots" },
  { key: "extracting_frames", label: "Extract frames" },
  { key: "analyzing", label: "Analyze" },
  { key: "complete", label: "Done" },
];

const TABS = [
  { key: "shot", label: "Shot" },
  { key: "ask", label: "Ask" },
  { key: "details", label: "Details" },
];

/** The aspect a tile should hold. Falls back only when the shot has no size. */
function aspectOf(shot: Pick<ShotCard, "width" | "height" | "aspectRatio">): string {
  if (shot.width && shot.height) return `${shot.width} / ${shot.height}`;
  // aspect_ratio is stored as "16:9"; CSS wants "16 / 9".
  if (shot.aspectRatio && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(shot.aspectRatio)) {
    return shot.aspectRatio.replace(":", " / ");
  }
  return "16 / 9";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <>
      <dt className="text-[12px] leading-5 text-text-2">{label}</dt>
      <dd className="text-[13px] leading-5 text-text-0">{value}</dd>
    </>
  );
}

/**
 * The segment workspace: the player and its shot navigation on the left, the
 * breakdown underneath, and a rail that answers "what is this shot", "what else
 * do I want to know" and "where did this come from".
 *
 * A client component, so it takes everything it renders as props — the page
 * reads the database, the flags and the viewer's role on the server.
 */
export function VideoWorkspace({
  video: initialVideo,
  shots: initialShots,
  savedIds,
  isOwner,
  breakdown,
  shotMetadata,
  openRole = null,
  hasBreakdown,
  aiRecreation = null,
  aiStatus = null,
  aiError = null,
}: {
  video: VideoState;
  shots: ShotCard[];
  savedIds: string[];
  isOwner: boolean;
  /** Parsed by the page with readSegmentBreakdown(). Null until one is written. */
  breakdown: StoredSegmentBreakdown | null;
  /** Full facets per shot id, for the Shot tab. Absent for unanalysed shots. */
  shotMetadata: Record<string, ShotMetadata>;
  /** The department the reader works in, opened first in the breakdown. */
  openRole?: Department | null;
  /**
   * Whether a breakdown exists at all. The AI route is written from it, so the
   * button stays disabled until there is one. Falls back to the breakdown prop.
   */
  hasBreakdown?: boolean;
  /*
   * The AI route, parsed by the page. Optional and null by default: with
   * nothing passed the owner still gets the button, and the poll that follows
   * pressing it brings the document back.
   */
  aiRecreation?: StoredAiRecreation | null;
  aiStatus?: AiRecreationStatusValue;
  /** Owner-only, like breakdownError: the raw pipeline message. */
  aiError?: string | null;
}) {
  const router = useRouter();
  const [video, setVideo] = useState(initialVideo);
  const [shots, setShots] = useState(initialShots);
  const [selected, setSelected] = useState<ShotCard | null>(initialShots[0] ?? null);
  const [currentTime, setCurrentTime] = useState(0);
  const [pollError, setPollError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [tab, setTab] = useState("shot");
  /*
   * Only ever set by a deliberate jump. Playback moving the outline from one
   * shot to the next is not an event worth interrupting a screen reader for,
   * every few seconds, for the length of the segment.
   */
  const [announcement, setAnnouncement] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const stripItems = useRef(new Map<string, HTMLElement>());
  // Lazily initialised: calling Date.now() in the render body runs on every
  // render and makes the component impure.
  const startedAt = useRef<number | null>(null);

  const active = ACTIVE.has(video.status);
  const duration = video.durationSeconds ?? 0;
  const saved = useMemo(() => new Set(savedIds), [savedIds]);

  // The sequence table hangs its thumbnails off the same shots the strip shows,
  // so they are derived here rather than threaded through as a second list.
  const breakdownShots = useMemo<SegmentBreakdownShot[]>(
    () =>
      shots.map((shot) => ({
        id: shot.id,
        shotIndex: shot.shotIndex,
        thumbnailUrl: shot.thumbnailUrl,
        timecode: formatTimecode(shot.startSeconds),
      })),
    [shots]
  );

  /**
   * Poll while processing, backing off as it goes and giving up with a real
   * message rather than spinning forever.
   */
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let delay = 2000;
    let timer: ReturnType<typeof setTimeout>;

    startedAt.current ??= Date.now();

    const tick = async () => {
      try {
        const res = await fetch(`/api/videos/${video.id}`);
        if (!res.ok) throw new Error("status unavailable");
        const data = (await res.json()) as {
          video: Record<string, unknown>;
          readyShots: number;
        };
        if (cancelled) return;
        const next = data.video;
        setPollError(null);
        setVideo((current) => ({
          ...current,
          status: next.status as string,
          stageDetail: (next.stage_detail as string | null) ?? null,
          progress: (next.progress as number) ?? current.progress,
          shotCount: (next.shot_count as number) ?? current.shotCount,
          analyzedShotCount: (next.analyzed_shot_count as number) ?? current.analyzedShotCount,
          durationSeconds:
            next.duration_seconds !== null ? Number(next.duration_seconds) : current.durationSeconds,
          errorMessage: (next.error_message as string | null) ?? null,
          // The breakdown is queued the moment analysis finishes, so this flips
          // to 'pending' inside the same poll that reports the segment complete.
          breakdownStatus: (next.breakdown_status as BreakdownStatusValue) ?? null,
          breakdownError: (next.breakdown_error as string | null) ?? null,
        }));

        const stillActive = ACTIVE.has(next.status as string);
        // New shots appear as they finish; refresh the server component to pull
        // them in rather than duplicating the query here.
        if (data.readyShots !== shots.filter((s) => s.thumbnailUrl).length || !stillActive) {
          router.refresh();
        }
        if (!stillActive) return;
      } catch {
        if (!cancelled) setPollError("Lost connection to the server. Retrying…");
      }

      if (cancelled) return;
      if (Date.now() - (startedAt.current ?? Date.now()) > 20 * 60_000) {
        setSlow(true);
        return;
      }
      delay = Math.min(delay * 1.25, 15_000);
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, video.id, router, shots]);

  // Shots arrive progressively while a video processes; adopt each server
  // refresh during render so the grid never shows a stale frame count.
  const [seenShots, setSeenShots] = useState(initialShots);
  if (seenShots !== initialShots) {
    setSeenShots(initialShots);
    setShots(initialShots);
    if (!selected && initialShots.length > 0) setSelected(initialShots[0]);
  }

  // The page is the source of truth for the breakdown's own status; a refresh
  // that lands after a rewrite must not be overwritten by the poller's copy.
  const [seenVideo, setSeenVideo] = useState(initialVideo);
  if (seenVideo !== initialVideo) {
    setSeenVideo(initialVideo);
    setVideo(initialVideo);
  }

  const seekTo = useCallback(
    (shot: ShotCard) => {
      setSelected(shot);
      setAnnouncement(
        `Shot ${shot.shotIndex + 1} of ${shots.length}, ${formatTimecode(shot.startSeconds)}`
      );
      const el = videoRef.current;
      if (el && Number.isFinite(shot.startSeconds)) {
        el.currentTime = shot.startSeconds + 0.05;
        void el.play().catch(() => {});
      }
    },
    [shots]
  );

  const seekToIndex = useCallback(
    (shotIndex: number) => {
      const shot = shots.find((s) => s.shotIndex === shotIndex);
      if (shot) seekTo(shot);
    },
    [shots, seekTo]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      // Arrows inside the rail's tablist move between tabs. Stepping the shot
      // as well would fire two unrelated actions off one key.
      if (target?.closest('[role="tablist"]')) return;
      if (!selected) return;
      const index = shots.findIndex((s) => s.id === selected.id);
      if (event.key === "n" || event.key === "ArrowRight") {
        const next = shots[Math.min(shots.length - 1, index + 1)];
        if (next) {
          event.preventDefault();
          seekTo(next);
        }
      } else if (event.key === "p" || event.key === "ArrowLeft") {
        const prev = shots[Math.max(0, index - 1)];
        if (prev) {
          event.preventDefault();
          seekTo(prev);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, shots, seekTo]);

  // Keep the outlined thumbnail on screen. Scrolling the strip itself rather
  // than calling scrollIntoView, which would also move the page vertically.
  useEffect(() => {
    if (!selected) return;
    const container = stripRef.current;
    const el = stripItems.current.get(selected.id);
    if (!container || !el) return;
    const target = el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({ left: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }, [selected]);

  /** Follow playback, so "the current shot" means what the player is showing. */
  function onTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>) {
    const el = event.currentTarget;
    setCurrentTime(el.currentTime);
    if (el.paused) return;
    let playing: ShotCard | null = null;
    for (const shot of shots) {
      if (shot.startSeconds <= el.currentTime + 0.01) playing = shot;
      else break;
    }
    if (playing && playing.id !== selected?.id) setSelected(playing);
  }

  /*
   * The breakdown's sequence rows carry data-shot-index. Delegating from the
   * container means the rows stay a pure render of the document — no callback
   * has to be threaded through a component the page renders on the server.
   */
  function sequenceIndexFrom(target: EventTarget | null): number | null {
    const el = target instanceof HTMLElement ? target.closest("[data-shot-index]") : null;
    if (!(el instanceof HTMLElement)) return null;
    const index = Number(el.dataset.shotIndex);
    return Number.isInteger(index) ? index : null;
  }

  function onSequenceClick(event: React.MouseEvent<HTMLDivElement>) {
    const index = sequenceIndexFrom(event.target);
    if (index !== null) seekToIndex(index);
  }

  function onSequenceKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    // Every row already contains a real button, which the platform activates on
    // Enter and Space and which reaches the click handler above. This is the
    // backstop for anything else in a row that takes focus.
    if (target instanceof HTMLElement && target.closest("button, a, summary, input, textarea")) {
      return;
    }
    const index = sequenceIndexFrom(target);
    if (index === null) return;
    event.preventDefault();
    seekToIndex(index);
  }

  async function retry() {
    await fetch(`/api/videos/${video.id}/retry`, { method: "POST" });
    startedAt.current = Date.now();
    setSlow(false);
    router.refresh();
  }

  const stageIndex = STAGES.findIndex((s) => s.key === video.status);
  const trimmed = video.segmentStart !== null && video.segmentEnd !== null;
  const selectedMetadata = selected ? shotMetadata[selected.id] : undefined;

  const rail = (
    <Tabs value={tab} onChange={setTab} items={TABS} label="Segment panels">
      {tab === "shot" ? (
        selected ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="eyebrow">
                Shot {selected.shotIndex + 1} of {shots.length}
              </p>
              <span className="mono text-[11px] text-text-3">
                {formatTimecode(selected.startSeconds)} · {formatDuration(selected.durationSeconds)}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-text-1">
              {selected.description ?? selected.summary ?? "Not analyzed yet."}
            </p>
            {selectedMetadata ? (
              <ShotMetadataPanel metadata={selectedMetadata} />
            ) : (
              <ul className="flex flex-wrap gap-1">
                {[
                  selected.shotSize,
                  selected.movementType,
                  selected.lightingKey,
                  selected.timeOfDay,
                ]
                  .filter((v): v is string => !!v && v !== "unclear")
                  .map((facet) => (
                    <li
                      key={facet}
                      className="rounded-[3px] border border-line bg-ink-2 px-1.5 py-0.5 text-[11px] text-text-1"
                    >
                      {humanize(facet)}
                    </li>
                  ))}
              </ul>
            )}
            <Link
              href={shotHref(selected)}
              className="inline-flex h-8 w-fit items-center rounded-[3px] border border-line px-3 text-[12px] text-text-0 hover:border-line-strong hover:bg-ink-2"
            >
              Open shot
            </Link>
          </div>
        ) : (
          <p className="text-[13px] text-text-2">
            No shot selected yet. Pick one from the strip above.
          </p>
        )
      ) : null}

      {tab === "ask" ? (
        isOwner ? (
          <SegmentAsk videoId={video.id} />
        ) : (
          <p className="text-[13px] text-text-2">
            Only the person who uploaded this segment can ask questions about it.
          </p>
        )
      ) : null}

      {tab === "details" ? (
        <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          <Row label="Segment" value={duration > 0 ? formatDuration(duration) : null} />
          <Row label="Shots" value={shots.length > 0 ? String(shots.length) : null} />
          {trimmed ? (
            <Row
              label="Trimmed from"
              value={
                <span className="mono">
                  {formatTimecode(video.segmentStart as number)} –{" "}
                  {formatTimecode(video.segmentEnd as number)}
                </span>
              }
            />
          ) : (
            <Row label="Source range" value="The whole file was analysed" />
          )}
          <Row
            label="Original file"
            value={
              video.sourceDurationSeconds !== null
                ? formatDuration(video.sourceDurationSeconds)
                : null
            }
          />
          <Row label="Source" value={humanize(video.sourceType)} />
          <Row label="Added" value={new Date(video.createdAt).toLocaleDateString()} />
          <Row label="Visibility" value={humanize(video.visibility)} />
          <Row label="Your question" value={video.focus} />
        </dl>
      ) : null}
    </Tabs>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
      {/* Player, timeline and strip: everything that moves the playhead. */}
      <div className="flex min-w-0 flex-col gap-4 xl:col-start-1 xl:row-start-1">
        {video.playbackUrl ? (
          <div className="overflow-hidden rounded-[3px] border border-line bg-black">
            <video
              ref={videoRef}
              src={video.playbackUrl}
              controls
              preload="metadata"
              playsInline
              className="w-full max-h-[62vh] bg-black"
              onTimeUpdate={onTimeUpdate}
            />
          </div>
        ) : video.sourceUrl ? (
          <a
            href={video.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="rounded-[3px] border border-line bg-ink-1 px-4 py-3 text-[13px] text-text-1 hover:text-text-0"
          >
            Open the original on {humanize(video.sourceType)} ↗
          </a>
        ) : null}

        {duration > 0 && shots.length > 0 ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-text-3">
              <span className="mono">{formatTimecode(currentTime)}</span>
              <span>
                {shots.length} shot{shots.length === 1 ? "" : "s"}
              </span>
              <span className="mono">{formatTimecode(duration)}</span>
            </div>
            <div
              className="relative h-8 rounded-[2px] bg-ink-2"
              role="group"
              aria-label="Shot timeline"
            >
              {shots.map((shot) => {
                const left = (shot.startSeconds / duration) * 100;
                const width = Math.max(0.5, (shot.durationSeconds / duration) * 100);
                const isSelected = selected?.id === shot.id;
                return (
                  <button
                    key={shot.id}
                    type="button"
                    onClick={() => seekTo(shot)}
                    title={`Shot ${shot.shotIndex + 1} · ${formatTimecode(shot.startSeconds)}`}
                    aria-label={`Jump to shot ${shot.shotIndex + 1} at ${formatTimecode(shot.startSeconds)}`}
                    aria-pressed={isSelected}
                    className={`absolute top-0 h-full border-r border-ink-0 transition-colors ${
                      isSelected ? "bg-accent" : "bg-line-strong hover:bg-text-3"
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                );
              })}
              {currentTime > 0 ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-0 h-full w-px bg-text-0"
                  style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {shots.length > 0 ? (
          <div
            ref={stripRef}
            role="group"
            aria-label="Shot strip"
            className="no-scrollbar flex gap-1 overflow-x-auto pb-1"
          >
            {shots.map((shot) => {
              const isSelected = selected?.id === shot.id;
              return (
                <button
                  key={shot.id}
                  ref={(el) => {
                    if (el) stripItems.current.set(shot.id, el);
                    else stripItems.current.delete(shot.id);
                  }}
                  type="button"
                  onClick={() => seekTo(shot)}
                  aria-pressed={isSelected}
                  aria-label={`Shot ${shot.shotIndex + 1} at ${formatTimecode(shot.startSeconds)}`}
                  style={{ aspectRatio: aspectOf(shot) }}
                  className={`relative h-20 shrink-0 overflow-hidden rounded-[2px] bg-ink-2 ${
                    isSelected ? "outline outline-2 -outline-offset-2 outline-accent" : ""
                  }`}
                >
                  {shot.thumbnailUrl ? (
                    <Image
                      src={shot.thumbnailUrl}
                      alt=""
                      fill
                      sizes="160px"
                      className="object-cover"
                    />
                  ) : (
                    <span className="absolute inset-0 skeleton" />
                  )}
                  <span
                    className={`mono absolute left-1 top-1 rounded-[2px] px-1 py-0.5 text-[9px] ${
                      isSelected ? "bg-accent text-accent-ink" : "bg-black/75 text-text-1"
                    }`}
                  >
                    {String(shot.shotIndex + 1).padStart(2, "0")}
                  </span>
                  <span className="mono absolute bottom-1 right-1 rounded-[2px] bg-black/75 px-1 py-0.5 text-[9px] text-text-1">
                    {formatTimecode(shot.startSeconds)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {active ? (
          <div className="rounded-[3px] border border-line bg-ink-1 p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[13px] text-text-0">
                {video.stageDetail ?? "Preparing"}
                {video.shotCount > 0 && video.status === "analyzing"
                  ? ` — ${video.analyzedShotCount} of ${video.shotCount}`
                  : ""}
              </p>
              <span className="mono text-[12px] text-text-2">{video.progress}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={video.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Processing progress"
              className="mt-2 h-0.5 w-full overflow-hidden bg-ink-3"
            >
              <div
                className="h-full bg-accent transition-all duration-500"
                style={{ width: `${video.progress}%` }}
              />
            </div>
            <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {STAGES.map((stage, i) => (
                <li
                  key={stage.key}
                  className={`text-[11px] ${
                    i < stageIndex
                      ? "text-text-2 line-through"
                      : i === stageIndex
                        ? "text-accent"
                        : "text-text-3"
                  }`}
                >
                  {stage.label}
                </li>
              ))}
            </ol>
            {pollError ? <p className="mt-2 text-[12px] text-text-3">{pollError}</p> : null}
            {slow ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="text-[12px] text-text-1">
                  This is taking longer than expected. The job is still queued on the server.
                </p>
                <Button size="sm" onClick={() => void retry()}>
                  Restart processing
                </Button>
              </div>
            ) : null}
            <p className="mt-3 text-[12px] text-text-3">
              You can close this page — processing continues and your shots will be waiting.
            </p>
          </div>
        ) : null}

        {video.status === "failed" ? (
          <div role="alert" className="rounded-[3px] border border-danger/30 bg-danger/5 p-4">
            <p className="text-[13px] text-text-0">This video could not be analyzed.</p>
            {video.errorMessage ? (
              <p className="mt-1 text-[12px] text-text-1">{video.errorMessage}</p>
            ) : null}
            {isOwner ? (
              <Button size="sm" className="mt-3" onClick={() => void retry()}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/*
        At xl this is the sticky rail beside the player. Below it, the grid
        collapses to one column and the same tablist falls in underneath the
        player as a segmented control — one instance either way, so the tab and
        any half-typed question survive the breakpoint.

        The .sticky-rail utility is spelled out here rather than used by name:
        it is declared in a plain @layer utilities block, which Tailwind v4
        generates no variants for, so `xl:sticky-rail` compiles to nothing. The
        values below are that class exactly. Below xl none of it applies, and
        the panel is a normal block in the flow rather than a nested scroller.
      */}
      {/* row-end-3 rather than row-span-2: span emits the grid-row shorthand,
          which would overwrite the row-start beside it depending on which of
          the two Tailwind happens to print last. */}
      <div className="min-w-0 xl:sticky xl:top-5 xl:col-start-2 xl:row-start-1 xl:row-end-3 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
        {rail}
      </div>

      <div className="min-w-0 xl:col-start-1 xl:row-start-2">
        {breakdown ? (
          /*
            Clicks land on the sequence rows, which carry data-shot-index. The
            region is not itself interactive: every row holds a real button, so
            the keyboard route to the same action already exists.
          */
          <div onClick={onSequenceClick} onKeyDown={onSequenceKeyDown}>
            <SegmentBreakdown
              breakdown={breakdown}
              shots={breakdownShots}
              openRole={openRole}
              segmentSeconds={video.durationSeconds}
            />
          </div>
        ) : active || video.status === "failed" ? (
          // The processing panel and the failure alert above already say where
          // the breakdown has got to; a second waiting state would repeat them.
          null
        ) : isOwner ? (
          <BreakdownStatus
            videoId={video.id}
            status={video.breakdownStatus}
            error={video.breakdownError}
          />
        ) : (
          <p className="text-[13px] text-text-2">
            No breakdown has been written for this segment yet.
          </p>
        )}

        {/*
          Last in the region, after the camera answer: the reader meets how the
          segment was actually made before they are offered the generative route.
          Held back while the segment is still processing or has failed, where
          the panels above are already the whole story.
        */}
        {!active && video.status !== "failed" ? (
          <AiRecreation
            videoId={video.id}
            status={aiStatus}
            recreation={aiRecreation}
            error={aiError}
            isOwner={isOwner}
            hasBreakdown={hasBreakdown ?? breakdown !== null}
          />
        ) : null}

        {shots.length > 0 ? (
          <div className="mt-10">
            <h2 className="eyebrow mb-2">
              Detected shots
              <span className="ml-2 normal-case tracking-normal text-text-3">
                ← → to step through
              </span>
            </h2>
            <div className="shot-grid shot-grid-sm">
              {shots.map((shot) => (
                <figure key={shot.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => seekTo(shot)}
                    aria-pressed={selected?.id === shot.id}
                    className="block w-full text-left"
                  >
                    <div
                      className={`relative overflow-hidden rounded-[3px] bg-ink-2 ${
                        selected?.id === shot.id ? "ring-2 ring-accent ring-inset" : ""
                      }`}
                      style={{ aspectRatio: aspectOf(shot) }}
                    >
                      {shot.thumbnailUrl ? (
                        <Image
                          src={shot.thumbnailUrl}
                          alt={shot.description ?? `Shot ${shot.shotIndex + 1}`}
                          fill
                          sizes="200px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 skeleton" />
                      )}
                      <span className="mono absolute left-1 top-1 rounded-[2px] bg-black/75 px-1 py-0.5 text-[9px] text-text-1">
                        {String(shot.shotIndex + 1).padStart(2, "0")}
                      </span>
                      <span className="mono absolute bottom-1 right-1 rounded-[2px] bg-black/75 px-1 py-0.5 text-[9px] text-text-1">
                        {formatTimecode(shot.startSeconds)}
                      </span>
                    </div>
                  </button>
                  <div className="tile-actions absolute right-1 top-1 flex gap-1">
                    <AddToCollection shotId={shot.id} compact />
                    <SaveButton shotId={shot.id} initialSaved={saved.has(shot.id)} compact />
                  </div>
                </figure>
              ))}
            </div>
          </div>
        ) : !active && video.status !== "failed" ? (
          <p className="mt-10 text-[13px] text-text-2">No shots were detected in this segment.</p>
        ) : null}
      </div>
    </div>
  );
}
