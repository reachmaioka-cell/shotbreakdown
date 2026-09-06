"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keep a list of segment cards honest while one of them is still processing.
 *
 * The segments list is a server component, so without this a card that says
 * "Detecting shots" says it until the user reloads. Rather than duplicating the
 * status query per card, this polls the ids that are actually active and asks
 * the server component to re-render when any of them moves.
 *
 * Renders nothing. It is a behaviour, not a widget.
 */
export function SegmentsProgress({ activeIds }: { activeIds: string[] }) {
  const router = useRouter();
  // The array identity changes on every server render; the ids are what matter.
  const key = activeIds.join(",");
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    let cancelled = false;
    let delay = 2500;
    let timer: ReturnType<typeof setTimeout>;

    startedAt.current ??= Date.now();

    const tick = async () => {
      try {
        const responses = await Promise.all(
          ids.map((id) =>
            fetch(`/api/videos/${id}`)
              .then((res) => (res.ok ? res.json() : null))
              .catch(() => null)
          )
        );
        if (cancelled) return;

        // Refresh when anything moved: a stage change, a progress step, or a
        // breakdown that started or finished. The server render is the single
        // source of truth for what a card shows.
        const moved = responses.some((data) => {
          const video = (data as { video?: Record<string, unknown> } | null)?.video;
          if (!video) return false;
          return !ACTIVE.has(String(video.status)) || Number(video.progress ?? 0) > 0;
        });
        if (moved) router.refresh();
      } catch {
        // A failed poll is not worth surfacing here; the card still renders its
        // last known state and the next tick tries again.
      }

      if (cancelled) return;
      // Give up rather than polling a stuck job forever. The segment page has
      // the retry; this list only has to stop being wrong.
      if (Date.now() - (startedAt.current ?? Date.now()) > 20 * 60_000) return;
      delay = Math.min(delay * 1.2, 15_000);
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, router]);

  return null;
}

const ACTIVE = new Set([
  "queued",
  "processing",
  "detecting_shots",
  "extracting_frames",
  "analyzing",
  "indexing",
]);
