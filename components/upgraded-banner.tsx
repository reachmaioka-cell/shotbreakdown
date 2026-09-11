"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/** How long we keep asking before telling the customer to come back to it. */
const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;

type Status = "activating" | "active" | "slow";

/**
 * Stripe redirects here the moment the card clears, and the webhook that
 * actually grants Pro arrives on its own schedule — usually inside a second,
 * sometimes not. Somebody who has just paid must never be told they are on the
 * free plan, so this asks /api/me until the entitlement lands and says
 * "activating" in the meantime.
 */
export function UpgradedBanner() {
  const params = useSearchParams();
  const upgraded = params.get("upgraded") === "1";
  const [status, setStatus] = useState<Status>("activating");

  useEffect(() => {
    if (!upgraded) return;
    let stopped = false;
    const startedAt = Date.now();

    async function poll() {
      if (stopped) return;
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const data = (await res.json()) as { plan?: string };
        if (stopped) return;
        if (data.plan === "pro") {
          setStatus("active");
          return;
        }
      } catch {
        // A failed poll is not an answer. Keep trying until the deadline.
      }
      if (stopped) return;
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setStatus("slow");
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    let timer = setTimeout(() => void poll(), 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [upgraded]);

  if (!upgraded) return null;

  const message =
    status === "active"
      ? "Pro is on. The free-shot cap no longer applies."
      : status === "slow"
        ? "Still activating — you'll have Pro within a minute. Refresh if it hasn't appeared."
        : "Activating your plan…";

  return (
    <p aria-live="polite" className="text-xs text-zinc-500 mb-8">
      {message}
    </p>
  );
}
