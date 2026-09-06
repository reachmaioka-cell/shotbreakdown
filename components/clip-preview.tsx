"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  clipEmbedUrl,
  clipPosterCandidates,
  extractYoutubeId,
  isClipBoundedSpan,
  isYoutubeThumbUrl,
  youtubeScrubFrameUrls,
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

/**
 * Grid thumbnail. Whole-video cards (start and end unset) scrub numbered
 * YouTube stills on hover. Bounded shots — a detected span inside a longer
 * video — keep the extracted still and optionally play that span only.
 * Numbered stills are ~0/25/50/75% of the full MV, so they must not be used
 * when end > start.
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
  const bounded = isClipBoundedSpan(startSeconds, endSeconds);
  const posters = useMemo(
    () => clipPosterCandidates({ sourceUrl, thumbnailUrl }),
    [sourceUrl, thumbnailUrl]
  );
  const ytId = extractYoutubeId(sourceUrl ?? "") ?? extractYoutubeId(thumbnailUrl ?? "");
  const scrubFrames = useMemo(
    () => (ytId && !bounded ? youtubeScrubFrameUrls(ytId) : []),
    [ytId, bounded]
  );
  const hoverEmbed = useMemo(
    () =>
      bounded
        ? clipEmbedUrl({
            sourceUrl,
            thumbnailUrl,
            startSeconds,
            endSeconds,
            autoplay: true,
            mute: true,
            controls: false,
            loop: false,
          })
        : null,
    [bounded, sourceUrl, thumbnailUrl, startSeconds, endSeconds]
  );
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

  const [posterIndex, setPosterIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [scrubIndex, setScrubIndex] = useState(0);
  const [deadScrub, setDeadScrub] = useState<Set<number>>(() => new Set());

  const poster = posters[posterIndex] ?? null;
  const canHoverScrub = enableHover && finePointer && !reducedMotion && scrubFrames.length > 1;
  const canHoverEmbed = enableHover && finePointer && !reducedMotion && !!hoverEmbed;
  const canHover = canHoverScrub || canHoverEmbed;

  useEffect(() => {
    if (!canHoverScrub) return;
    const frames = scrubFrames.map((src) => {
      const img = new window.Image();
      img.src = src;
      return img;
    });
    return () => {
      frames.forEach((img) => {
        img.src = "";
      });
    };
  }, [canHoverScrub, scrubFrames]);

  function beginHover() {
    if (!canHover) return;
    setHovering(true);
  }

  function endHover() {
    setHovering(false);
    setScrubIndex(0);
  }

  function scrubAt(clientX: number, currentTarget: HTMLDivElement) {
    if (!canHoverScrub) return;
    const rect = currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const live = scrubFrames
      .map((url, i) => ({ url, i }))
      .filter((frame) => !deadScrub.has(frame.i));
    if (live.length === 0) return;
    const pick = live[Math.min(live.length - 1, Math.floor(t * live.length))];
    if (pick) setScrubIndex(pick.i);
  }

  const liveScrub = hovering && canHoverScrub && !deadScrub.has(scrubIndex) ? scrubFrames[scrubIndex] : null;
  const liveEmbed = hovering && canHoverEmbed ? hoverEmbed : null;

  return (
    <div
      className={`relative overflow-hidden bg-ink-2 ${className}`}
      data-clip-bounded={bounded ? "true" : "false"}
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

      {liveScrub ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={liveScrub}
          alt=""
          className="absolute inset-0 h-full w-full object-cover pointer-events-none"
          onError={() =>
            setDeadScrub((current) => {
              const next = new Set(current);
              next.add(scrubIndex);
              return next;
            })
          }
        />
      ) : null}

      {liveEmbed ? (
        <iframe
          src={liveEmbed}
          title=""
          className="absolute inset-0 h-full w-full pointer-events-none"
          allow="autoplay; encrypted-media"
          tabIndex={-1}
        />
      ) : null}
    </div>
  );
}
