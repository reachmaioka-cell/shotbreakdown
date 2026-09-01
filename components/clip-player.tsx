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

/**
 * Shot page player. YouTube/TikTok play via the existing nocookie embed;
 * uploaded files use a native video element. Autoplay is muted so the clip
 * actually starts (browsers block unmuted autoplay).
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
  const [videoFailed, setVideoFailed] = useState(false);
  const ytId = extractYoutubeId(sourceUrl ?? "") ?? extractYoutubeId(posterUrl ?? "");

  if (embedUrl) {
    return (
      <iframe
        src={embedUrl}
        title={alt}
        className="absolute inset-0 h-full w-full"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    );
  }

  if (playbackUrl && !videoFailed) {
    return (
      <video
        src={playbackUrl}
        poster={posterUrl ?? undefined}
        className="absolute inset-0 h-full w-full object-contain bg-black"
        controls
        autoPlay
        muted
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
    return <ShotPoster src={posterUrl} alt={alt} sourceUrl={sourceUrl ?? (ytId ? `https://www.youtube.com/watch?v=${ytId}` : null)} />;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-3">
      No frame available
    </div>
  );
}
