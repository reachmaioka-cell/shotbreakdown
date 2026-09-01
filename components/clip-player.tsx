"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { clipEmbedUrl, extractYoutubeId } from "@/lib/clip";
import { ShotPoster } from "@/components/shot-poster";

function originSnapshot() {
  return window.location.origin;
}

function subscribeOrigin() {
  return () => {};
}

function PlayPoster({
  posterUrl,
  sourceUrl,
  ytId,
  alt,
  onPlay,
}: {
  posterUrl?: string | null;
  sourceUrl?: string | null;
  ytId: string | null;
  alt: string;
  onPlay: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Play ${alt}`}
      className="absolute inset-0 block w-full cursor-pointer"
    >
      {posterUrl ? (
        <ShotPoster
          src={posterUrl}
          alt={alt}
          sourceUrl={sourceUrl ?? (ytId ? `https://www.youtube.com/watch?v=${ytId}` : null)}
        />
      ) : (
        <div className="absolute inset-0 bg-ink-2" />
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-text-0 ring-1 ring-white/20"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5.14v13.72L19.5 12 8 5.14z" />
        </svg>
      </span>
    </button>
  );
}

/**
 * Shot page player. The poster is the still; a click (a real user gesture)
 * starts the clip. YouTube/TikTok use the nocookie embed; uploads use a
 * native video element. Autoplay-on-load was blocked in the iframe and looked
 * like the video was missing.
 */
export function ClipPlayer({
  posterUrl,
  sourceUrl,
  playbackUrl,
  startSeconds = 0,
  endSeconds = 0,
  alt,
}: {
  posterUrl?: string | null;
  sourceUrl?: string | null;
  playbackUrl?: string | null;
  startSeconds?: number;
  endSeconds?: number;
  alt: string;
}) {
  const origin = useSyncExternalStore(subscribeOrigin, originSnapshot, () => "");
  const [playing, setPlaying] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const ytId = extractYoutubeId(sourceUrl ?? "") ?? extractYoutubeId(posterUrl ?? "");

  const embedUrl = useMemo(
    () =>
      clipEmbedUrl({
        sourceUrl,
        thumbnailUrl: posterUrl,
        startSeconds,
        endSeconds: endSeconds > startSeconds ? endSeconds : undefined,
        autoplay: true,
        mute: true,
        controls: true,
        loop: false,
        enableJsApi: true,
        origin: origin || undefined,
      }),
    [sourceUrl, posterUrl, startSeconds, endSeconds, origin]
  );

  if (embedUrl) {
    if (!playing) {
      return (
        <PlayPoster
          posterUrl={posterUrl}
          sourceUrl={sourceUrl}
          ytId={ytId}
          alt={alt}
          onPlay={() => setPlaying(true)}
        />
      );
    }
    return (
      <iframe
        src={embedUrl}
        title={alt}
        className="absolute inset-0 h-full w-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }

  if (playbackUrl && !videoFailed) {
    if (!playing) {
      return (
        <PlayPoster
          posterUrl={posterUrl}
          sourceUrl={sourceUrl}
          ytId={ytId}
          alt={alt}
          onPlay={() => setPlaying(true)}
        />
      );
    }
    return (
      <video
        src={playbackUrl}
        poster={posterUrl ?? undefined}
        className="absolute inset-0 h-full w-full object-contain bg-black"
        controls
        autoPlay
        playsInline
        onError={() => setVideoFailed(true)}
        onLoadedMetadata={(event) => {
          const el = event.currentTarget;
          if (startSeconds > 0 && Number.isFinite(startSeconds)) {
            el.currentTime = startSeconds;
          }
        }}
      />
    );
  }

  if (posterUrl) {
    return (
      <ShotPoster
        src={posterUrl}
        alt={alt}
        sourceUrl={sourceUrl ?? (ytId ? `https://www.youtube.com/watch?v=${ytId}` : null)}
      />
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-3">
      No frame available
    </div>
  );
}
