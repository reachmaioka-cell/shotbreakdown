"use client";

import { useState } from "react";

/**
 * Sharing a private item promotes it to unlisted — link-only, still out of the
 * public library. The copy says so, because quietly changing visibility is the
 * kind of surprise that loses trust.
 */
export function ShareButton({
  resourceType,
  resourceId,
  existingUrl,
  visibility,
}: {
  resourceType: "shot" | "collection" | "video";
  resourceId: string;
  existingUrl?: string | null;
  visibility?: string;
}) {
  const [url, setUrl] = useState<string | null>(existingUrl ?? null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType, resourceId }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.message ?? data.error ?? "Could not create a link");
        return;
      }
      setUrl(data.url);
      setOpen(true);
      await copy(data.url);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await fetch("/api/shares", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType, resourceId }),
      });
      setUrl(null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy failed — select the link and copy it manually.");
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (url ? setOpen((v) => !v) : void create())}
        disabled={busy}
        className="inline-flex h-9 items-center gap-2 rounded-[3px] border border-line px-3 text-[13px] font-medium text-text-0 hover:border-line-strong hover:bg-ink-2 disabled:opacity-50"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M6.5 9.5 9.5 6.5M7 4.5 8.8 2.7a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.8 1.8a2.5 2.5 0 0 1-3.5-3.5L5.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {busy ? "Working…" : url ? "Share link" : "Share"}
      </button>

      {open && url ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 rounded-[3px] border border-line bg-ink-1 p-3 shadow-xl shadow-black/50">
          <p className="eyebrow mb-2">Anyone with this link can view</p>
          <div className="flex gap-1.5">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Share link"
              className="min-w-0 flex-1 rounded-[3px] border border-line bg-ink-2 px-2 py-1.5 text-[12px] text-text-1"
            />
            <button
              type="button"
              onClick={() => void copy(url)}
              className="shrink-0 rounded-[3px] bg-text-0 px-2.5 text-[12px] font-medium text-ink-0 hover:bg-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {visibility === "private" ? (
            <p className="mt-2 text-[11px] text-text-2">
              Sharing made this unlisted: reachable with the link, still hidden from the public
              library and search.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void revoke()}
            disabled={busy}
            className="mt-2 text-[12px] text-danger hover:underline disabled:opacity-50"
          >
            Revoke link
          </button>
          {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
        </div>
      ) : null}
      {error && !open ? <p className="mt-1 text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
