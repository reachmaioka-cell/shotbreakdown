"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Account deletion. Typing DELETE is required by the API too, so this is a
 * genuine confirmation rather than a UI-only speed bump.
 */
export function DeleteAccountButton({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not delete the account");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center rounded-[3px] border border-line px-3 text-[13px] text-danger hover:border-danger/50 hover:bg-danger/10"
      >
        Delete my account
      </button>
    );
  }

  return (
    <div className="rounded-[3px] border border-danger/40 bg-danger/5 p-4">
      <p className="text-[13px] text-text-0">
        This permanently deletes {email}, every video and shot you have analyzed, your collections,
        saved shots and share links, and cancels any active subscription.
      </p>
      <label htmlFor="confirm-delete" className="mt-3 block text-[12px] text-text-1">
        Type <span className="mono text-text-0">DELETE</span> to confirm
      </label>
      <input
        id="confirm-delete"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="off"
        className="mt-1 h-9 w-40 rounded-[3px] border border-line bg-ink-1 px-2.5 text-[13px] text-text-0 focus:border-danger focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy || confirm !== "DELETE"}
          className="inline-flex h-9 items-center rounded-[3px] bg-danger px-3 text-[13px] font-medium text-ink-0 disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete permanently"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="text-[13px] text-text-2 hover:text-text-0"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
