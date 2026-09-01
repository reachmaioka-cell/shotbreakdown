"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Search writes straight to the URL, so every result set is linkable, shareable
 * and back-button-safe. "/" focuses it from anywhere.
 */
export function SearchBar({ placeholder }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryParam = params.get("q") ?? "";
  const [value, setValue] = useState(queryParam);
  const [pending, startTransition] = useTransition();

  // Follow the URL when navigation changes it (back button, a tag link), while
  // leaving what the user is typing alone.
  const [seenQuery, setSeenQuery] = useState(queryParam);
  if (seenQuery !== queryParam) {
    setSeenQuery(queryParam);
    setValue(queryParam);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (event.key === "/") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit(next: string) {
    const params2 = new URLSearchParams(params.toString());
    const trimmed = next.trim();
    if (trimmed) params2.set("q", trimmed);
    else params2.delete("q");
    params2.delete("offset");
    startTransition(() => router.push(`${pathname}?${params2.toString()}`));
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      className="relative"
    >
      <label htmlFor="shot-search" className="sr-only">
        Search shots
      </label>
      <svg
        aria-hidden
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3"
      >
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        id="shot-search"
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? "Search shots, lighting, camera movement, mood…"}
        autoComplete="off"
        className="h-10 w-full rounded-[3px] border border-line bg-ink-1 pl-9 pr-20 text-[13px] text-text-0 placeholder-text-3 focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
      {pending ? (
        <span
          aria-hidden
          className="absolute right-16 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border border-line-strong border-t-text-0"
        />
      ) : null}
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue("");
            submit("");
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[3px] px-2 py-1 text-[12px] text-text-2 hover:text-text-0"
        >
          Clear
        </button>
      ) : (
        <kbd className="mono pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-[2px] border border-line px-1.5 py-0.5 text-[10px] text-text-3">
          /
        </kbd>
      )}
    </form>
  );
}
