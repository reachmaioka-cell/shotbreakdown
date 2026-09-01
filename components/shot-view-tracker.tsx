"use client";

import { useEffect } from "react";

/** Records one view per viewer per shot per day; deduped server-side. */
export function ShotViewTracker({ shotId }: { shotId: string }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      void fetch(`/api/shots/${shotId}/view`, { method: "POST" }).catch(() => {});
    }, 2500);
    return () => clearTimeout(timer);
  }, [shotId]);
  return null;
}
