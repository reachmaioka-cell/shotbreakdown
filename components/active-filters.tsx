"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { countActiveFilters, filterLabel, filtersFromParams, humanize } from "@/lib/filters";

/**
 * What is currently narrowing the results, shown above them.
 *
 * The rail already highlights selected chips, but the rail is off-screen on a
 * laptop once you scroll and collapsed entirely on mobile — so without this a
 * user can be looking at a filtered set with no visible reason why.
 */
export function ActiveFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const active = filtersFromParams(new URLSearchParams(params.toString()));
  const total = countActiveFilters(active);
  const query = params.get("q");

  if (total === 0 && !query) return null;

  function push(next: URLSearchParams) {
    next.delete("offset");
    startTransition(() => {
      router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
    });
  }

  function removeValue(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    const remaining = next
      .getAll(key)
      .flatMap((v) => v.split(","))
      .filter((v) => v && v !== value);
    next.delete(key);
    if (remaining.length > 0) next.set(key, remaining.join(","));
    push(next);
  }

  function clearQuery() {
    const next = new URLSearchParams(params.toString());
    next.delete("q");
    push(next);
  }

  function clearAll() {
    const next = new URLSearchParams();
    const scope = params.get("scope");
    if (scope) next.set("scope", scope);
    /*
     * The search term is not a filter, and the sidebar's own "Clear all" keeps
     * it. Two controls on the same screen with the same label have to do the
     * same thing; the query has its own dismiss chip beside this one.
     */
    const query = params.get("q");
    if (query) next.set("q", query);
    push(next);
  }

  return (
    <div
      className={`mb-3 flex flex-wrap items-center gap-1.5 transition-opacity ${pending ? "opacity-50" : ""}`}
    >
      {query ? (
        <button
          type="button"
          onClick={clearQuery}
          className="inline-flex items-center gap-1.5 rounded-[3px] border border-line-strong bg-ink-2 px-2 py-1 text-[11px] text-text-0 hover:border-danger/50 hover:text-danger"
        >
          <span className="text-text-3">Search</span>
          <span className="max-w-[16rem] truncate">{query}</span>
          <span aria-hidden>×</span>
          <span className="sr-only">Clear search</span>
        </button>
      ) : null}

      {Object.entries(active).flatMap(([key, values]) =>
        values.map((value) => (
          <button
            key={`${key}:${value}`}
            type="button"
            onClick={() => removeValue(key, value)}
            className="inline-flex items-center gap-1.5 rounded-[3px] border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] text-accent hover:border-danger/50 hover:text-danger"
          >
            <span className="opacity-60">{filterLabel(key)}</span>
            <span>{humanize(value)}</span>
            <span aria-hidden>×</span>
            <span className="sr-only">
              Remove {filterLabel(key)} filter {humanize(value)}
            </span>
          </button>
        ))
      )}

      {total + (query ? 1 : 0) > 1 ? (
        <button
          type="button"
          onClick={clearAll}
          className="rounded-[3px] px-2 py-1 text-[11px] text-text-2 underline-offset-2 hover:text-text-0 hover:underline"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
