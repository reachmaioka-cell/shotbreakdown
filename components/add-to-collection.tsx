"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Collection = {
  id: string;
  name: string;
  kind: "collection" | "sequence";
  itemCount: number;
};

/**
 * Quick-add. Opens a small inline picker rather than a modal, and typing a name
 * that does not exist creates it — so adding a shot to a new deck is one flow,
 * not two.
 */
export function AddToCollection({
  shotId,
  compact = false,
  onAdded,
}: {
  shotId: string;
  compact?: boolean;
  onAdded?: (collectionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/collections")
      .then((r) => (r.ok ? r.json() : { collections: [] }))
      .then((data: { collections?: Collection[] }) => {
        if (!cancelled) setCollections(data.collections ?? []);
      })
      .catch(() => {
        if (!cancelled) setCollections([]);
      });
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function addTo(collection: Collection) {
    setBusy(collection.id);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${collection.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shotId }),
      });
      if (res.status === 401) {
        router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? "Could not add");
        return;
      }
      setDone(collection.name);
      onAdded?.(collection.id);
      router.refresh();
      setTimeout(() => setOpen(false), 700);
    } finally {
      setBusy(null);
    }
  }

  async function createAndAdd() {
    const name = query.trim();
    if (!name) return;
    setBusy("new");
    setError(null);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, shotId }),
      });
      if (res.status === 401) {
        router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        collection?: { id: string; name: string };
      };
      if (!res.ok) {
        setError(data.message ?? "Could not create");
        return;
      }
      setDone(data.collection?.name ?? name);
      onAdded?.(data.collection?.id ?? "");
      router.refresh();
      setTimeout(() => setOpen(false), 700);
    } finally {
      setBusy(null);
    }
  }

  const filtered = (collections ?? []).filter((c) =>
    c.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const exactMatch = filtered.some((c) => c.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Add to collection"
        title="Add to collection"
        className={
          compact
            ? "flex h-7 w-7 items-center justify-center rounded-[3px] bg-black/70 text-text-1 backdrop-blur-sm hover:text-text-0"
            : "inline-flex h-9 items-center gap-2 rounded-[3px] border border-line px-3 text-[13px] font-medium text-text-0 hover:border-line-strong hover:bg-ink-2"
        }
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden fill="none">
          <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {compact ? null : <span>Collect</span>}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Add to collection"
          className="absolute right-0 top-full z-30 mt-1 w-64 rounded-[3px] border border-line bg-ink-1 shadow-xl shadow-black/50"
        >
          <div className="p-2 border-b border-line">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim() && !exactMatch) {
                  e.preventDefault();
                  void createAndAdd();
                }
              }}
              placeholder="Find or create…"
              aria-label="Collection name"
              className="w-full bg-ink-2 border border-line rounded-[3px] px-2 py-1.5 text-[13px] text-text-0 placeholder-text-3 focus:outline-none focus:border-line-strong"
            />
          </div>

          <ul className="max-h-56 overflow-y-auto py-1">
            {collections === null ? (
              <li className="px-3 py-2 text-[12px] text-text-2">Loading…</li>
            ) : filtered.length === 0 && !query.trim() ? (
              <li className="px-3 py-2 text-[12px] text-text-2">No collections yet</li>
            ) : (
              filtered.map((collection) => (
                <li key={collection.id}>
                  <button
                    type="button"
                    onClick={() => void addTo(collection)}
                    disabled={busy !== null}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] text-text-1 hover:bg-ink-2 hover:text-text-0 disabled:opacity-50"
                  >
                    <span className="truncate">{collection.name}</span>
                    <span className="mono text-[10px] text-text-3">
                      {collection.kind === "sequence" ? "SEQ" : collection.itemCount}
                    </span>
                  </button>
                </li>
              ))
            )}
            {query.trim() && !exactMatch ? (
              <li>
                <button
                  type="button"
                  onClick={() => void createAndAdd()}
                  disabled={busy !== null}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-accent hover:bg-ink-2 disabled:opacity-50"
                >
                  Create “{query.trim()}”
                </button>
              </li>
            ) : null}
          </ul>

          {done ? (
            <p className="border-t border-line px-3 py-1.5 text-[12px] text-ok">Added to {done}</p>
          ) : null}
          {error ? (
            <p className="border-t border-line px-3 py-1.5 text-[12px] text-danger">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
