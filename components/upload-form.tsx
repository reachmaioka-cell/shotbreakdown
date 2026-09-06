"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FocusField } from "@/components/focus-field";
import { SegmentTrimmer, type SegmentRange } from "@/components/segment-trimmer";
import {
  ACCEPT_ATTRIBUTE,
  ACCEPT_VIDEO_ATTRIBUTE,
  ALLOWED_UPLOAD_TYPES,
  ALLOWED_VIDEO_TYPES,
  UPLOAD_BUCKET,
} from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import {
  SEGMENT_TRIM_EPSILON_SECONDS,
  formatBytes,
  formatDurationLimit,
  type PlanLimits,
} from "@/lib/plans";

type Phase = "idle" | "uploading" | "creating" | "queued" | "error";

/**
 * The floor bitrate we assume when the browser cannot read a duration.
 *
 * A file that will not decode here is a camera or mezzanine format — ProRes,
 * DNx, a high-bitrate MKV — and those run far above 2 Mbit/s. So a file smaller
 * than the cap times this rate cannot be longer than the cap, and asking its
 * owner for in and out points would be a toll for nothing. Anything larger has
 * to be trimmed by hand. The server still enforces the real cap either way.
 */
const ASSUMED_MIN_BYTES_PER_SECOND = 250_000;

function extension(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext && ext.length <= 5 ? ext : "bin";
}

function isSupported(file: File, allowStills: boolean): boolean {
  const types = allowStills ? ALLOWED_UPLOAD_TYPES : ALLOWED_VIDEO_TYPES;
  if ((types as readonly string[]).includes(file.type)) return true;
  // Some browsers report an empty type for .mkv/.mov; fall back to the extension.
  return allowStills
    ? /\.(mp4|mov|m4v|webm|mkv|jpg|jpeg|png|webp|avif)$/i.test(file.name)
    : /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name);
}

/**
 * Upload with real progress, cancellation and terminal states.
 *
 * The browser only uploads; processing is a durable server job, so closing the
 * tab after the upload completes does not lose the analysis.
 *
 * The unit is a segment, so the file is trimmed here — before a byte is sent —
 * and the range travels with it as provenance.
 *
 * The two flags arrive as props because feature flags are server-only — a
 * client component reading them would see every one of them as false.
 */
