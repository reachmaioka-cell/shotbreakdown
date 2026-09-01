"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { humanize } from "@/lib/filters";
import { formatDuration, formatTimecode } from "@/lib/shot-format";
import type { CollectionItem, CollectionKind } from "@/lib/collections";

function shotUrl(item: CollectionItem): string {
  return item.slug ? `/shots/${item.slug}` : `/shots/${item.shotId}`;
}

/**
 * A collection reads as a moodboard; a sequence reads as a numbered shot list
 * with notes. Same data, same table — the ordering is what carries meaning in a
 * sequence, so that is where reordering and notes are surfaced.
 */
export function CollectionBoard({
  collectionId,
  kind,
  items: initialItems,
  editable,
}: {
  collectionId: string;
  kind: CollectionKind;
  items: CollectionItem[];
  editable: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const noteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Adopt a fresh server list during render rather than in an effect, so a
  // refresh does not paint the stale order first.
  const [seenItems, setSeenItems] = useState(initialItems);
  if (seenItems !== initialItems) {
    setSeenItems(initialItems);
    setItems(initialItems);
    setDirty(false);
  }

  useEffect(() => {
    const timers = noteTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    setDirty(true);
  }

  async function saveOrder() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${collectionId}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shotIds: items.map((i) => i.shotId) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not save the order");
        return;
      }
      setDirty(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove(shotId: string) {
    setItems((current) => current.filter((i) => i.shotId !== shotId));
    await fetch(`/api/collections/${collectionId}/items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotId }),
    });
    router.refresh();
  }

  function saveNote(shotId: string, note: string) {
    const timers = noteTimers.current;
    clearTimeout(timers.get(shotId));
    timers.set(
      shotId,
      setTimeout(() => {
        void fetch(`/api/collections/${collectionId}/items`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shotId, note: note || null }),
        });
      }, 700)
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-[3px] border border-dashed border-line px-6 py-14 text-center">
        <p className="text-[13px] text-text-0">Nothing here yet</p>
        <p className="mt-1.5 text-[13px] text-text-2">
          Add shots from the{" "}
          <Link href="/library" className="text-accent hover:underline">
            library
          </Link>{" "}
          using the + button on any frame.
        </p>
      </div>
    );
  }

  if (kind === "collection") {
    return (
      <div className="shot-grid">
        {items.map((item) => (
          <figure key={item.itemId} className="group relative">
            <Link href={shotUrl(item)} className="block">
              <div
                className="relative overflow-hidden rounded-[3px] bg-ink-2"
                style={{ aspectRatio: item.aspectRatio?.replace(":", " / ") ?? "16 / 9" }}
              >
                {item.thumbnailUrl ? (
                  <Image
                    src={item.thumbnailUrl}
                    alt={item.summary ?? item.title ?? ""}
                    fill
                    sizes="(max-width: 640px) 50vw, 260px"
                    className="object-cover"
                  />
                ) : null}
              </div>
            </Link>
            {editable ? (
              <button
                type="button"
                onClick={() => void remove(item.shotId)}
                aria-label="Remove from collection"
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-[3px] bg-black/70 text-text-1 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100"
              >
                ×
              </button>
            ) : null}
            <figcaption className="mt-1.5 line-clamp-2 text-[12px] text-text-2">
              {item.summary ?? item.title}
            </figcaption>
          </figure>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {editable ? (
        <div className="flex items-center gap-3">
          <p className="text-[12px] text-text-2">
            Drag to reorder, or use the arrows. Notes are saved as you type.
          </p>
          {dirty ? (
            <Button size="sm" variant="primary" onClick={() => void saveOrder()} disabled={saving}>
              {saving ? "Saving…" : "Save order"}
            </Button>
          ) : null}
          {error ? <span className="text-[12px] text-danger">{error}</span> : null}
        </div>
      ) : null}

      <ol className="flex flex-col">
        {items.map((item, index) => (
          <li
            key={item.itemId}
            draggable={editable}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              if (!editable || dragIndex === null) return;
              e.preventDefault();
              setOverIndex(index);
            }}
            onDrop={(e) => {
              if (!editable || dragIndex === null) return;
              e.preventDefault();
              move(dragIndex, index);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={`flex gap-4 border-t border-line py-3 last:border-b ${
              overIndex === index && dragIndex !== null ? "bg-ink-2" : ""
            } ${dragIndex === index ? "opacity-50" : ""}`}
          >
            <div className="flex w-8 shrink-0 flex-col items-center gap-1 pt-1">
              <span className="mono text-[13px] text-text-3">
                {String(index + 1).padStart(2, "0")}
              </span>
              {editable ? (
                <>
                  <button
                    type="button"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0}
                    aria-label={`Move shot ${index + 1} up`}
                    className="text-text-3 hover:text-text-0 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, index + 1)}
                    disabled={index === items.length - 1}
                    aria-label={`Move shot ${index + 1} down`}
                    className="text-text-3 hover:text-text-0 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </>
              ) : null}
            </div>

            <Link href={shotUrl(item)} className="shrink-0">
              <div className="relative h-20 w-36 overflow-hidden rounded-[3px] bg-ink-2 sm:h-24 sm:w-44">
                {item.thumbnailUrl ? (
                  <Image
                    src={item.thumbnailUrl}
                    alt=""
                    fill
                    sizes="176px"
                    className="object-cover"
                  />
                ) : null}
              </div>
            </Link>

            <div className="min-w-0 flex-1">
              <Link href={shotUrl(item)} className="text-[13px] text-text-0 hover:text-accent">
                {item.summary ?? item.title ?? "Untitled shot"}
              </Link>
              <p className="mt-0.5 text-[11px] text-text-3">
                {[
                  item.shotSize ? humanize(item.shotSize) : null,
                  item.movementType ? humanize(item.movementType) : null,
                  item.durationSeconds ? formatDuration(item.durationSeconds) : null,
                  item.videoTitle,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {item.startSeconds ? ` · ${formatTimecode(item.startSeconds)}` : ""}
              </p>
              {editable ? (
                <textarea
                  defaultValue={item.note ?? ""}
                  onChange={(e) => saveNote(item.shotId, e.target.value)}
                  rows={2}
                  placeholder="Note for this shot…"
                  aria-label={`Note for shot ${index + 1}`}
                  className="mt-2 w-full resize-y rounded-[3px] border border-line bg-ink-1 px-2 py-1.5 text-[12px] text-text-1 placeholder-text-3 focus:border-line-strong focus:outline-none"
                />
              ) : item.note ? (
                <p className="mt-2 border-l border-line pl-2 text-[12px] leading-relaxed text-text-1">
                  {item.note}
                </p>
              ) : null}
            </div>

            {editable ? (
              <button
                type="button"
                onClick={() => void remove(item.shotId)}
                aria-label={`Remove shot ${index + 1}`}
                className="shrink-0 self-start text-[13px] text-text-3 hover:text-danger"
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
