"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatDurationLimit } from "@/lib/plans";

export type SegmentRange = { start: number; end: number };

/**
 * One arrow press. The browser never exposes the source frame rate, so a frame
 * is assumed to be 1/30s — close enough to land on the cut the user is looking
 * at, and the pipeline re-cuts on real frame boundaries anyway.
 */
const FRAME_SECONDS = 1 / 30;

/** Shorter than this and there is no sequence left to break down. */
const MIN_SELECTION_SECONDS = 1;

function clamp(n: number, low: number, high: number): number {
  if (high < low) return low;
  return Math.min(high, Math.max(low, n));
}

/** Milliseconds are the finest thing anyone here can act on. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Clock readout. Tenths appear only when they carry information, so a
 * whole-second selection reads "0:42" rather than "0:42.0".
 */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  // Counted in tenths and split afterwards. Subtracting the whole seconds first
  // would read 42.9 as 42.8, because 42.9 - 42 is 0.8999… in binary.
  const tenths = Math.round(safe * 10);
  const whole = Math.floor(tenths / 10);
  const tenth = tenths % 10;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const base =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  return tenth > 0 ? `${base}.${tenth}` : base;
}

/**
 * Accepts what a person actually types for a time: "12.5", "0:12.5",
 * "1:02:03". Anything else is null, which the caller reports as an error
 * rather than guessing at.
 */
export function parseTimeInput(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 3) return null;

  let total = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    // "1:75" is a typo, not 135 seconds. Only the leading field may run over.
    if (i > 0 && n >= 60) return null;
    total = total * 60 + n;
  }
  return total;
}

/**
 * Choose the part of a file to break down.
 *
 * The file never leaves the browser to get here: it is loaded straight into a
 * <video> from an object URL, so scrubbing costs nothing and no upload happens
 * until the user submits. Formats the browser cannot decode (ProRes MOV, plenty
 * of MKVs) fall back to typed in and out points, because refusing the file
 * outright would refuse exactly the footage this product is for.
 */
