"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog } from "@/components/ui/primitives";

/** Matches the route's own ceiling, so the box cannot accept what it rejects. */
const MAX_FOCUS = 500;

/**
 * Ask the segment a different question.
 *
 * A refocus rewrites the stored breakdown — there is one document per segment,
 * not a history — so the dialog says so before it spends the generation.
 *
 * The modal mechanics (top layer, Esc, backdrop click, focus handed back to
 * whatever opened it) come from the shared Dialog primitive rather than being
 * written a second time here.
 */
export function RefocusDialog({
  videoId,
  focus,
  label = "Ask something else",
}: {
  videoId: string;
  focus: string | null;
  label?: string;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(focus ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The stored question changes under us when a rewrite finishes; adopt it,
  // but never over the top of what the user is currently typing.
  const [seenFocus, setSeenFocus] = useState(focus);
  if (seenFocus !== focus) {
    setSeenFocus(focus);
    if (!open) setValue(focus ?? "");
  }

  /*
   * showModal() moves focus to the first focusable child, which is the
   * dialog's close button. The question is what the user came to write, so
   * take focus back once the panel is actually open — the primitive's own
   * effect has already run by the time this one does.
   */
  useEffect(() => {
    if (!open) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/breakdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus: value.trim() }),
      });
      if (res.status === 401) {
        router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (res.status === 429) {
        setError(data.message ?? data.error ?? "You have hit the limit for now. Try again shortly.");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Could not start the rewrite. Try again.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Connection lost. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setError(null);
          setValue(focus ?? "");
          setOpen(true);
        }}
      >
        {label}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Ask something else about this segment"
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="refocus-input" className="eyebrow mb-1.5 block">
              Your question
            </label>
            <textarea
              id="refocus-input"
              ref={textareaRef}
              value={value}
              maxLength={MAX_FOCUS}
              rows={4}
              onChange={(event) => setValue(event.target.value)}
              placeholder="What do you want to know about this segment?"
              aria-describedby="refocus-note refocus-count"
              className="w-full resize-y rounded-[var(--radius)] border border-line bg-ink-2 px-2.5 py-2 text-[13px] leading-relaxed text-text-0 placeholder-text-3 focus:border-line-strong"
            />
            <p id="refocus-count" className="mono mt-1 text-right text-[11px] text-text-3">
              {value.length}/{MAX_FOCUS}
            </p>
          </div>

          <p id="refocus-note" className="text-[12px] leading-relaxed text-text-2">
            Rewriting replaces the current breakdown. There is one breakdown per segment, so the
            answer you are reading now will be gone.
          </p>

          {error ? (
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="accent" size="sm" disabled={busy}>
              {busy ? "Starting…" : "Rewrite the breakdown"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
