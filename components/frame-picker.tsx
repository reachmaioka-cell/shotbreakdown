"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import type { ShotFrame } from "@/lib/shot-format-types";

function timecode(seconds: number): string {
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/**
 * Scrub the shot and pick a different representative frame.
 *
 * The AI's pick is a default, not a verdict — the owner can choose any extracted
 * frame, and optionally re-run analysis against it.
 */
export function FramePicker({
  shotId,
  frames,
  currentFrameId,
}: {
  shotId: string;
  frames: ShotFrame[];
  currentFrameId: string | null;
}) {
  const router = useRouter();
  const initialIndex = Math.max(
    0,
    frames.findIndex((f) => f.id === currentFrameId)
  );
  const [index, setIndex] = useState(initialIndex);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const frame = frames[index];
  const changed = frame && frame.id !== currentFrameId;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (event.key === "," || event.key === "[") setIndex((i) => Math.max(0, i - 1));
      if (event.key === "." || event.key === "]") setIndex((i) => Math.min(frames.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frames.length]);

  async function apply(reanalyze: boolean) {
    if (!frame) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/shots/${shotId}/frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameId: frame.id, reanalyze }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Could not set the frame");
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (frames.length === 0) {
    return <p className="text-[13px] text-text-2">No alternative frames were extracted for this shot.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-[3px] bg-ink-2" style={{ aspectRatio: "16 / 9" }}>
        {frame?.url ? (
          <Image
            src={frame.url}
            alt={`Frame at ${timecode(frame.timestampSeconds)}`}
            fill
            sizes="(max-width: 1024px) 100vw, 640px"
            className="object-contain"
          />
        ) : null}
        <span className="mono absolute bottom-2 right-2 rounded-[2px] bg-black/75 px-1.5 py-0.5 text-[10px] text-text-1">
          {frame ? timecode(frame.timestampSeconds) : "—"}
        </span>
      </div>

      <div>
        <label htmlFor="frame-scrub" className="sr-only">
          Scrub through frames
        </label>
        <input
          id="frame-scrub"
          type="range"
          className="scrubber"
          min={0}
          max={frames.length - 1}
          step={1}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
        />
        <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
          {frames.map((f, i) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Frame at ${timecode(f.timestampSeconds)}`}
              aria-pressed={i === index}
              className={`relative h-12 w-20 shrink-0 overflow-hidden rounded-[2px] border transition-colors ${
                i === index ? "border-accent" : "border-line hover:border-line-strong"
              }`}
            >
              {f.thumbUrl ? (
                <Image src={f.thumbUrl} alt="" fill sizes="80px" className="object-cover" />
              ) : null}
              {f.id === currentFrameId ? (
                <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-center text-[8px] uppercase tracking-wider text-accent">
                  current
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!changed || saving}
          onClick={() => void apply(false)}
        >
          {saving ? "Saving…" : saved && !changed ? "Frame set" : "Use this frame"}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!changed || saving}
          onClick={() => void apply(true)}
          title="Set this frame and re-run the cinematography analysis against it"
        >
          Use and re-analyze
        </Button>
        <span className="text-[11px] text-text-3">
          <kbd className="mono">,</kbd> <kbd className="mono">.</kbd> to step
        </span>
      </div>

      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
