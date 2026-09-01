"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateCollectionButton({
  kind,
  parentId,
  label,
}: {
  kind: "collection" | "sequence";
  parentId?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind, parentId: parentId ?? null }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        collection?: { id: string };
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.collection) {
        setError(data.message ?? data.error ?? "Could not create");
        return;
      }
      setOpen(false);
      setName("");
      router.push(`/collections/${data.collection.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const buttonLabel = label ?? (kind === "sequence" ? "New sequence" : "New collection");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center rounded-[3px] border border-line px-3 text-[12px] text-text-0 hover:border-line-strong hover:bg-ink-2"
      >
        {buttonLabel}
      </button>
    );
  }

  return (
    <form onSubmit={(e) => void create(e)} className="flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={kind === "sequence" ? "Sequence name" : "Collection name"}
        aria-label={kind === "sequence" ? "Sequence name" : "Collection name"}
        className="h-8 w-44 rounded-[3px] border border-line bg-ink-1 px-2 text-[12px] text-text-0 placeholder-text-3 focus:border-line-strong focus:outline-none"
      />
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="inline-flex h-8 items-center rounded-[3px] bg-text-0 px-2.5 text-[12px] font-medium text-ink-0 disabled:opacity-40"
      >
        {busy ? "…" : "Create"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[12px] text-text-2 hover:text-text-0"
      >
        Cancel
      </button>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </form>
  );
}
