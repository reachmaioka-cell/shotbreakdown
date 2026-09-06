"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AddToCollection } from "@/components/add-to-collection";
import { ShotCell } from "@/components/library/shot-cell";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/primitives";
import { setResultSet } from "@/lib/result-set";
import type { ShotCard } from "@/lib/shot-format";

export type Density = "comfortable" | "compact";

/** Target row height per density, in CSS pixels. */
const ROW_HEIGHT: Record<Density, number> = {
  comfortable: 220,
  compact: 160,
};

/**
 * A frame with no measured size is drawn 16:9 rather than dropped: an unknown
 * ratio is a gap in the metadata, not a reason to hide the shot. Extremes are
 * clamped because one corrupt row should not be able to stretch a whole line.
 */
function aspectOf(shot: Pick<ShotCard, "width" | "height" | "aspectRatio">): number {
  let ratio: number | null = null;
  if (shot.width && shot.height) ratio = shot.width / shot.height;
  else if (shot.aspectRatio?.includes(":")) {
    const [w, h] = shot.aspectRatio.split(":").map(Number);
    if (w && h) ratio = w / h;
  }
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) ratio = 16 / 9;
  return Math.min(5, Math.max(0.2, ratio));
}

/*
 * Density is shared by two components the page mounts in different slots — the
 * toggle lives in the top bar, the grid in the main region — so it cannot be
 * React state owned by either. A module store is the smallest thing that lets
 * both read and write it without a provider the server page would have to wrap
 * around both slots.
 */
const DENSITY_KEY = "sb:library-density";
let densityValue: Density = "comfortable";
let densityRestored = false;
const densityListeners = new Set<() => void>();

function emitDensity() {
  for (const listener of densityListeners) listener();
}

function subscribeDensity(listener: () => void) {
  densityListeners.add(listener);
  return () => {
    densityListeners.delete(listener);
  };
}

function densitySnapshot(): Density {
  return densityValue;
}

/*
 * The server cannot know what this browser stored, so it renders the default
 * and the stored choice is applied after hydration. Reading localStorage in the
 * snapshot instead would make the first client render disagree with the HTML.
 */
function densityServerSnapshot(): Density {
  return "comfortable";
}

export function setDensity(next: Density) {
  if (densityValue === next) return;
  densityValue = next;
  try {
    localStorage.setItem(DENSITY_KEY, next);
  } catch {
    // Private mode and blocked site data: the choice just does not persist.
  }
  emitDensity();
}

export function useDensity(): Density {
  const value = useSyncExternalStore(subscribeDensity, densitySnapshot, densityServerSnapshot);

  useEffect(() => {
    if (densityRestored) return;
    densityRestored = true;
    try {
      const stored = localStorage.getItem(DENSITY_KEY);
      if (stored === "compact" || stored === "comfortable") {
        densityValue = stored;
        emitDensity();
      }
    } catch {
      // Storage unavailable: stay on the default.
    }
  }, []);

  return value;
}

const DENSITY_OPTIONS: { key: Density; label: string }[] = [
  { key: "comfortable", label: "Comfortable" },
  { key: "compact", label: "Compact" },
];

