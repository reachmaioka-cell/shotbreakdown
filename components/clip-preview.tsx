"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  clipPosterCandidates,
  extractYoutubeId,
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
 * Grid thumbnail. On a mouse, moving across the still scrubs numbered frames
 * from the clip so you can tell whether it is worth opening. Touch skips hover
 * and just shows the still — tap is handled by the parent link. The shot page
 * is where the real video plays; embedding YouTube on every tile hid the scrub
 * and often failed to play.
 */
export function ClipPreview({
  sourceUrl,
  thumbnailUrl,
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
  const canHover = enableHover && finePointer && !reducedMotion && scrubFrames.length > 1;

  useEffect(() => {
    if (!canHover) return;
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
  }, [canHover, scrubFrames]);

  function beginHover() {
    if (!canHover) return;
    setHovering(true);
  }

  function endHover() {
    setHovering(false);
    setScrubIndex(0);
  }

  function scrubAt(clientX: number, currentTarget: HTMLDivElement) {
    if (!canHover) return;
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

  const liveScrub = hovering && canHover && !deadScrub.has(scrubIndex) ? scrubFrames[scrubIndex] : null;

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
    </div>
  );
}
