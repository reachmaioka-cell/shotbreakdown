"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Permanent deletion, stated plainly. The source file and every extracted frame
 * are removed from storage, and the detected shots go with them — including any
 * saved by other users or added to collections.
 */
export function DeleteVideoButton({ videoId, shotCount }: { videoId: string; shotCount: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not delete");
        return;
      }
      router.push("/videos");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex h-9 items-center rounded-[3px] border border-line px-3 text-[13px] text-danger hover:border-danger/50 hover:bg-danger/10"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-[3px] border border-danger/40 bg-danger/5 p-2.5">
      <p className="text-[12px] text-text-0">
        Delete this video, its source file and all {shotCount} detected shot
        {shotCount === 1 ? "" : "s"}? This cannot be undone.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="inline-flex h-7 items-center rounded-[3px] bg-danger px-2.5 text-[12px] font-medium text-ink-0 disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete permanently"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="inline-flex h-7 items-center rounded-[3px] px-2.5 text-[12px] text-text-1 hover:text-text-0"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
