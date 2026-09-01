"use client";

import Image from "next/image";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  clipEmbedUrl,
  clipPosterCandidates,
  extractYoutubeId,
  isYoutubeThumbUrl,
  youtubeScrubFrameUrls,
  youtubeSeekCommand,
} from "@/lib/clip";

function subscribeMedia(query: string) {
  return (onStoreChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", onStoreChange);
    return () => mq.removeEventListener("change", onStoreChange);
  };
}

function mediaSnapshot(query: string, fallback = false) {
  return () => (typeof window === "undefined" ? fallback : window.matchMedia(query).matches);
}

function originSnapshot() {
  return window.location.origin;
}

function subscribeOrigin() {
  return () => {};
}

/**
 * Thumbnail that becomes the clip on hover: muted autoplay plus horizontal
 * scrub (YouTube numbered stills and iframe seek). Touch devices skip hover
 * and just see the still — tap is handled by the parent link.
 */
export function ClipPreview({
  sourceUrl,
  thumbnailUrl,
  startSeconds = 0,
  endSeconds = 0,
  alt = "",
  sizes,
  className = "",
  priority = false,
  enableHover = true,
}: {
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
  startSeconds?: number;
  endSeconds?: number;
  alt?: string;
  sizes: string;
  className?: string;
  priority?: boolean;
  enableHover?: boolean;
}) {
  const posters = useMemo(
    () => clipPosterCandidates({ sourceUrl, thumbnailUrl }),
    [sourceUrl, thumbnailUrl]
  );
  const ytId = extractYoutubeId(sourceUrl ?? "") ?? extractYoutubeId(thumbnailUrl ?? "");
  const scrubFrames = useMemo(() => (ytId ? youtubeScrubFrameUrls(ytId) : []), [ytId]);
  const origin = useSyncExternalStore(subscribeOrigin, originSnapshot, () => "");
  const reducedMotion = useSyncExternalStore(
    subscribeMedia("(prefers-reduced-motion: reduce)"),
    mediaSnapshot("(prefers-reduced-motion: reduce)"),
    () => false
  );
  const finePointer = useSyncExternalStore(
    subscribeMedia("(hover: hover) and (pointer: fine)"),
    mediaSnapshot("(hover: hover) and (pointer: fine)"),
    () => false
  );
  const embedUrl = clipEmbedUrl({
    sourceUrl,
    thumbnailUrl,
    startSeconds,
    endSeconds: endSeconds > startSeconds ? endSeconds : undefined,
    autoplay: true,
    mute: true,
    controls: false,
    enableJsApi: true,
    origin: origin || undefined,
    loop: true,
  });

  const [posterIndex, setPosterIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [scrubUrl, setScrubUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastSeek = useRef(0);

  const poster = posters[posterIndex] ?? null;
  const canHover = enableHover && finePointer && !reducedMotion;
  const play = canHover && hovering && !!embedUrl;

  function beginHover() {
    if (!canHover) return;
    setHovering(true);
  }

  function endHover() {
    setHovering(false);
    setScrubUrl(null);
  }

  function scrubAt(clientX: number, currentTarget: HTMLDivElement) {
    const rect = currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));

    if (scrubFrames.length > 0) {
      const index = Math.min(scrubFrames.length - 1, Math.floor(t * scrubFrames.length));
      setScrubUrl(scrubFrames[index] ?? null);
    }

    const start = Math.max(0, startSeconds);
    const span = endSeconds > start ? endSeconds - start : 90;
    const seconds = start + t * span;
    const now = performance.now();
    if (now - lastSeek.current < 80) return;
    lastSeek.current = now;
    iframeRef.current?.contentWindow?.postMessage(youtubeSeekCommand(seconds), "*");
  }

  return (
    <div
      className={`relative overflow-hidden bg-ink-2 ${className}`}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") beginHover();
      }}
      onMouseEnter={beginHover}
      onPointerMove={(event) => {
        if (event.pointerType && event.pointerType !== "mouse") return;
        if (!hovering) beginHover();
        scrubAt(event.clientX, event.currentTarget);
      }}
      onMouseMove={(event) => {
        if (!hovering) beginHover();
        scrubAt(event.clientX, event.currentTarget);
      }}
      onPointerLeave={endHover}
      onMouseLeave={endHover}
    >
      {poster ? (
        isYoutubeThumbUrl(poster) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poster}
            alt={alt}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setPosterIndex((i) => (i + 1 < posters.length ? i + 1 : i))}
          />
        ) : (
          <Image
            src={poster}
            alt={alt}
            fill
            className="object-cover"
            sizes={sizes}
            priority={priority}
            onError={() => setPosterIndex((i) => (i + 1 < posters.length ? i + 1 : i))}
          />
        )
      ) : (
        <div className="absolute inset-0 bg-ink-2" />
      )}

      {play ? (
        <iframe
          ref={iframeRef}
          src={embedUrl}
          title={alt || "Clip preview"}
          className="absolute inset-0 h-full w-full pointer-events-none"
          allow="autoplay; encrypted-media"
          tabIndex={-1}
        />
      ) : null}

      {canHover && hovering && scrubUrl && !play ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={scrubUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover pointer-events-none"
        />
      ) : null}
    </div>
  );
}
