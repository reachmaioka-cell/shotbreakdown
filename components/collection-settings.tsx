"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import type { CollectionDetail } from "@/lib/collections";

export function CollectionSettings({ collection }: { collection: CollectionDetail }) {
  const router = useRouter();
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description ?? "");
  const [visibility, setVisibility] = useState(collection.visibility);
  const [kind, setKind] = useState(collection.kind);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || null, visibility, kind }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not save");
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/collections/${collection.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Could not delete");
        return;
      }
      router.push("/collections");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="flex max-w-xl flex-col gap-4">
      <div>
        <label htmlFor="c-name" className="eyebrow mb-1 block">Name</label>
        <input
          id="c-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-full rounded-[3px] border border-line bg-ink-1 px-2.5 text-[13px] text-text-0 focus:border-line-strong focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="c-desc" className="eyebrow mb-1 block">Description</label>
        <textarea
          id="c-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full resize-y rounded-[3px] border border-line bg-ink-1 px-2.5 py-2 text-[13px] text-text-0 focus:border-line-strong focus:outline-none"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="c-kind" className="eyebrow mb-1 block">Type</label>
          <select
            id="c-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="h-9 w-full rounded-[3px] border border-line bg-ink-1 px-2 text-[13px] text-text-0 focus:border-line-strong focus:outline-none"
          >
            <option value="collection">Collection — a group of references</option>
            <option value="sequence">Sequence — an ordered shot list</option>
          </select>
        </div>

        <div>
          <label htmlFor="c-vis" className="eyebrow mb-1 block">Visibility</label>
          <select
            id="c-vis"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
            className="h-9 w-full rounded-[3px] border border-line bg-ink-1 px-2 text-[13px] text-text-0 focus:border-line-strong focus:outline-none"
          >
            <option value="private">Private — only you</option>
            <option value="unlisted">Unlisted — anyone with the link</option>
            <option value="public">Public — listed and indexable</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        {saved ? <span className="text-[12px] text-ok">Saved</span> : null}
        {error ? <span className="text-[12px] text-danger">{error}</span> : null}

        <div className="ml-auto">
          {confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-text-1">Delete this collection?</span>
              <Button type="button" variant="danger" size="sm" onClick={() => void remove()} disabled={busy}>
                Delete
              </Button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-[12px] text-text-2 hover:text-text-0"
              >
                Cancel
              </button>
            </div>
          ) : (
            <Button type="button" variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
              Delete collection
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-text-3">
        Deleting a collection does not delete the shots in it.
      </p>
    </form>
  );
}
