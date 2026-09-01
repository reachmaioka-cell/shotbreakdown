"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";
import { ClipPreview } from "@/components/clip-preview";
import { SaveButton } from "@/components/save-button";
import type { ShotCard } from "@/lib/shot-format";

function aspectStyle(shot: Pick<ShotCard, "width" | "height" | "aspectRatio">) {
  if (shot.width && shot.height) return { aspectRatio: `${shot.width} / ${shot.height}` };
  if (shot.aspectRatio?.includes(":")) {
    const [w, h] = shot.aspectRatio.split(":").map(Number);
    if (w && h) return { aspectRatio: `${w} / ${h}` };
  }
  return { aspectRatio: "16 / 9" };
}

export type ShotTileProps = {
  shot: ShotCard;
  href: string;
  priority?: boolean;
  saved?: boolean;
  /** Rendered in the tile's action row — usually Add to collection. */
  actions?: React.ReactNode;
  /** Sequence position, shown as a shot number. */
  ordinal?: number;
  /** Intercept the click instead of navigating (video view selection). */
  onSelect?: (shot: ShotCard) => void;
  selected?: boolean;
  showMeta?: boolean;
  sizes?: string;
};

/**
 * The frame is the object. Chrome only appears on hover/focus. On pointer-fine
 * devices, moving across the still scrubs the clip so you can decide whether
 * to open it. Touch: tap opens the shot; there is no hover.
 */
export function ShotTile({
  shot,
  href,
  priority = false,
  saved = false,
  actions,
  ordinal,
  onSelect,
  selected = false,
  showMeta = true,
  sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 360px",
}: ShotTileProps) {
  const [hovering, setHovering] = useState(false);

  const caption = shot.summary ?? shot.description ?? shot.title ?? "Untitled shot";

  const body = (
    <div
      className="relative overflow-hidden bg-ink-2"
      style={aspectStyle(shot)}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovering(true);
      }}
      onPointerLeave={() => setHovering(false)}
    >
      <ClipPreview
        sourceUrl={shot.sourceUrl}
        thumbnailUrl={shot.thumbnailUrl}
        startSeconds={shot.startSeconds}
        endSeconds={shot.endSeconds}
        alt={caption}
        sizes={sizes}
        priority={priority}
        className="absolute inset-0 h-full w-full"
      />

      {ordinal !== undefined ? (
        <span className="mono absolute left-1.5 top-1.5 rounded-[2px] bg-black/70 px-1.5 py-0.5 text-[10px] text-text-0">
          {String(ordinal).padStart(2, "0")}
        </span>
      ) : null}

      {selected ? (
        <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-accent" aria-hidden />
      ) : null}
    </div>
  );

  const handleClick = (event: MouseEvent) => {
    if (!onSelect) return;
    event.preventDefault();
    onSelect(shot);
  };

  return (
    <figure
      className="group relative"
      data-hovering={hovering ? "true" : undefined}
    >
      {onSelect ? (
        <button
          type="button"
          onClick={handleClick}
          aria-pressed={selected}
          aria-label={caption}
          className="block w-full scroll-mt-20 text-left"
        >
          {body}
        </button>
      ) : (
        <Link href={href} prefetch={false} className="block scroll-mt-20" aria-label={caption}>
          {body}
        </Link>
      )}

      <div className="tile-actions absolute right-1.5 top-1.5 flex items-center gap-1">
        {actions}
        <SaveButton shotId={shot.id} initialSaved={saved} compact />
      </div>

      {showMeta ? (
        <figcaption className="mt-1 px-0.5">
          <p className="line-clamp-1 text-[11px] leading-tight text-text-2 transition-colors group-hover:text-text-0">
            {caption}
          </p>
        </figcaption>
      ) : null}
    </figure>
  );
}
