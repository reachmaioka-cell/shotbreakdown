"use client";

import { useRef } from "react";

export function TrackDetails({ card, children }: { card: string; children: React.ReactNode }) {
  const sent = useRef(false);

  function onToggle(e: React.SyntheticEvent<HTMLDivElement>) {
    const details = e.currentTarget.querySelector("details");
    if (!details?.open || sent.current) return;
    sent.current = true;
    void fetch("/api/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card }),
    });
  }

  return <div onToggle={onToggle}>{children}</div>;
}
