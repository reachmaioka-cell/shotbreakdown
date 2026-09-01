"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminActions({ shotId }: { shotId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "publish" | "reject") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shotId, action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Failed");
        return;
      }
      setDone(action);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return <span className="shrink-0 text-[12px] text-ok">{done === "publish" ? "Published" : "Rejected"}</span>;
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => void act("publish")}
        disabled={busy !== null}
        className="inline-flex h-7 items-center rounded-[3px] bg-text-0 px-2.5 text-[12px] font-medium text-ink-0 disabled:opacity-40"
      >
        {busy === "publish" ? "…" : "Publish"}
      </button>
      <button
        type="button"
        onClick={() => void act("reject")}
        disabled={busy !== null}
        className="inline-flex h-7 items-center rounded-[3px] border border-line px-2.5 text-[12px] text-text-1 hover:text-danger disabled:opacity-40"
      >
        Reject
      </button>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
