"use client";

import { useState } from "react";

type Action =
  | "tick"
  | "seed"
  | "retry_failed"
  | "reembed_batch"
  | "ingest_learn"
  | "distill_corrections"
  | "prompt_insights"
  | "rechunk_knowledge";

export function LearningActions() {
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: Action) {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, batch: 10 }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setMessage((data.error as string) ?? "Failed");
        return;
      }
      setMessage(JSON.stringify(data));
    } catch {
      setMessage("Request failed");
    } finally {
      setBusy(null);
    }
  }

  const btn = (action: Action, label: string) => (
    <button
      key={action}
      type="button"
      disabled={busy != null}
      onClick={() => run(action)}
      className="text-xs border border-zinc-700 rounded px-3 py-1.5 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
    >
      {busy === action ? "…" : label}
    </button>
  );

  return (
    <div className="mb-10">
      <h2 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Actions</h2>
      <div className="flex flex-wrap gap-2">
        {btn("tick", "Run batch")}
        {btn("seed", "Seed queue")}
        {btn("ingest_learn", "Ingest learn articles")}
        {btn("reembed_batch", "Re-embed submissions")}
        {btn("distill_corrections", "Distill corrections")}
        {btn("rechunk_knowledge", "Rechunk knowledge")}
        {btn("prompt_insights", "Prompt insights")}
        {btn("retry_failed", "Retry failed")}
      </div>
      {message ? <p className="text-xs text-zinc-600 mt-3 break-all">{message}</p> : null}
    </div>
  );
}