export function SegmentTrimmer({
  file,
  maxSeconds,
  value,
  onChange,
  onDurationKnown,
}: {
  file: File;
  maxSeconds: number;
  value: SegmentRange;
  onChange: (next: SegmentRange) => void;
  onDurationKnown: (duration: number | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"in" | "out" | null>(null);
  const stopAtRef = useRef<number | null>(null);

  const [loadedFile, setLoadedFile] = useState(file);
  const [duration, setDuration] = useState<number | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inText, setInText] = useState("");
  const [outText, setOutText] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const uid = useId();
  const inFieldId = `${uid}-in`;
  const outFieldId = `${uid}-out`;
  const manualHintId = `${uid}-manual-hint`;

  // Held in a ref so a parent that re-creates the callback each render does not
  // re-run the metadata effects underneath it.
  const reportDuration = useRef(onDurationKnown);
  useEffect(() => {
    reportDuration.current = onDurationKnown;
  });

  // Everything below was read from the previous file, so a new one invalidates
  // all of it. Adjusted during render rather than in an effect: waiting for a
  // commit would show one file's duration against another file's frames.
  if (loadedFile !== file) {
    setLoadedFile(file);
    setDuration(null);
    setDecodeFailed(false);
    setPlayhead(0);
    setPlaying(false);
    setInText("");
    setOutText("");
    setManualError(null);
  }

  useEffect(() => {
    const video = videoRef.current;
    const url = URL.createObjectURL(file);
    if (video) {
      // Assigned to the element rather than rendered as a prop, so creating the
      // URL stays out of render where it would leak a copy per pass.
      video.src = url;
      video.load();
    }
    return () => {
      // An object URL pins the entire file in memory until it is revoked, so
      // this cleanup is the difference between a 2GB upload being freed and not.
      if (video) video.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (duration !== null || decodeFailed) return;
    // Some browsers neither decode a file nor fire an error for it. Without a
    // deadline the uploader would sit waiting on a preview that is never
    // coming, so give up and offer the typed in and out points instead. Long
    // enough that a big MOV with its index at the tail still wins the race; if
    // its metadata does land late, loadedmetadata takes the scrubber back.
    const timer = setTimeout(() => {
      setDecodeFailed(true);
      setDuration(null);
      reportDuration.current(null);
    }, 10_000);
    return () => clearTimeout(timer);
  }, [file, duration, decodeFailed]);

  // Track the playhead only while something is moving; a rAF loop that runs
  // forever would re-render this component for no reason.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        setPlayhead(video.currentTime);
        const stopAt = stopAtRef.current;
        if (stopAt !== null && video.currentTime >= stopAt) {
          stopAtRef.current = null;
          video.pause();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const setEdge = useCallback(
    (which: "in" | "out", seconds: number) => {
      if (!duration) return;
      // A file shorter than the minimum still gets a usable selection: the whole
      // of it, rather than a range the clamp cannot satisfy.
      const minLength = Math.min(MIN_SELECTION_SECONDS, duration);
      if (which === "in") {
        const start = round3(clamp(seconds, 0, value.end - minLength));
        if (start !== value.start) onChange({ start, end: value.end });
      } else {
        const end = round3(clamp(seconds, value.start + minLength, duration));
        if (end !== value.end) onChange({ start: value.start, end });
      }
    },
    [duration, onChange, value.end, value.start]
  );

  function secondsFromClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track || !duration) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
  }

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.currentTime = clamp(seconds, 0, duration);
    setPlayhead(video.currentTime);
  }

  function playSelection() {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      return;
    }
    stopAtRef.current = value.end;
    video.currentTime = value.start;
    // Muted playback is always permitted, but a rejected promise here is not
    // worth an error state: the button can simply be pressed again.
    void video.play().catch(() => undefined);
  }

  function onHandlePointerDown(which: "in" | "out", event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = which;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  }

  function onHandlePointerMove(which: "in" | "out", event: React.PointerEvent<HTMLDivElement>) {
    if (draggingRef.current !== which) return;
    setEdge(which, secondsFromClientX(event.clientX));
  }

  function onHandlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onHandleKeyDown(which: "in" | "out", event: React.KeyboardEvent<HTMLDivElement>) {
    if (!duration || event.metaKey || event.ctrlKey || event.altKey) return;
    const step = event.shiftKey ? 1 : FRAME_SECONDS;
    const current = which === "in" ? value.start : value.end;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        setEdge(which, current - step);
        break;
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        setEdge(which, current + step);
        break;
      case "Home":
        event.preventDefault();
        setEdge(which, 0);
        break;
      case "End":
        event.preventDefault();
        setEdge(which, duration);
        break;
      default:
        break;
    }
  }

  /**
   * "i" and "o" set the in and out points at the playhead — the shortcut every
   * editor already has in their fingers. Scoped to this component so typing an
   * "i" into the focus box never moves a handle.
   */
  function onContainerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if (key !== "i" && key !== "o") return;
    event.preventDefault();
    const at = videoRef.current?.currentTime ?? playhead;
    setEdge(key === "i" ? "in" : "out", at);
  }

  function commitManual(nextIn: string, nextOut: string) {
    const start = parseTimeInput(nextIn);
    const end = parseTimeInput(nextOut);

    if (start === null || end === null) {
      // Half-typed is not an error yet; a filled field that will not parse is.
      const bothFilled = nextIn.trim() !== "" && nextOut.trim() !== "";
      setManualError(bothFilled ? "Use seconds (12.5) or timecode (0:12.5)." : null);
      onChange({ start: 0, end: 0 });
      return;
    }
    if (end - start < MIN_SELECTION_SECONDS) {
      setManualError("The out point has to be at least a second after the in point.");
      onChange({ start: 0, end: 0 });
      return;
    }
    setManualError(null);
    onChange({ start: round3(start), end: round3(end) });
  }

  const hasSelection = value.end > value.start;
  const length = hasSelection ? value.end - value.start : 0;
  const overCap = length > maxSeconds;

  const lengthLine = (
    <p role="status" className="text-[12px] text-text-2">
      <span className="mono text-text-1">{formatClock(length)}</span> of{" "}
      <span className="mono">{formatClock(maxSeconds)}</span> allowed
    </p>
  );

  const capAlert = overCap ? (
    <p role="alert" className="text-[12px] text-danger">
      That selection is {formatClock(length)}. Segments are limited to{" "}
      {formatDurationLimit(maxSeconds)} — move a handle in.
    </p>
  ) : null;

  // The manual panel and the scrubber are two branches of one component so the
  // <video> below stays mounted through both: it owns the object URL, and a
  // format that fails to decode still has to release it.
  const manualPanel = (
    <>
      <p className="text-[13px] leading-relaxed text-text-1">
        This browser cannot preview this format. Enter the in and out points.
      </p>
      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor={inFieldId} className="eyebrow block mb-1">
            In
          </label>
          <input
            id={inFieldId}
            type="text"
            inputMode="decimal"
            value={inText}
            aria-describedby={manualHintId}
            onChange={(e) => {
              setInText(e.target.value);
              commitManual(e.target.value, outText);
            }}
            placeholder="0:00"
            className="mono h-9 w-28 rounded-[3px] border border-line bg-ink-2 px-2.5 text-[13px] text-text-0 placeholder-text-3 focus:border-line-strong focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor={outFieldId} className="eyebrow block mb-1">
            Out
          </label>
          <input
            id={outFieldId}
            type="text"
            inputMode="decimal"
            value={outText}
            aria-describedby={manualHintId}
            onChange={(e) => {
              setOutText(e.target.value);
              commitManual(inText, e.target.value);
            }}
            placeholder="0:30"
            className="mono h-9 w-28 rounded-[3px] border border-line bg-ink-2 px-2.5 text-[13px] text-text-0 placeholder-text-3 focus:border-line-strong focus:outline-none"
          />
        </div>
      </div>
      <p id={manualHintId} className="text-[12px] text-text-3">
        Seconds (12.5) or timecode (0:12.5).
      </p>
      {hasSelection ? lengthLine : null}
      {capAlert}
      {manualError ? (
        <p role="alert" className="text-[12px] text-danger">
          {manualError}
        </p>
      ) : null}
    </>
  );

  const startPercent = duration ? (value.start / duration) * 100 : 0;
  const widthPercent = duration ? (Math.max(0, length) / duration) * 100 : 0;
  const playheadPercent = duration ? clamp((playhead / duration) * 100, 0, 100) : 0;

  return (
    <div
      onKeyDown={onContainerKeyDown}
      className="flex flex-col gap-3 rounded-[3px] border border-line bg-ink-1 p-3"
    >
      <div className={decodeFailed ? "hidden" : "overflow-hidden rounded-[2px] bg-black"}>
        <video
          ref={videoRef}
          controls
          muted
          playsInline
          preload="metadata"
          className="w-full max-h-[46vh] bg-black"
          onLoadedMetadata={(e) => {
            const found = e.currentTarget.duration;
            if (!Number.isFinite(found) || found <= 0) {
              setDecodeFailed(true);
              setDuration(null);
              reportDuration.current(null);
              return;
            }
            setDuration(found);
            setDecodeFailed(false);
            reportDuration.current(found);
          }}
          onError={() => {
            setDecodeFailed(true);
            setDuration(null);
            reportDuration.current(null);
          }}
          onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
          onSeeked={(e) => setPlayhead(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      </div>

      {decodeFailed ? (
        manualPanel
      ) : duration ? (
        <>
          <div
            ref={trackRef}
            role="group"
            aria-label="Segment scrubber"
            onPointerDown={(e) => seekTo(secondsFromClientX(e.clientX))}
            className="relative h-11 touch-none select-none rounded-[2px] bg-ink-2"
          >
            <div
              aria-hidden
              className="absolute inset-y-0 border-x border-accent bg-accent/15"
              style={{ left: `${startPercent}%`, width: `${widthPercent}%` }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-1 w-px bg-text-0"
              style={{ left: `${playheadPercent}%` }}
            />
            {(["in", "out"] as const).map((which) => {
              const at = which === "in" ? value.start : value.end;
              const percent = clamp((at / duration) * 100, 0, 100);
              return (
                <div
                  key={which}
                  role="slider"
                  tabIndex={0}
                  aria-label={which === "in" ? "Segment in point" : "Segment out point"}
                  aria-valuemin={0}
                  aria-valuemax={round3(duration)}
                  aria-valuenow={round3(at)}
                  aria-valuetext={formatClock(at)}
                  onPointerDown={(e) => onHandlePointerDown(which, e)}
                  onPointerMove={(e) => onHandlePointerMove(which, e)}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
                  onKeyDown={(e) => onHandleKeyDown(which, e)}
                  className="absolute inset-y-0 -ml-2.5 w-5 cursor-ew-resize touch-none"
                  style={{ left: `${percent}%` }}
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-[1px] bg-accent"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-center gap-4 text-[12px] text-text-2">
              <span>
                In <span className="mono text-text-0">{formatClock(value.start)}</span>
              </span>
              <span>
                Out <span className="mono text-text-0">{formatClock(value.end)}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              {lengthLine}
              <button
                type="button"
                onClick={playSelection}
                className="inline-flex h-8 items-center rounded-[3px] border border-line px-2.5 text-[12px] text-text-0 hover:border-line-strong hover:bg-ink-2"
              >
                {playing ? "Pause" : "Play selection"}
              </button>
            </div>
          </div>

          {capAlert}

          <p className="text-[12px] leading-relaxed text-text-3">
            Drag the handles, or focus one and use the arrow keys — one frame at a time, a second
            with Shift. Press i or o to set the in or out point at the playhead.
          </p>
        </>
      ) : (
        <p className="text-[12px] text-text-3">Reading the file…</p>
      )}
    </div>
  );
}
