"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CopyButton, Prose } from "@/components/segment/segment-breakdown";
import { Button, Pill, Spinner } from "@/components/ui/primitives";
import {
  StoredAiRecreationSchema,
  type StoredAiRecreation,
} from "@/lib/validation";

export type AiRecreationStatusValue =
  "pending" | "ready" | "failed" | "missing" | null;

/** Stop waiting eventually rather than spinning at the user forever. */
const GIVE_UP_MS = 15 * 60_000;

const FEASIBILITY = {
  straightforward: {
    label: "Straightforward",
    tone: "ok",
    title: "Current tools do this well within a few tries",
  },
  achievable: {
    label: "Achievable",
    tone: "default",
    title: "It works, with iteration and cleanup",
  },
  difficult: {
    label: "Difficult",
    tone: "accent",
    title:
      "Expect many attempts and hand fixes, and a result that is close rather than right",
  },
  "not-yet": {
    label: "Not yet",
    tone: "danger",
    title: "No current tool gets there",
  },
} as const;

function Heading({ children }: { children: React.ReactNode }) {
  return <h4 className="eyebrow mb-2">{children}</h4>;
}

/** The plain bulleted list this document uses for everything unordered. */
function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex max-w-[72ch] flex-col gap-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex gap-3 text-[13px] leading-relaxed text-text-1"
        >
          <span
            aria-hidden
            className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-3"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The generative route to the same segment, behind its own button.
 *
 * Nobody is charged for this unasked: most people opening a breakdown intend to
 * shoot the thing, so the document is only written when the owner presses the
 * button. Polling, 401 and 429 handling follow BreakdownStatus, which waits on
 * the same queue in the same way.
 *
 * Unlike the breakdown, the document is rendered here rather than by the page,
 * so a finished poll adopts the payload directly as well as refreshing the
 * server components around it.
 */
/** The one line a folded document shows: how close the tools get, in a sentence. */
function firstSentence(text: string): string {
  const match = text.trim().match(/^[^.!?]*[.!?]/);
  return (match ? match[0] : text).trim();
}

