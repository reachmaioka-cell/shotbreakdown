"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AddToCollection } from "@/components/add-to-collection";
import { ShotTile } from "@/components/shot-tile";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/primitives";
import { shotHref, type ShotCard } from "@/lib/shot-format";

export type ShotGridProps = {
  initialShots: ShotCard[];
  initialTotal: number;
  savedIds?: string[];
  /** Query string used to fetch the next page. */
  queryString: string;
  pageSize?: number;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: React.ReactNode;
  density?: "sm" | "md" | "lg";
  /** Enables ← → / S keyboard navigation across the grid. */
  keyboardNav?: boolean;
};

/**
 * The library grid. Pages in on scroll rather than a pagination control, keeps
 * the URL as the source of truth for the query, and never re-renders the whole
 * grid when one tile's saved state changes.
 */
export function ShotGrid({
  initialShots,
  initialTotal,
  savedIds = [],
  queryString,
  pageSize = 48,
  emptyTitle = "No shots match",
  emptyBody = "Try removing a filter or searching for something looser.",
  emptyAction,
  density = "md",
  keyboardNav = true,
}: ShotGridProps) {
  const [shots, setShots] = useState(initialShots);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Saved ids grow as pages are appended, so this cannot be a memo over the
  // initial prop — every shot past the first page would render as unsaved.
  const [savedSet, setSavedSet] = useState(() => new Set(savedIds));

  // A new query means a new result set: adopt it during render so the grid does
  // not paint the previous query's shots first.
  const [seenQuery, setSeenQuery] = useState(queryString);
  if (seenQuery !== queryString) {
    setSeenQuery(queryString);
    setShots(initialShots);
    setTotal(initialTotal);
    setSavedSet(new Set(savedIds));
    setFocusIndex(-1);
  }

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
        setSavedSet((current) => new Set([...current, ...data.savedIds!]));
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
        setFocusIndex((i) => Math.min(shots.length - 1, i + 1));
      } else if (event.key === "ArrowLeft" || event.key === "p") {
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
    if (focusIndex < 0) return;
    const links = gridRef.current?.querySelectorAll<HTMLElement>("figure a, figure button");
    links?.[focusIndex * 3]?.focus();
  }, [focusIndex]);

  if (shots.length === 0) {
    return <EmptyState title={emptyTitle} body={emptyBody} action={emptyAction} />;
  }

  const densityClass =
    density === "sm" ? "shot-grid shot-grid-sm" : density === "lg" ? "shot-grid shot-grid-lg" : "shot-grid";

  return (
    <div>
      <div ref={gridRef} className={densityClass}>
        {shots.map((shot, index) => (
          <ShotTile
            key={shot.id}
            shot={shot}
            href={shotHref(shot)}
            priority={index < 4}
            saved={savedSet.has(shot.id)}
            actions={<AddToCollection shotId={shot.id} compact />}
          />
        ))}
      </div>

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
        ) : (
          <p className="text-[12px] text-text-3">
            {total.toLocaleString()} shot{total === 1 ? "" : "s"}
          </p>
        )}
      </div>
    </div>
  );
}
