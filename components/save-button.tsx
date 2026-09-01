"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Save is one click with an optimistic flip. No modal, no confirmation —
 * unsaving is the same click again.
 */
export function SaveButton({
  shotId,
  initialSaved,
  compact = false,
  onRequireAuth,
}: {
  shotId: string;
  initialSaved: boolean;
  compact?: boolean;
  onRequireAuth?: () => void;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function toggle() {
    const next = !saved;
    setSaved(next);
    setError(null);
    try {
      const res = await fetch(`/api/shots/${shotId}/save`, {
        method: next ? "POST" : "DELETE",
      });
      if (res.status === 401) {
        setSaved(!next);
        if (onRequireAuth) onRequireAuth();
        else router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setSaved(!next);
        setError(data.message ?? "Could not save");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setSaved(!next);
      setError("Network error");
    }
  }

  const label = saved ? "Remove from saved" : "Save shot";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      title={error ?? label}
      aria-label={label}
      aria-pressed={saved}
      disabled={pending}
      className={
        compact
          ? `flex h-7 w-7 items-center justify-center rounded-[3px] backdrop-blur-sm transition-colors ${
              saved ? "bg-accent text-accent-ink" : "bg-black/70 text-text-1 hover:text-text-0"
            }`
          : `inline-flex h-9 items-center gap-2 rounded-[3px] border px-3 text-[13px] font-medium transition-colors ${
              saved
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-line text-text-0 hover:border-line-strong hover:bg-ink-2"
            }`
      }
    >
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden fill={saved ? "currentColor" : "none"}>
        <path
          d="M3.5 2.5h9a1 1 0 0 1 1 1v10.2a.3.3 0 0 1-.47.25L8 10.6l-5.03 3.35a.3.3 0 0 1-.47-.25V3.5a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
      {compact ? null : <span>{saved ? "Saved" : "Save"}</span>}
    </button>
  );
}
