"use client";

import { useState } from "react";
import { ShotTile } from "@/components/shot-tile";
import { EmptyState, Spinner } from "@/components/ui/primitives";
import { shotHref, type ShotCard } from "@/lib/shot-format";

/**
 * Find Similar. Loaded on demand rather than with the page, because it is a
 * vector query the majority of visitors never trigger.
 */
export function SimilarShots({ shotId }: { shotId: string }) {
  const [shots, setShots] = useState<ShotCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shots/${shotId}/similar?limit=12`);
      if (!res.ok) throw new Error("Could not find similar shots");
      const data = (await res.json()) as { shots: ShotCard[] };
      setShots(data.shots);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not find similar shots");
    } finally {
      setLoading(false);
    }
  }

  if (shots === null && !loading && !error) {
    return (
      <button
        type="button"
        onClick={() => void load()}
        className="inline-flex h-9 items-center gap-2 rounded-[3px] border border-line px-3 text-[13px] font-medium text-text-0 hover:border-line-strong hover:bg-ink-2"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.3" />
          <path d="m9.8 9.8 3.2 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        Find similar
      </button>
    );
  }

  if (loading) return <Spinner label="Finding visually similar shots" />;
  if (error) {
    return (
      <p className="text-[13px] text-danger">
        {error}{" "}
        <button type="button" onClick={() => void load()} className="underline">
          Retry
        </button>
      </p>
    );
  }
  if (!shots?.length) {
    return <EmptyState title="No similar shots yet" body="The library will fill out as more videos are analyzed." />;
  }

  return (
    <div className="shot-grid shot-grid-sm">
      {shots.map((shot) => (
        <ShotTile key={shot.id} shot={shot} href={shotHref(shot)} showMeta={false} sizes="200px" />
      ))}
    </div>
  );
}
