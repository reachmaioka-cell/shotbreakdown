"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { clipPosterCandidates, isYoutubeThumbUrl, preferClipFrame } from "@/lib/clip";

/**
 * Hero frame on the shot page. YouTube maxres URLs often 404 while hq/sd still
 * exist — cycle the same fallbacks the library tiles already know about.
 */
export function ShotPoster({
  src,
  alt,
  sourceUrl,
}: {
  src: string;
  alt: string;
  sourceUrl?: string | null;
}) {
  const candidates = useMemo(() => {
    const preferred = preferClipFrame(src, sourceUrl);
    const extras = clipPosterCandidates({ sourceUrl, thumbnailUrl: src });
    return [preferred, ...extras].filter((url, i, all): url is string => !!url && all.indexOf(url) === i);
  }, [src, sourceUrl]);
  const [index, setIndex] = useState(0);
  const current = candidates[index];

  if (!current) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-3">
        No frame available
      </div>
    );
  }

  if (isYoutubeThumbUrl(current)) {
    return (
      // YouTube thumbs skip the Next optimizer: local/dev DNS and the
      // image pipeline often 500 on i.ytimg.com while the browser can load them.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={current}
        alt={alt}
        className="absolute inset-0 h-full w-full object-contain"
        onError={() => setIndex((i) => i + 1)}
      />
    );
  }

  return (
    <Image
      src={current}
      alt={alt}
      fill
      priority
      sizes="(max-width: 1024px) 100vw, 1100px"
      className="object-contain"
      onError={() => setIndex((i) => i + 1)}
    />
  );
}
