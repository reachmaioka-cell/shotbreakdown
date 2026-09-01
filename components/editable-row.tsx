"use client";

import { useState } from "react";
import { displayValue } from "@/components/row";

export function EditableRow({
  label,
  value,
  confidence,
  fieldKey,
  submissionId,
}: {
  label: string;
  value: string;
  confidence?: number;
  fieldKey: string;
  submissionId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await fetch(`/api/breakdown/${submissionId}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        field_key: fieldKey,
        original_value: saved,
        corrected_value: text,
      }),
    });
    setSaved(text);
    setEditing(false);
    setBusy(false);
  }

  if (editing) {
    return (
      <div className="py-2 border-b border-zinc-900 last:border-0">
        <p className="text-sm text-zinc-500 mb-2">{label}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
          rows={2}
        />
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="text-xs bg-white text-black rounded-md px-3 py-1.5"
          >
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-zinc-500">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex justify-between gap-4 py-2 border-b border-zinc-900 last:border-0">
      <span className="text-sm text-zinc-500 shrink-0">{label}</span>
      <span className="text-sm text-zinc-200 text-right flex items-start gap-2">
        {displayValue(saved, confidence)}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white"
          aria-label={`Edit ${label}`}
        >
          ✎
        </button>
      </span>
    </div>
  );
}
