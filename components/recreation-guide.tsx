"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { POLL_MS } from "@/lib/constants";
import { Button, Spinner } from "@/components/ui/primitives";

type Guide = {
  recreation_steps: string[];
  budget_recreation: { under_500_usd: string[]; under_5000_usd: string[] };
  common_mistakes: string[];
};

type Status = "ready" | "pending" | "missing";

export function RecreationGuidePanel({
  shotId,
  initialGuide,
  signedIn,
}: {
  shotId: string;
  initialGuide: Guide | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [guide, setGuide] = useState<Guide | null>(initialGuide);
  const [status, setStatus] = useState<Status>(initialGuide ? "ready" : "missing");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/shots/${shotId}/recreation-guide`);
    if (!res.ok) return;
    const data = (await res.json()) as { status: Status; guide: Guide | null };
    setStatus(data.status);
    if (data.guide) setGuide(data.guide);
  }, [shotId]);

  useEffect(() => {
    if (status !== "pending") return;
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [status, refresh]);

  async function generate() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/shots/${shotId}/recreation-guide`, { method: "POST" });
      if (res.status === 401) {
        router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      if (res.status === 429) {
        setError("You've hit today's recreation-guide limit. Try again tomorrow, or upgrade.");
        return;
      }
      if (!res.ok) {
        setError("Could not start the guide. Try again.");
        return;
      }
      const data = (await res.json()) as { status: Status; guide: Guide | null };
      setStatus(data.status);
      if (data.guide) setGuide(data.guide);
    } catch {
      setError("Could not start the guide. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (guide) {
    return <RecreationGuideBody guide={guide} />;
  }

  return (
    <div>
      <p className="max-w-2xl text-[13px] leading-relaxed text-text-2">
        Ordered steps, budget substitutions, and the mistakes that would miss this look. Generated
        once for the shot, then kept here.
      </p>
      {status === "pending" ? (
        <p className="mt-3">
          <Spinner label="Writing the recreation guide…" />
        </p>
      ) : signedIn ? (
        <Button className="mt-3" variant="accent" onClick={() => void generate()} disabled={busy}>
          {busy ? "Starting…" : "Generate recreation guide"}
        </Button>
      ) : (
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`)}
        >
          Sign in to generate
        </Button>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function RecreationGuideBody({ guide }: { guide: Guide }) {
  return (
    <div className="max-w-2xl">
      <ol className="flex flex-col gap-3">
        {guide.recreation_steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-text-1">
            <span className="mono shrink-0 w-5 text-text-3">{i + 1}.</span>
            <span>{step.replace(/^Step \d+:\s*/i, "")}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <Budget title="Under $500" items={guide.budget_recreation.under_500_usd} />
        <Budget title="Under $5,000" items={guide.budget_recreation.under_5000_usd} />
      </div>
      {guide.common_mistakes.length > 0 ? (
        <div className="mt-6">
          <h3 className="eyebrow mb-2">Common mistakes</h3>
          <ul className="flex flex-col gap-2">
            {guide.common_mistakes.map((item) => (
              <li key={item} className="text-[13px] leading-relaxed text-text-1">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Budget({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="eyebrow mb-2">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="text-[13px] leading-relaxed text-text-1">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