/** The top bar's half of the density control. Writes the shared store. */
export function DensityToggle() {
  const density = useDensity();
  return (
    <div
      role="group"
      aria-label="Grid density"
      className="flex shrink-0 items-center gap-0.5 rounded-[var(--radius)] border border-line bg-ink-1 p-0.5"
    >
      {DENSITY_OPTIONS.map((option) => {
        const on = option.key === density;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => setDensity(option.key)}
            aria-pressed={on}
            title={option.label}
            className={`flex h-6 items-center gap-1 rounded-[var(--radius)] px-1.5 transition-colors ${
              on ? "bg-ink-3 text-text-0" : "text-text-2 hover:text-text-0"
            }`}
          >
            <span aria-hidden className="flex items-end gap-[2px]">
              {(option.key === "comfortable" ? [7, 7] : [5, 5, 5]).map((h, i) => (
                <span
                  key={i}
                  className="block w-[3px] bg-current"
                  style={{ height: `${h}px` }}
                />
              ))}
            </span>
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export type JustifiedGridProps = {
  initialShots: ShotCard[];
  initialTotal: number;
  savedIds?: string[];
  /** Segments that already have a breakdown, so a cell can mark its own. */
  breakdownVideoIds?: string[];
  /** Query string used to fetch the next page. */
  queryString: string;
  pageSize?: number;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: React.ReactNode;
  /** Overrides the shared density store — otherwise the top bar toggle wins. */
  density?: Density;
  /** Enables ← → / n / p navigation across the grid. */
  keyboardNav?: boolean;
};

/**
 * A justified contact sheet: every frame keeps its own shape and every row
 * fills the width.
 *
 * The arithmetic is left to flexbox rather than measured in JS. Give each cell
 * a basis of `aspect × row height` and a grow factor of `aspect`, and the free
 * space a row has left over is shared out in proportion to width — so the
 * widths in a row stay in the same ratio as their aspects, which is exactly the
 * condition for every cell in that row to end up the same height. A 2.39:1 and
 * a 9:16 therefore sit side by side, both undistorted.
 *
 * The trailing spacer is what stops the last row — which has no reason to be
 * full — from blowing three frames up to the width of the screen.
 */
export function JustifiedGrid({
  initialShots,
  initialTotal,
  savedIds = [],
  breakdownVideoIds = [],
  queryString,
  pageSize = 48,
  emptyTitle = "No shots match",
  emptyBody = "Try removing a filter or searching for something looser.",
  emptyAction,
  density,
  keyboardNav = true,
}: JustifiedGridProps) {
  const storedDensity = useDensity();
  const active = density ?? storedDensity;
  const rowHeight = ROW_HEIGHT[active];

  const [shots, setShots] = useState(initialShots);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  // Only an arrow key may move focus. Tabbing into a cell syncs the caret so
  // the next arrow continues from there, and must not pull focus back out of
  // whatever the user actually landed on.
  const pendingFocus = useRef(false);
  // Saved ids grow as pages are appended, so this cannot be a memo over the
  // initial prop — every shot past the first page would render as unsaved.
  const [savedSet, setSavedSet] = useState(() => new Set(savedIds));
  const [breakdownSet, setBreakdownSet] = useState(() => new Set(breakdownVideoIds));

  // A new query means a new result set: adopt it during render so the grid does
  // not paint the previous query's shots first.
  const [seenQuery, setSeenQuery] = useState(queryString);
  if (seenQuery !== queryString) {
    setSeenQuery(queryString);
    setShots(initialShots);
    setTotal(initialTotal);
    setSavedSet(new Set(savedIds));
    setBreakdownSet(new Set(breakdownVideoIds));
    setFocusIndex(-1);
  }

  /*
   * Publish what is on screen so an opened shot knows its neighbours.
   *
   * This runs on every page-in as well as every new query, which is the point:
   * arrowing past the end of page one should reach page two. setResultSet drops
   * an unchanged list, so re-publishing is cheap.
   */
  useEffect(() => {
    setResultSet(shots);
  }, [shots]);

  const loadMore = useCallback(async () => {
    if (loading || shots.length >= total) return;
    setLoading(true);
    setError(null);
    try {
      const separator = queryString.includes("?") ? "&" : "?";
      const res = await fetch(
        `/api/shots/search${queryString}${separator}offset=${shots.length}&limit=${pageSize}`
      );
      if (!res.ok) throw new Error("Could not load more shots");
      const data = (await res.json()) as {
        shots: ShotCard[];
        total: number;
        savedIds?: string[];
      };
      setShots((current) => {
        const seen = new Set(current.map((s) => s.id));
        return [...current, ...data.shots.filter((s) => !seen.has(s.id))];
      });
      if (data.savedIds?.length) {
        const ids = data.savedIds;
        setSavedSet((current) => new Set([...current, ...ids]));
      }
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more shots");
    } finally {
      setLoading(false);
    }
  }, [loading, shots.length, total, queryString, pageSize]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "800px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  useEffect(() => {
    if (!keyboardNav) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowRight" || event.key === "n") {
        pendingFocus.current = true;
        setFocusIndex((i) => Math.min(shots.length - 1, i + 1));
      } else if (event.key === "ArrowLeft" || event.key === "p") {
        pendingFocus.current = true;
        setFocusIndex((i) => Math.max(0, i - 1));
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboardNav, shots.length]);

  useEffect(() => {
    if (focusIndex < 0 || !pendingFocus.current) return;
    pendingFocus.current = false;
    const anchors = gridRef.current?.querySelectorAll<HTMLElement>("[data-shot-anchor]");
    anchors?.[focusIndex]?.focus();
  }, [focusIndex]);

  function syncCaret(event: React.FocusEvent<HTMLUListElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-cell-index]");
    if (!cell) return;
    const index = Number(cell.dataset.cellIndex);
    if (!Number.isInteger(index) || index === focusIndex) return;
    pendingFocus.current = false;
    setFocusIndex(index);
  }

  const countLabel = `${total.toLocaleString()} shot${total === 1 ? "" : "s"}`;

  return (
    <div>
      {shots.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} action={emptyAction} />
      ) : (
        <ul ref={gridRef} onFocus={syncCaret} className="m-0 flex list-none flex-wrap gap-1 p-0">
          {shots.map((shot, index) => {
            const aspect = aspectOf(shot);
            return (
              <li
                key={shot.id}
                data-cell-index={index}
                className="relative min-w-0"
                style={{
                  flexGrow: aspect,
                  flexBasis: `${aspect * rowHeight}px`,
                  aspectRatio: String(aspect),
                }}
              >
                <ShotCell
                  shot={shot}
                  priority={index < 4}
                  saved={savedSet.has(shot.id)}
                  hasBreakdown={breakdownSet.has(shot.videoId)}
                  actions={<AddToCollection shotId={shot.id} compact />}
                />
              </li>
            );
          })}
          {/*
            Zero-width, so it always joins the final row rather than wrapping
            past it, and greedy enough that the frames beside it keep their
            target height instead of being justified across the whole width.
          */}
          <li aria-hidden className="h-0" style={{ flex: "999 0 0%" }} />
        </ul>
      )}

      <div ref={sentinelRef} className="h-8" />

      <div className="flex justify-center py-6">
        {error ? (
          <ErrorState
            title="Could not load more"
            body={error}
            action={
              <button
                type="button"
                onClick={() => void loadMore()}
                className="text-[13px] text-accent hover:underline"
              >
                Try again
              </button>
            }
          />
        ) : loading ? (
          <Spinner label="Loading more" />
        ) : shots.length < total ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="text-[13px] text-text-2 hover:text-text-0"
          >
            Load more
          </button>
        ) : null}
      </div>

      {/*
        The one live region for the result count. It sits here rather than in
        the top bar because this is the only component that knows the total
        after a page has been appended.
      */}
      <p className="pb-2 text-center text-[12px] text-text-3" aria-live="polite">
        {shots.length > 0 && shots.length < total
          ? `${shots.length.toLocaleString()} of ${countLabel}`
          : countLabel}
      </p>
    </div>
  );
}
