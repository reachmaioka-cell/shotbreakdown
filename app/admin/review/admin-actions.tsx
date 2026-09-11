"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/primitives";

const DONE_LABEL = { approve: "Approved", reject: "Rejected" } as const;

/**
 * Approve and Reject, and nothing else.
 *
 * Publishing used to live here. It does not any more: making a row public is
 * what exposes it through PostgREST to anyone holding the anon key, so it is a
 * single deliberate act at launch (scripts/publish-editorial.ts), not a button
 * pressed sixty times during curation.
 *
 * An approved row still offers Reject, because the only chance to take a wrong
 * call back is before the launch script runs.
 */
export function AdminActions({
  shotId,
  reviewStatus,
}: {
  shotId: string;
  reviewStatus: "pending" | "approved";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<keyof typeof DONE_LABEL | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: keyof typeof DONE_LABEL) {
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
    return <span className="shrink-0 text-[12px] text-ok">{DONE_LABEL[done]}</span>;
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {reviewStatus === "pending" ? (
        <button
          type="button"
          onClick={() => void act("approve")}
          disabled={busy !== null}
          className={buttonClass("primary", "sm")}
        >
          {busy === "approve" ? "…" : "Approve"}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void act("reject")}
        disabled={busy !== null}
        className={buttonClass("danger", "sm")}
      >
        {busy === "reject" ? "…" : "Reject"}
      </button>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
