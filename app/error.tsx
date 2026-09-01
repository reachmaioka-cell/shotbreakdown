"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("page error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow mb-3">Something went wrong</p>
      <h1 className="text-[18px] font-medium text-text-0">This page didn&apos;t load</h1>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-text-1">
        The error has been logged. Trying again usually works — if it doesn&apos;t, the library and
        your saved shots are unaffected.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex h-10 items-center rounded-[3px] bg-text-0 px-4 text-[13px] font-medium text-ink-0 hover:bg-white"
        >
          Try again
        </button>
        <Link
          href="/library"
          className="inline-flex h-10 items-center rounded-[3px] border border-line px-4 text-[13px] text-text-0 hover:border-line-strong hover:bg-ink-2"
        >
          Go to the library
        </Link>
      </div>
      {error.digest ? (
        <p className="mono mt-6 text-[11px] text-text-3">Reference: {error.digest}</p>
      ) : null}
    </div>
  );
}
