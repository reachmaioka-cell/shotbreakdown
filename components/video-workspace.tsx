"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AddToCollection } from "@/components/add-to-collection";
import { SaveButton } from "@/components/save-button";
import { Button } from "@/components/ui/primitives";
import { humanize } from "@/lib/filters";
import { formatDuration, formatTimecode, shotHref, type ShotCard } from "@/lib/shot-format";

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

/**
 * The video workspace: player, a timeline marked with every detected shot, and
 * the shot grid below. Selecting a shot seeks the player to its timecode.
 */
export function VideoWorkspace({
  video: initialVideo,
  shots: initialShots,
  savedIds,
  isOwner,
}: {
  video: VideoState;
  shots: ShotCard[];
  savedIds: string[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [video, setVideo] = useState(initialVideo);
  const [shots, setShots] = useState(initialShots);
  const [selected, setSelected] = useState<ShotCard | null>(initialShots[0] ?? null);
  const [currentTime, setCurrentTime] = useState(0);
  const [pollError, setPollError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Lazily initialised: calling Date.now() in the render body runs on every
  // render and makes the component impure.
  const startedAt = useRef<number | null>(null);

  const active = ACTIVE.has(video.status);
  const duration = video.durationSeconds ?? 0;
  const saved = useMemo(() => new Set(savedIds), [savedIds]);

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

  const seekTo = useCallback((shot: ShotCard) => {
    setSelected(shot);
    const el = videoRef.current;
    if (el && Number.isFinite(shot.startSeconds)) {
      el.currentTime = shot.startSeconds + 0.05;
      void el.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
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

  async function retry() {
    await fetch(`/api/videos/${video.id}/retry`, { method: "POST" });
    startedAt.current = Date.now();
    setSlow(false);
    router.refresh();
  }

  const stageIndex = STAGES.findIndex((s) => s.key === video.status);

  return (
    <div className="flex flex-col gap-5">
      {video.playbackUrl ? (
        <div className="overflow-hidden rounded-[3px] border border-line bg-black">
          <video
            ref={videoRef}
            src={video.playbackUrl}
            controls
            preload="metadata"
            playsInline
            className="w-full max-h-[62vh] bg-black"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
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
          <div className="relative h-8 rounded-[2px] bg-ink-2" role="group" aria-label="Shot timeline">
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
            <div className="h-full bg-accent transition-all duration-500" style={{ width: `${video.progress}%` }} />
          </div>
          <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {STAGES.map((stage, i) => (
              <li
                key={stage.key}
                className={`text-[11px] ${
                  i < stageIndex ? "text-text-2 line-through" : i === stageIndex ? "text-accent" : "text-text-3"
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

      {shots.length > 0 ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
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
                      style={{ aspectRatio: shot.width && shot.height ? `${shot.width} / ${shot.height}` : "16 / 9" }}
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
                  <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <AddToCollection shotId={shot.id} compact />
                    <SaveButton shotId={shot.id} initialSaved={saved.has(shot.id)} compact />
                  </div>
                </figure>
              ))}
            </div>
          </div>

          <aside className="lg:sticky lg:top-16 lg:self-start">
            {selected ? (
              <div className="rounded-[3px] border border-line bg-ink-1 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="eyebrow">Shot {selected.shotIndex + 1}</p>
                  <span className="mono text-[11px] text-text-3">
                    {formatTimecode(selected.startSeconds)} · {formatDuration(selected.durationSeconds)}
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-text-1">
                  {selected.description ?? selected.summary ?? "Not analyzed yet."}
                </p>
                <ul className="mt-3 flex flex-wrap gap-1">
                  {[selected.shotSize, selected.movementType, selected.lightingKey, selected.timeOfDay]
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
                <Link
                  href={shotHref(selected)}
                  className="mt-3 inline-flex h-8 items-center rounded-[3px] border border-line px-3 text-[12px] text-text-0 hover:border-line-strong hover:bg-ink-2"
                >
                  Open shot
                </Link>
              </div>
            ) : null}
          </aside>
        </div>
      ) : !active && video.status !== "failed" ? (
        <p className="text-[13px] text-text-2">No shots were detected in this video.</p>
      ) : null}
    </div>
  );
}
