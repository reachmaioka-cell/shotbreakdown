"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Spinner } from "@/components/ui/primitives";

export type BreakdownStatusValue = "pending" | "ready" | "failed" | null;

/** Stop waiting eventually rather than spinning at the user forever. */
const GIVE_UP_MS = 15 * 60_000;

/**
 * Everything the segment page shows while there is no breakdown to read yet:
 * the wait, the failure, and the button that starts one.
 *
 * Polls the same status route the video workspace polls, with the same backoff,
 * and hands off to router.refresh() the moment the document is ready — the
 * breakdown itself is server-rendered, so the poller never has to carry it.
 */
export function BreakdownStatus({
  videoId,
  status: initialStatus,
  error: initialError = null,
}: {
  videoId: string;
  status: BreakdownStatusValue;
  error?: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<BreakdownStatusValue>(initialStatus);
  const [error, setError] = useState<string | null>(initialError);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  // Lazily initialised: Date.now() in the render body makes the component impure.
  const startedAt = useRef<number | null>(null);

  // A server refresh is the source of truth; adopt it rather than letting the
  // local copy drift once the page re-renders around this island.
  const [seen, setSeen] = useState<{ status: BreakdownStatusValue; error: string | null }>({
    status: initialStatus,
    error: initialError,
  });
  if (seen.status !== initialStatus || seen.error !== initialError) {
    setSeen({ status: initialStatus, error: initialError });
    setStatus(initialStatus);
    setError(initialError);
  }

  function toLogin() {
    router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
  }

  useEffect(() => {
    if (status !== "pending") return;
    let cancelled = false;
    let delay = 2000;
    let timer: ReturnType<typeof setTimeout>;

    startedAt.current ??= Date.now();

    const tick = async () => {
      try {
        const res = await fetch(`/api/videos/${videoId}`);
        if (res.status === 401) {
          if (!cancelled) {
            router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
          }
          return;
        }
        if (!res.ok) throw new Error("status unavailable");
        const data = (await res.json()) as {
          video: { breakdown_status?: string | null; breakdown_error?: string | null };
        };
        if (cancelled) return;
        setPollError(null);

        const next = (data.video?.breakdown_status as BreakdownStatusValue) ?? null;
        if (next === "ready") {
          // The document is server-rendered; pull it in rather than duplicating
          // the query here.
          router.refresh();
          return;
        }
        if (next === "failed") {
          setStatus("failed");
          setError(data.video?.breakdown_error ?? null);
          return;
        }
      } catch {
        if (!cancelled) setPollError("Lost connection to the server. Still trying.");
      }

      if (cancelled) return;
      if (Date.now() - (startedAt.current ?? Date.now()) > GIVE_UP_MS) {
        setSlow(true);
        return;
      }
      delay = Math.min(delay * 1.25, 15_000);
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, videoId, router]);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/breakdown`, { method: "POST" });
      if (res.status === 401) {
        toLogin();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (res.status === 429) {
        setActionError(
          data.message ?? data.error ?? "You have hit the limit for now. Try again shortly."
        );
        return;
      }
      if (!res.ok) {
        setActionError(data.error ?? "Could not start the breakdown. Try again.");
        return;
      }
      setError(null);
      setPollError(null);
      setSlow(false);
      startedAt.current = Date.now();
      setStatus("pending");
      router.refresh();
    } catch {
      setActionError("Connection lost. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "ready") return null;

  return (
    <div aria-live="polite">
      {status === "pending" ? (
        <div role="status" className="rounded-[3px] border border-line bg-ink-1 p-4">
          <Spinner label="Writing the breakdown across nine departments…" />
          <p className="mt-2 text-[12px] text-text-3">
            You can leave this page. The breakdown keeps writing and will be here when you come
            back.
          </p>
          {pollError ? <p className="mt-2 text-[12px] text-text-3">{pollError}</p> : null}
          {slow ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-[12px] text-text-1">
                This is taking longer than expected. The job is still queued on the server.
              </p>
              <Button size="sm" onClick={() => void generate()} disabled={busy}>
                {busy ? "Starting…" : "Start it again"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : status === "failed" ? (
        <div role="alert" className="rounded-[3px] border border-danger/30 bg-danger/5 p-4">
          <p className="text-[13px] text-text-0">The breakdown could not be written.</p>
          {error ? <p className="mt-1 text-[12px] text-text-1">{error}</p> : null}
          <Button size="sm" className="mt-3" onClick={() => void generate()} disabled={busy}>
            {busy ? "Starting…" : "Try again"}
          </Button>
        </div>
      ) : (
        <div className="rounded-[3px] border border-dashed border-line p-4">
          <p className="text-[13px] text-text-0">
            No breakdown yet for this segment.
          </p>
          <p className="mt-1 text-[12px] text-text-2">
            One pass covers what happens, every shot and cut, and what each of the nine departments
            has to do.
          </p>
          <Button
            variant="accent"
            size="sm"
            className="mt-3"
            onClick={() => void generate()}
            disabled={busy}
          >
            {busy ? "Starting…" : "Write the breakdown"}
          </Button>
        </div>
      )}

      {actionError ? (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
