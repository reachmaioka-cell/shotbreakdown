"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ClipPreview } from "@/components/clip-preview";
import { SaveButton } from "@/components/save-button";
import { shotHref, type ShotCard } from "@/lib/shot-format";

export type ShotCellProps = {
  shot: ShotCard;
  /** Eager-loads the first screenful so the sheet does not paint grey. */
  priority?: boolean;
  saved?: boolean;
  /** The shot's segment already has a breakdown, so the cell can say so. */
  hasBreakdown?: boolean;
  /** Extra controls beside Save — usually Add to collection. */
  actions?: ReactNode;
  sizes?: string;
};

/**
 * One frame in the justified sheet.
 *
 * The cell is the image: it fills its slot edge to edge and every piece of
 * chrome sits on top of it, revealed on hover or focus. Nothing is cropped to a
 * common shape — the grid has already sized this slot to the shot's own aspect.
 *
 * The caption strip is inside the link rather than beside it, so what a screen
 * reader announces for the link is what a sighted user reads on hover: the
 * summary, then the segment it came from.
 */
export function ShotCell({
  shot,
  priority = false,
  saved = false,
  hasBreakdown = false,
  actions,
  sizes = "(max-width: 640px) 60vw, (max-width: 1024px) 40vw, 420px",
}: ShotCellProps) {
  const caption = shot.summary ?? shot.description ?? shot.title ?? "Untitled shot";

  return (
    // Not overflow-hidden: the collection picker opens out of the cell, and a
    // clipped popover is unusable. The link clips the image instead.
    <div className="group absolute inset-0 bg-ink-2">
      <Link
        href={shotHref(shot)}
        prefetch={false}
        data-shot-anchor
        className="absolute inset-0 block overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <ClipPreview
          sourceUrl={shot.sourceUrl}
          thumbnailUrl={shot.thumbnailUrl}
          startSeconds={shot.startSeconds}
          endSeconds={shot.endSeconds}
          alt=""
          sizes={sizes}
          priority={priority}
          className="absolute inset-0 h-full w-full"
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 pb-1.5 pt-6 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <p className="line-clamp-2 text-[11px] leading-tight text-text-0">{caption}</p>
          {shot.videoTitle ? (
            <p className="mt-0.5 line-clamp-1 text-[10px] leading-tight text-text-2">
              {shot.videoTitle}
            </p>
          ) : null}
        </div>
      </Link>

      {hasBreakdown ? (
        <span
          className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-[var(--radius)] bg-black/65 px-1 py-0.5 backdrop-blur-sm"
          title="This segment has a breakdown"
        >
          <span aria-hidden className="block h-1.5 w-1.5 bg-accent" />
          <span className="sr-only">Segment has a breakdown</span>
        </span>
      ) : null}

      <div className="tile-actions absolute right-1.5 top-1.5 flex items-center gap-1">
        {actions}
        <SaveButton shotId={shot.id} initialSaved={saved} compact />
      </div>
    </div>
  );
}