export function UploadForm({
  limits,
  authed,
  remaining,
  linkSourcesEnabled,
  stillUploadsEnabled,
}: {
  limits: PlanLimits;
  authed: boolean;
  remaining: number;
  linkSourcesEnabled: boolean;
  stillUploadsEnabled: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [range, setRange] = useState<SegmentRange>({ start: 0, end: 0 });
  const [duration, setDuration] = useState<number | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const trimmerId = useId();

  useEffect(() => () => xhrRef.current?.abort(), []);

  const maxSeconds = limits.maxVideoSeconds;

  function resetSegment() {
    setRange({ start: 0, end: 0 });
    setDuration(null);
    setDecodeFailed(false);
    setTrimOpen(false);
  }

  function chooseFile(next: File) {
    if (!isSupported(next, stillUploadsEnabled)) {
      setError(
        stillUploadsEnabled
          ? "Use MP4, MOV, M4V, WebM, MKV, or a still image."
          : "Use MP4, MOV, M4V, WebM or MKV."
      );
      return;
    }
    if (next.size > limits.maxUploadBytes) {
      setError(`That file is ${formatBytes(next.size)}. Your plan allows ${formatBytes(limits.maxUploadBytes)}.`);
      return;
    }
    setError(null);
    resetSegment();
    setFile(next);
    setUrl("");
  }

  /**
   * The trimmer reports what the browser could read. A null duration means the
   * file did not decode, so the typed in and out points are the only way in.
   */
  const handleDurationKnown = useCallback(
    (found: number | null) => {
      if (found === null) {
        setDuration(null);
        setDecodeFailed(true);
        setRange({ start: 0, end: 0 });
        setTrimOpen(true);
        return;
      }
      setDecodeFailed(false);
      setDuration(found);
      if (found > maxSeconds) {
        // Over the cap there is no such thing as an untrimmed submit, so the
        // selection starts at the largest legal one rather than at nothing.
        setRange({ start: 0, end: Math.min(maxSeconds, found) });
        setTrimOpen(true);
      } else {
        setRange({ start: 0, end: found });
      }
    },
    [maxSeconds]
  );

  function cancel() {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setPhase("idle");
    setProgress(0);
  }

  const isVideoFile = !!file && !file.type.startsWith("image/");
  const durationKnown = duration !== null && duration > 0;
  const awaitingMetadata = isVideoFile && !durationKnown && !decodeFailed;
  const plausiblyOverCap = !!file && file.size > maxSeconds * ASSUMED_MIN_BYTES_PER_SECOND;
  const mustTrim =
    isVideoFile &&
    (durationKnown ? duration > maxSeconds : decodeFailed && plausiblyOverCap);

  const selectionLength = range.end - range.start;
  const hasSelection = selectionLength > 0;
  const selectionOverCap = hasSelection && selectionLength > maxSeconds;
  const segmentBlocked =
    isVideoFile && (selectionOverCap || (mustTrim && !hasSelection) || awaitingMetadata);

  function toggleTrim() {
    const next = !trimOpen;
    // A selection the user can no longer see must never be the one submitted.
    // Only reachable with a readable duration: an undecodable file gets no
    // toggle at all, precisely so its typed range is never hidden from view.
    if (!next && durationKnown) setRange({ start: 0, end: duration });
    setTrimOpen(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!authed) {
      router.push("/auth/login?next=/upload");
      return;
    }
    if (remaining <= 0) {
      router.push("/upgrade");
      return;
    }

    try {
      if (file) {
        // With an unreadable duration any typed range is a deliberate trim;
        // with a readable one, a range that covers the file is not a trim at all.
        const trimmed =
          isVideoFile &&
          hasSelection &&
          (durationKnown
            ? range.start > SEGMENT_TRIM_EPSILON_SECONDS ||
              range.end < duration - SEGMENT_TRIM_EPSILON_SECONDS
            : true);

        setPhase("uploading");
        setProgress(0);
        const supabase = createClient();
        const { data: session } = await supabase.auth.getSession();
        const { data: userData } = await supabase.auth.getUser();
        const token = session.session?.access_token;
        const userId = userData.user?.id;
        if (!token || !userId) throw new Error("Your session expired. Sign in again.");

        const path = `${userId}/${crypto.randomUUID()}.${extension(file.name)}`;
        await uploadWithProgress(file, path, token, setProgress, xhrRef);

        setPhase("creating");
        const res = await fetch("/api/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath: path,
            sourceType: file.type.startsWith("image/") ? "frame_upload" : "video_upload",
            title: file.name.replace(/\.[^.]+$/, ""),
            sizeBytes: file.size,
            ...(trimmed ? { segmentStart: range.start, segmentEnd: range.end } : {}),
            ...(focus.trim() ? { focus: focus.trim() } : {}),
          }),
        });
        await handleResponse(res);
        return;
      }

      if (linkSourcesEnabled && url.trim()) {
        setPhase("creating");
        const res = await fetch("/api/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
        await handleResponse(res);
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setPhase("error");
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  async function handleResponse(res: Response) {
    const data = (await res.json().catch(() => ({}))) as {
      videoId?: string;
      message?: string;
      error?: string;
    };
    if (res.status === 402) {
      router.push("/upgrade");
      return;
    }
    if (!res.ok || !data.videoId) {
      setPhase("error");
      setError(data.message ?? data.error ?? "Could not start the analysis");
      return;
    }
    setPhase("queued");
    router.push(`/videos/${data.videoId}`);
  }

  const busy = phase === "uploading" || phase === "creating" || phase === "queued";

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped) chooseFile(dropped);
        }}
        className={`rounded-[3px] border border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? "border-accent bg-accent/5" : "border-line bg-ink-1"
        }`}
      >
        {file ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-[13px] text-text-0 truncate max-w-full">{file.name}</p>
            <p className="text-[12px] text-text-2">{formatBytes(file.size)}</p>
            {!busy ? (
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  resetSegment();
                }}
                className="text-[12px] text-text-2 hover:text-text-0"
              >
                Choose a different file
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="text-[14px] text-text-0">Drop a video here</p>
            <p className="mt-1 text-[12px] text-text-2">
              MP4, MOV, M4V, WebM, MKV{stillUploadsEnabled ? " or a still" : ""} · up to{" "}
              {formatBytes(limits.maxUploadBytes)} ·{" "}
              {formatDurationLimit(maxSeconds)} max
            </p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="mt-4 inline-flex h-9 items-center rounded-[3px] border border-line px-3.5 text-[13px] font-medium text-text-0 hover:border-line-strong hover:bg-ink-2"
            >
              Choose a file
            </button>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={stillUploadsEnabled ? ACCEPT_ATTRIBUTE : ACCEPT_VIDEO_ATTRIBUTE}
          className="sr-only"
          onChange={(e) => {
            const next = e.target.files?.[0];
            if (next) chooseFile(next);
          }}
        />
      </div>

      {file && isVideoFile ? (
        <div className="flex flex-col gap-3">
          {mustTrim ? (
            <p className="text-[13px] leading-relaxed text-text-1">
              Segments are limited to {formatDurationLimit(maxSeconds)} on your plan. Pick the
              part you want broken down.
            </p>
          ) : decodeFailed ? (
            /*
              No toggle for a file the browser could not decode. Collapsing is
              what clears the range, and the typed in and out points live in the
              trimmer: hiding them would leave the fields showing a selection
              this form would no longer submit. Blank fields already mean "the
              whole file", so there is nothing a toggle would add.
            */
            <p className="text-[12px] text-text-3">
              Leave the in and out points blank to break down the whole file.
            </p>
          ) : (
            <button
              type="button"
              onClick={toggleTrim}
              aria-expanded={trimOpen}
              aria-controls={trimmerId}
              className="self-start text-[13px] text-text-1 hover:text-text-0"
            >
              {trimOpen ? "Use the whole file" : "Trim to a segment"}
            </button>
          )}

          {/*
            Mounted even while collapsed: the duration is read from the file
            here, and it is what decides whether trimming is optional at all.
          */}
          <div id={trimmerId} hidden={!mustTrim && !decodeFailed && !trimOpen}>
            <SegmentTrimmer
              key={`${file.name}-${file.size}-${file.lastModified}`}
              file={file}
              maxSeconds={maxSeconds}
              value={range}
              onChange={setRange}
              onDurationKnown={handleDurationKnown}
            />
          </div>

          {/* Said out here as well, because the trimmer saying it may be hidden. */}
          {awaitingMetadata ? (
            <p aria-live="polite" className="text-[12px] text-text-3">
              Reading the file…
            </p>
          ) : null}
        </div>
      ) : null}

      {file ? <FocusField value={focus} onChange={setFocus} disabled={busy} /> : null}

      {linkSourcesEnabled && !file ? (
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-line" />
          <span className="eyebrow">or paste a link</span>
          <div className="h-px flex-1 bg-line" />
        </div>
      ) : null}

      {linkSourcesEnabled && !file ? (
        <div>
          <label htmlFor="source-url" className="sr-only">
            Video URL
          </label>
          <input
            id="source-url"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="YouTube, TikTok or Instagram URL"
            className="h-10 w-full rounded-[3px] border border-line bg-ink-1 px-3 text-[13px] text-text-0 placeholder-text-3 focus:border-line-strong focus:outline-none"
          />
          <p className="mt-1.5 text-[12px] text-text-3">
            A link analyzes the video&apos;s cover frame as a single shot. Upload the file to detect
            every shot in it.
          </p>
        </div>
      ) : null}

      {phase === "uploading" ? (
        <div>
          <div className="flex items-center justify-between text-[12px] text-text-2">
            <span>Uploading… {progress}%</span>
            <button type="button" onClick={cancel} className="hover:text-text-0">
              Cancel
            </button>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
            className="mt-1.5 h-0.5 w-full overflow-hidden bg-ink-3"
          >
            <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}

      {phase === "creating" || phase === "queued" ? (
        <p className="text-[13px] text-text-1">
          {phase === "creating" ? "Starting the analysis…" : "Queued. Taking you to the video…"}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || (!file && !(linkSourcesEnabled && url.trim())) || segmentBlocked}
          className="inline-flex h-10 items-center rounded-[3px] bg-text-0 px-5 text-[13px] font-medium text-ink-0 hover:bg-white disabled:opacity-40"
        >
          {busy ? "Working…" : "Break it down"}
        </button>
        {authed ? (
          <p className="text-[12px] text-text-2">
            {remaining} of {limits.videosPerMonth} analyses left this month
            {remaining <= 1 ? (
              <>
                {" · "}
                <Link href="/upgrade" className="text-accent hover:underline">
                  Upgrade
                </Link>
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-[12px] text-text-2">You&apos;ll be asked to sign in first.</p>
        )}
      </div>
    </form>
  );
}

function uploadWithProgress(
  file: File,
  path: string,
  token: string,
  onProgress: (n: number) => void,
  xhrRef: React.RefObject<XMLHttpRequest | null>
): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anon) return Promise.reject(new Error("Storage is not configured"));

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", `${base}/storage/v1/object/${UPLOAD_BUCKET}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", anon);
    xhr.setRequestHeader("x-upsert", "false");
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(xhr.status === 413 ? "That file is too large." : "Upload failed."));
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      reject(new Error("Upload failed — check your connection and try again."));
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      const err = new Error("Upload canceled");
      err.name = "AbortError";
      reject(err);
    };
    xhr.send(file);
  });
}
