"use client";

import { useState } from "react";

function BillingAction({
  endpoint,
  idleLabel,
  busyLabel,
  className,
}: {
  endpoint: string;
  idleLabel: string;
  busyLabel: string;
  className: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Something went wrong");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => void go()} disabled={loading} className={className}>
        {loading ? busyLabel : idleLabel}
      </button>
      {error ? <p className="text-red-400 text-sm text-center">{error}</p> : null}
    </div>
  );
}

const upgradeClass =
  "bg-white text-black font-medium rounded-md px-4 py-2 text-sm hover:bg-zinc-200 disabled:opacity-50";

export function UpgradeButton() {
  return (
    <BillingAction
      endpoint="/api/billing/checkout"
      idleLabel="Continue"
      busyLabel="Redirecting…"
      className={upgradeClass}
    />
  );
}

export function ManageBillingButton({
  variant = "primary",
}: {
  variant?: "primary" | "subtle";
}) {
  const className =
    variant === "subtle"
      ? "text-sm text-zinc-400 hover:text-white disabled:opacity-50"
      : upgradeClass;
  return (
    <BillingAction
      endpoint="/api/billing/portal"
      idleLabel="Manage billing"
      busyLabel="Opening…"
      className={className}
    />
  );
}