export function AiRecreation({
  videoId,
  status: initialStatus,
  recreation: initialRecreation,
  error: initialError = null,
  isOwner,
  hasBreakdown,
}: {
  videoId: string;
  status: AiRecreationStatusValue;
  /** Parsed by the page. Null until the owner asks for one. */
  recreation: StoredAiRecreation | null;
  /** The pipeline's own message on a failure. Owner-only, like the breakdown's. */
  error?: string | null;
  isOwner: boolean;
  /** The AI route is written from the breakdown, so it cannot run before one exists. */
  hasBreakdown: boolean;
}) {
  const router = useRouter();
  const noteId = useId();
  const [status, setStatus] = useState<AiRecreationStatusValue>(initialStatus);
  const [recreation, setRecreation] = useState<StoredAiRecreation | null>(
    initialRecreation,
  );
  const [error, setError] = useState<string | null>(initialError);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  /*
   * The wait and its live region are replaced by the document itself, so the
   * arrival would otherwise be silent for a screen reader. Only set by the
   * poller: a page that loads with the guide already written has not updated.
   */
  const [arrived, setArrived] = useState(false);
  /*
   * The document is long by nature — prompts are written out in full — and it
   * sits under a breakdown most readers came for. It opens the moment it
   * arrives for the person who asked for it; on every later visit it is one
   * line until wanted.
   */
  const [open, setOpen] = useState(false);
  // Lazily initialised: Date.now() in the render body makes the component impure.
  const startedAt = useRef<number | null>(null);

  // A server refresh is the source of truth; adopt it rather than letting the
  // local copy drift once the page re-renders around this island.
  const [seen, setSeen] = useState({
    status: initialStatus,
    recreation: initialRecreation,
    error: initialError,
  });
  if (
    seen.status !== initialStatus ||
    seen.recreation !== initialRecreation ||
    seen.error !== initialError
  ) {
    setSeen({
      status: initialStatus,
      recreation: initialRecreation,
      error: initialError,
    });
    setStatus(initialStatus);
    // A refresh that has not caught up yet carries no document; keep the one
    // the poller already adopted rather than blanking a guide being read.
    if (initialRecreation) setRecreation(initialRecreation);
    setError(initialError);
  }

  function toLogin() {
    router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
  }

  useEffect(() => {
    if (status !== "pending") return;
    // A non-owner renders nothing here, so polling on their behalf is a request
    // every few seconds for a document they will never be shown.
    if (!isOwner) return;
    let cancelled = false;
    let delay = 2000;
    let timer: ReturnType<typeof setTimeout>;

    startedAt.current ??= Date.now();

    const tick = async () => {
      try {
        const res = await fetch(`/api/videos/${videoId}/ai-recreation`);
        if (res.status === 401) {
          if (!cancelled) {
            router.push(
              `/auth/login?next=${encodeURIComponent(location.pathname)}`,
            );
          }
          return;
        }
        if (!res.ok) throw new Error("status unavailable");
        const data = (await res.json()) as {
          status?: string | null;
          recreation?: unknown;
          error?: string | null;
        };
        if (cancelled) return;
        setPollError(null);

        const next = (data.status as AiRecreationStatusValue) ?? null;
        if (next === "ready") {
          // Parsed rather than trusted: a half-written document would otherwise
          // reach the render as missing arrays.
          const parsed = StoredAiRecreationSchema.safeParse(data.recreation);
          if (parsed.success) {
            setRecreation(parsed.data);
            setStatus("ready");
            setArrived(true);
            setOpen(true);
            // The server components around this one hold the same status.
            router.refresh();
            return;
          }
          /*
           * The server says ready but the document does not parse. Stopping
           * here would leave a spinner running forever with nothing behind it,
           * so keep polling and let the refresh re-render from the server, which
           * is the authority on what is actually stored.
           */
          console.error(
            "ai-recreation: ready but unparseable",
            parsed.error.issues[0]?.path,
          );
          router.refresh();
        }
        if (next === "failed") {
          setStatus("failed");
          setError(data.error ?? null);
          return;
        }
      } catch {
        if (!cancelled)
          setPollError("Lost connection to the server. Still trying.");
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
  }, [status, isOwner, videoId, router]);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/ai-recreation`, {
        method: "POST",
      });
      if (res.status === 401) {
        toLogin();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (res.status === 429) {
        setActionError(
          data.message ??
            data.error ??
            "You have hit the limit for now. Try again shortly.",
        );
        return;
      }
      if (!res.ok) {
        setActionError(
          data.error ?? "Could not start the AI guide. Try again.",
        );
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

  // A reader who is not the owner gets the document when there is one and
  // nothing when there is not: the generation is the owner's to spend.
  /*
   * Always mounted, on every branch, with only its text changing. A live region
   * created in the same render that first fills it is not announced: the
   * assistive tech has no previous value to diff against.
   */
  const announcer = (
    <p role="status" aria-live="polite" className="sr-only">
      {arrived ? "The AI route is ready." : ""}
    </p>
  );

  if (status === "ready" && recreation) {
    const feasibility = FEASIBILITY[recreation.feasibility];
    return (
      <section className="mt-12 border-t border-line pt-8">
        {announcer}
        <details
          open={open}
          onToggle={(event) => {
            const next = event.currentTarget.open;
            if (next !== open) setOpen(next);
          }}
        >
          <summary
            aria-expanded={open}
            className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-2"
          >
            <h3 className="eyebrow">Making this with AI</h3>
            <Pill tone={feasibility.tone} title={feasibility.title}>
              {feasibility.label}
            </Pill>
            {!open ? (
              <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-text-2 line-clamp-1">
                {firstSentence(recreation.verdict)}
              </span>
            ) : null}
            <span
              aria-hidden
              className="mono ml-auto shrink-0 text-[13px] text-text-3"
            >
              {open ? "−" : "+"}
            </span>
          </summary>

          <div className="mt-4 flex flex-col gap-6">
            {recreation.verdict.trim() ? (
              <Prose text={recreation.verdict} className="max-w-[72ch]" />
            ) : null}

            {recreation.approach.trim() ? (
              <div>
                <Heading>Approach</Heading>
                <Prose text={recreation.approach} className="max-w-[72ch]" />
              </div>
            ) : null}

            {recreation.tools.length > 0 ? (
              <div>
                <Heading>Tools</Heading>
                <dl className="grid max-w-[72ch] grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                  {recreation.tools.map((tool, i) => (
                    <div key={i} className="contents">
                      <dt className="text-[13px] leading-relaxed text-text-0">
                        {tool.name}
                      </dt>
                      <dd className="text-[13px] leading-relaxed text-text-2">
                        {tool.role}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {recreation.prompts.length > 0 ? (
              <div>
                <Heading>Prompts</Heading>
                <ul className="flex flex-col gap-3">
                  {recreation.prompts.map((prompt, i) => (
                    <li
                      key={i}
                      className="rounded-[3px] border border-line bg-ink-1 p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="eyebrow">{prompt.target}</span>
                        <CopyButton
                          build={() => prompt.text}
                          label="Copy"
                          describes={`Prompt for ${prompt.target}`}
                        />
                      </div>
                      <p className="mono max-w-[80ch] text-[12px] leading-relaxed whitespace-pre-wrap text-text-1">
                        {prompt.text}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {recreation.workflow.length > 0 ? (
              <div>
                <Heading>Workflow</Heading>
                <ol className="flex max-w-[72ch] flex-col gap-2">
                  {recreation.workflow.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mono shrink-0 text-[12px] text-text-3">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text-[13px] leading-relaxed text-text-1">
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {recreation.settings.length > 0 ? (
              <div>
                <Heading>Settings worth setting</Heading>
                <Bullets items={recreation.settings} />
              </div>
            ) : null}

            {recreation.hard_parts.length > 0 ? (
              <div>
                <Heading>What these tools get wrong here</Heading>
                <ul className="flex max-w-[72ch] flex-col gap-1.5">
                  {recreation.hard_parts.map((item, i) => (
                    <li
                      key={i}
                      className="border-l border-line pl-3 text-[13px] leading-relaxed text-text-2"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {recreation.cleanup.length > 0 ? (
              <div>
                <Heading>Cleanup by hand</Heading>
                <Bullets items={recreation.cleanup} />
              </div>
            ) : null}
          </div>
        </details>
      </section>
    );
  }

  if (!isOwner) return null;

  return (
    <section className="mt-12 border-t border-line pt-8" aria-live="polite">
      {announcer}
      {status === "pending" ? (
        <div
          role="status"
          className="rounded-[3px] border border-line bg-ink-1 p-4"
        >
          <Spinner label="Working out how this would be made with generative tools…" />
          <p className="mt-2 text-[12px] text-text-3">
            You can leave this page. The guide keeps writing and will be here
            when you come back.
          </p>
          {pollError ? (
            <p className="mt-2 text-[12px] text-text-3">{pollError}</p>
          ) : null}
          {slow ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-[12px] text-text-1">
                This is taking longer than expected. The job is still queued on
                the server.
              </p>
              <Button size="sm" onClick={() => void generate()} disabled={busy}>
                {busy ? "Starting…" : "Start it again"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : status === "failed" ? (
        <div
          role="alert"
          className="rounded-[3px] border border-danger/30 bg-danger/5 p-4"
        >
          <p className="text-[13px] text-text-0">
            The AI route could not be written.
          </p>
          {error ? (
            <p className="mt-1 text-[12px] text-text-1">{error}</p>
          ) : null}
          <Button
            size="sm"
            className="mt-3"
            onClick={() => void generate()}
            disabled={busy}
          >
            {busy ? "Starting…" : "Try again"}
          </Button>
        </div>
      ) : (
        <div className="rounded-[3px] border border-dashed border-line p-4">
          <Button
            variant="accent"
            size="sm"
            onClick={() => void generate()}
            disabled={busy || !hasBreakdown}
            aria-describedby={noteId}
          >
            {busy ? "Starting…" : "Show me the AI route"}
          </Button>
          <p
            id={noteId}
            className="mt-2 max-w-[72ch] text-[12px] leading-relaxed text-text-2"
          >
            {hasBreakdown
              ? "This writes a separate guide to making the segment with generative tools instead of a camera."
              : "The breakdown has to be written first. The AI route is built from it."}
          </p>
        </div>
      )}

      {actionError ? (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {actionError}
        </p>
      ) : null}
    </section>
  );
}
