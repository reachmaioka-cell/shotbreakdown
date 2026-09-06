"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AddToCollection } from "@/components/add-to-collection";
import { ClipPlayer } from "@/components/clip-player";
import { SaveButton } from "@/components/save-button";
import { Pill, Tabs } from "@/components/ui/primitives";
import { humanize } from "@/lib/filters";
import { useResultNeighbours } from "@/lib/result-set";
import { formatDuration, formatTimecode } from "@/lib/shot-format";

export type ShotOverlayShot = {
  id: string;
  slug: string | null;
  videoId: string;
  shotIndex: number;
  title: string | null;
  summary: string | null;
  description: string | null;
  posterUrl: string | null;
  playbackUrl: string | null;
  sourceUrl: string | null;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  width: number | null;
  height: number | null;
  tags: string[];
  videoTitle: string | null;
};

export type ShotOverlayFrame = {
  id: string;
  thumbUrl: string | null;
  timestampSeconds: number;
};

function NavButton({
  href,
  direction,
  onNavigate,
}: {
  href: string | null;
  direction: "prev" | "next";
  onNavigate: (href: string) => void;
}) {
  const label = direction === "prev" ? "Previous shot" : "Next shot";
  return (
    <button
      type="button"
      disabled={!href}
      onClick={() => href && onNavigate(href)}
      aria-label={label}
      title={`${label} (${direction === "prev" ? "←" : "→"})`}
      aria-keyshortcuts={direction === "prev" ? "ArrowLeft" : "ArrowRight"}
      className="flex h-7 w-7 items-center justify-center rounded-[var(--radius)] border border-line text-text-1 transition-colors hover:border-line-strong hover:text-text-0 disabled:cursor-default disabled:opacity-35 disabled:hover:border-line disabled:hover:text-text-1 motion-reduce:transition-none"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d={direction === "prev" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/**
 * The shot, opened over the grid it was clicked from.
 *
 * A native <dialog> rather than a hand-rolled overlay: the platform gives us
 * the top layer, the inert background, Esc, and — the part that is hard to
 * reproduce — focus returning to the tile that opened it. Every close path goes
 * through close() so that restore always happens before the route unwinds.
 */
export function ShotOverlay({
  shot,
  saved,
  specs,
  frames = [],
}: {
  shot: ShotOverlayShot;
  saved: boolean;
  /** Server-rendered ShotMetadataPanel, or null when the shot has no analysis. */
  specs: ReactNode;
  frames?: ShotOverlayFrame[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const saveRef = useRef<HTMLSpanElement>(null);
  const leavingRef = useRef(false);
  const [tab, setTab] = useState("specs");
  const [shown, setShown] = useState(false);
  const titleId = useId();

  const { prev, next } = useResultNeighbours(shot.slug ?? shot.id);
  const heading = shot.summary ?? shot.title ?? "Untitled shot";

  const close = useCallback(() => {
    const el = dialogRef.current;
    if (el?.open) el.close();
    else if (!leavingRef.current) {
      leavingRef.current = true;
      router.back();
    }
  }, [router]);

  // Fired by Esc, the backdrop, and the close button alike. The dialog has
  // already handed focus back to the opener by the time this runs, so it is
  // safe to unwind the route.
  const onDialogClose = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    router.back();
  }, [router]);

  const goTo = useCallback(
    (href: string) => {
      // replace, not push: the grid stays the entry behind the overlay, so Esc
      // is always one step home however many shots were paged through.
      router.replace(href, { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
    setShown(true);
  }, []);

  // The page behind a modal dialog still scrolls in most browsers, which reads
  // as the grid sliding around under the overlay. overflow:hidden keeps
  // scrollTop, so the grid is exactly where it was when this is undone.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;

      const target = event.target as HTMLElement | null;
      // Typing in the collection picker must never move the shot or toggle save.
      if (
        target &&
        (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      // The tablist owns left/right for moving between tabs.
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        target?.closest('[role="tablist"]')
      ) {
        return;
      }

      if (event.key === "ArrowLeft" && prev) {
        event.preventDefault();
        goTo(prev);
      } else if (event.key === "ArrowRight" && next) {
        event.preventDefault();
        goTo(next);
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        // SaveButton owns the request, the optimistic flip and the auth
        // redirect. Clicking it is how the shortcut inherits all of that
        // without a second copy of the logic here.
        saveRef.current?.querySelector("button")?.click();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prev, next, goTo]);

  const aspectRatio = shot.width && shot.height ? `${shot.width} / ${shot.height}` : "16 / 9";
  const hasRange = shot.durationSeconds > 0;
  const range = `${formatTimecode(shot.startSeconds)}–${formatTimecode(shot.endSeconds)}`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onDialogClose}
      onCancel={(event) => {
        // Esc has one meaning at a time. The collection picker closes itself on
        // Escape from its own document listener, so without this the same
        // keypress dismissed the picker AND tore down the whole overlay. The
        // picker's own state has not re-rendered yet when cancel fires, so its
        // trigger is still marked expanded and this reads true.
        if (dialogRef.current?.querySelector('[aria-haspopup="dialog"][aria-expanded="true"]')) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        // The panel is inset at desktop widths, so the dialog box itself is
        // only ever the target when the click landed outside the panel.
        if (event.target === dialogRef.current) close();
      }}
      className={`fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 text-text-0 backdrop:bg-black/85 lg:p-6 ${
        shown ? "opacity-100" : "opacity-0"
      } transition-opacity duration-150 motion-reduce:transition-none`}
    >
      <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col overflow-hidden border border-line bg-ink-0 shadow-2xl shadow-black/60 lg:rounded-[var(--radius)]">
        <div className="flex h-topbar shrink-0 items-center gap-3 border-b border-line px-3">
          {prev || next ? (
            <div className="flex items-center gap-1.5">
              <NavButton href={prev} direction="prev" onNavigate={goTo} />
              <NavButton href={next} direction="next" onNavigate={goTo} />
            </div>
          ) : null}

          <p className="mono shrink-0 text-[11px] text-text-3">Shot {shot.shotIndex + 1}</p>

          {shot.videoTitle ? (
            <Link
              href={`/videos/${shot.videoId}`}
              className="truncate text-[12px] text-text-2 hover:text-text-0"
            >
              {shot.videoTitle}
            </Link>
          ) : null}

          <button
            type="button"
            onClick={close}
            aria-label="Close shot"
            title="Close (Esc)"
            aria-keyshortcuts="Escape"
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] text-text-2 transition-colors hover:bg-ink-2 hover:text-text-0 motion-reduce:transition-none"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Moving between shots swaps the whole panel; without this the change
            is silent to anyone not looking at the screen. */}
        <p aria-live="polite" className="sr-only">
          {`Shot ${shot.shotIndex + 1}. ${heading}`}
        </p>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:overflow-hidden">
          <div className="min-w-0 p-4 lg:h-full lg:overflow-y-auto">
            <div
              className="relative w-full overflow-hidden rounded-[var(--radius)] border border-line bg-ink-1 max-h-[70vh]"
              style={{ aspectRatio }}
            >
              <ClipPlayer
                posterUrl={shot.posterUrl}
                sourceUrl={shot.sourceUrl}
                playbackUrl={shot.playbackUrl}
                startSeconds={shot.startSeconds}
                endSeconds={shot.endSeconds}
                alt={shot.description ?? heading}
              />
            </div>

            <h2 id={titleId} className="mt-4 max-w-2xl text-[17px] leading-snug font-medium text-text-0">
              {heading}
            </h2>

            {shot.description ? (
              <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-text-1">
                {shot.description}
              </p>
            ) : null}

            {shot.tags.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {shot.tags.map((tag) => (
                  <li key={tag}>
                    <Pill>{humanize(tag)}</Pill>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <span ref={saveRef}>
                <SaveButton shotId={shot.id} initialSaved={saved} />
              </span>
              <AddToCollection shotId={shot.id} />
              {hasRange ? (
                <span className="mono ml-auto text-[12px] text-text-3">
                  {range} · {formatDuration(shot.durationSeconds)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="min-w-0 border-t border-line p-4 lg:h-full lg:overflow-y-auto lg:border-t-0 lg:border-l">
            <Tabs
              value={tab}
              onChange={setTab}
              label="Shot details"
              items={[
                { key: "specs", label: "Specs" },
                { key: "segment", label: "In segment" },
              ]}
            >
              {tab === "specs" ? (
                (specs ?? (
                  <p className="text-[13px] text-text-2">This shot has not been analyzed yet.</p>
                ))
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="eyebrow mb-1.5">Segment</p>
                    <Link
                      href={`/videos/${shot.videoId}`}
                      className="block text-[13px] text-text-0 hover:text-accent"
                    >
                      {shot.videoTitle ?? "Untitled segment"}
                    </Link>
                    <p className="mt-1 text-[12px] text-text-2">
                      The full nine-department breakdown lives on the segment page.
                    </p>
                  </div>

                  <dl className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-3">
                    <dt className="text-[12px] leading-5 text-text-2">Position</dt>
                    <dd className="text-[13px] leading-5 text-text-0">Shot {shot.shotIndex + 1}</dd>
                    {hasRange ? (
                      <>
                        <dt className="text-[12px] leading-5 text-text-2">Timecode</dt>
                        <dd className="mono text-[13px] leading-5 text-text-0">{range}</dd>
                        <dt className="text-[12px] leading-5 text-text-2">Duration</dt>
                        <dd className="text-[13px] leading-5 text-text-0">
                          {formatDuration(shot.durationSeconds)}
                        </dd>
                      </>
                    ) : null}
                  </dl>

                  {frames.length > 0 ? (
                    <div className="border-t border-line pt-3">
                      <p className="eyebrow mb-2">Frames ({frames.length})</p>
                      <ul className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
                        {frames.map((frame) => (
                          <li key={frame.id} className="shrink-0">
                            {frame.thumbUrl ? (
                              // Frame URLs are signed storage links or third-party
                              // thumbnails, so the host is not always one the image
                              // optimizer is configured for.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={frame.thumbUrl}
                                alt={`Frame at ${formatTimecode(frame.timestampSeconds)}`}
                                className="h-14 w-24 rounded-[var(--radius)] border border-line object-cover"
                                loading="lazy"
                              />
                            ) : null}
                            <span className="mono mt-1 block text-[10px] text-text-3">
                              {formatTimecode(frame.timestampSeconds)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </Tabs>
          </div>
        </div>
      </div>
    </dialog>
  );
}
