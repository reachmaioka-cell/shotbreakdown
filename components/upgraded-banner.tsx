"use client";

import { useSearchParams } from "next/navigation";

export function UpgradedBanner() {
  const params = useSearchParams();
  if (params.get("upgraded") !== "1") return null;
  return <p className="text-xs text-zinc-500 mb-8">Pro is on. The free-shot cap no longer applies.</p>;
}
