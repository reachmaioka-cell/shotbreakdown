"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const FORMATS = [
  { id: "pdf", label: "PDF contact sheet", hint: "Frames and metadata, print-ready" },
  { id: "csv", label: "CSV metadata", hint: "One row per shot, for a spreadsheet" },
  { id: "json", label: "JSON metadata", hint: "Full structured records" },
] as const;

export function ExportMenu({
  resourceType,
  resourceId,
}: {
  resourceType: "collection" | "video" | "shot";
  resourceId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  async function run(format: string) {
    setBusy(format);
    setError(null);
    try {
      const res = await fetch(
        `/api/exports?resourceType=${resourceType}&resourceId=${resourceId}&format=${format}`
      );
      if (res.status === 401) {
        router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      if (res.status === 402) {
        router.push("/upgrade");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(data.message ?? data.error ?? "Export failed");
        return;
      }
      const blob = await res.blob();
      const name =
        res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        `shotbreakdown.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setOpen(false);
    } catch {
      setError("Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-9 items-center gap-2 rounded-[3px] border border-line px-3 text-[13px] font-medium text-text-0 hover:border-line-strong hover:bg-ink-2"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 2.5v8m0 0L5 7.5M8 10.5l3-3M3 12.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Export
      </button>

      {open ? (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-60 rounded-[3px] border border-line bg-ink-1 py-1 shadow-xl shadow-black/50">
          {FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={() => void run(format.id)}
              className="block w-full px-3 py-2 text-left hover:bg-ink-2 disabled:opacity-50"
            >
              <span className="block text-[13px] text-text-0">
                {busy === format.id ? "Preparing…" : format.label}
              </span>
              <span className="block text-[11px] text-text-3">{format.hint}</span>
            </button>
          ))}
          {error ? <p className="border-t border-line px-3 py-1.5 text-[12px] text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
