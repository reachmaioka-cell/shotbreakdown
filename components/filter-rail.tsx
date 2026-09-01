"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FILTER_GROUPS, countActiveFilters, filtersFromParams, humanize } from "@/lib/filters";

export type FacetCounts = Record<string, { value: string; count: number }[]>;

/**
 * Frames-style facet bar: the user picks filters; results update the grid.
 * State lives in the URL so every combination is shareable.
 */
export function FilterRail({ facets }: { facets: FacetCounts }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [pending, startTransition] = useTransition();
  const barRef = useRef<HTMLDivElement>(null);

  const active = useMemo(() => filtersFromParams(new URLSearchParams(params.toString())), [params]);
  const activeCount = countActiveFilters(active);

  useEffect(() => {
    function onDoc(event: PointerEvent) {
      if (!barRef.current?.contains(event.target as Node)) setOpenKey(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenKey(null);
    }
    document.addEventListener("pointerdown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggle(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    const current = next.getAll(key).flatMap((v) => v.split(",")).filter(Boolean);
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    next.delete(key);
    if (updated.length > 0) next.set(key, updated.join(","));
    next.delete("offset");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function clearAll() {
    const next = new URLSearchParams();
    const q = params.get("q");
    if (q) next.set("q", q);
    const scope = params.get("scope");
    if (scope) next.set("scope", scope);
    startTransition(() =>
      router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
    );
  }

  function clearGroup(key: string) {
    const next = new URLSearchParams(params.toString());
    next.delete(key);
    next.delete("offset");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const primary = FILTER_GROUPS.filter((g) => g.primary);
  const extra = FILTER_GROUPS.filter((g) => !g.primary);
  const extraActive = extra.reduce((n, g) => n + (active[g.key]?.length ?? 0), 0);

  return (
    <div
      ref={barRef}
      className={`transition-opacity ${pending ? "opacity-60" : ""}`}
      aria-busy={pending}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {primary.map((group) => (
          <FilterDropdown
            key={group.key}
            group={group}
            facets={facets}
            selected={active[group.key] ?? []}
            open={openKey === group.key}
            onOpen={() => setOpenKey((current) => (current === group.key ? null : group.key))}
            onToggle={(value) => toggle(group.key, value)}
            onClear={() => clearGroup(group.key)}
          />
        ))}

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowMore((v) => !v);
              setOpenKey(showMore ? null : "more");
            }}
            aria-expanded={showMore}
            className={`rounded-[3px] border px-2.5 py-1.5 text-[12px] transition-colors ${
              extraActive > 0
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-line bg-ink-1 text-text-1 hover:border-line-strong hover:text-text-0"
            }`}
          >
            More
            {extraActive > 0 ? <span className="ml-1 tabular-nums">{extraActive}</span> : null}
          </button>
        </div>

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-[12px] text-text-2 hover:text-text-0"
          >
            Clear all
          </button>
        ) : null}
      </div>

      {showMore ? (
        <div className="mt-3 grid gap-4 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {extra.map((group) => {
            const counts = facets[group.key] ?? [];
            const countMap = new Map(counts.map((c) => [c.value, c.count]));
            const options = group.options
              ? group.options.filter((o) => countMap.has(o) || active[group.key]?.includes(o))
              : counts.slice(0, 18).map((c) => c.value);
            if (options.length === 0) return null;
            const selected = active[group.key] ?? [];
            return (
              <fieldset key={group.key} className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-1.5 text-[11px] text-text-2">{group.label}</legend>
                <div className="flex flex-wrap gap-1">
                  {options.map((option) => {
                    const isOn = selected.includes(option);
                    const count = countMap.get(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggle(group.key, option)}
                        aria-pressed={isOn}
                        className={chipClass(isOn)}
                      >
                        {chipLabel(group.key, option)}
                        {count ? (
                          <span className="ml-1 text-text-3" aria-hidden>
                            {count}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FilterDropdown({
  group,
  facets,
  selected,
  open,
  onOpen,
  onToggle,
  onClear,
}: {
  group: (typeof FILTER_GROUPS)[number];
  facets: FacetCounts;
  selected: string[];
  open: boolean;
  onOpen: () => void;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const counts = facets[group.key] ?? [];
  const countMap = new Map(counts.map((c) => [c.value, c.count]));
  const options = group.options
    ? group.options.filter((o) => countMap.has(o) || selected.includes(o))
    : counts.slice(0, 18).map((c) => c.value);

  if (options.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`rounded-[3px] border px-2.5 py-1.5 text-[12px] transition-colors ${
          selected.length > 0
            ? "border-accent/50 bg-accent/10 text-accent"
            : "border-line bg-ink-1 text-text-1 hover:border-line-strong hover:text-text-0"
        }`}
      >
        {group.label}
        {selected.length > 0 ? <span className="ml-1 tabular-nums">{selected.length}</span> : null}
      </button>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 top-full z-30 mt-1 min-w-[220px] max-w-[min(90vw,320px)] rounded-[3px] border border-line bg-ink-1 p-2 shadow-xl shadow-black/50"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] text-text-2">{group.label}</span>
            {selected.length > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="text-[11px] text-text-3 hover:text-text-1"
              >
                Clear
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1">
            {options.map((option) => {
              const isOn = selected.includes(option);
              const count = countMap.get(option);
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={isOn}
                  onClick={() => onToggle(option)}
                  className={chipClass(isOn)}
                >
                  {chipLabel(group.key, option)}
                  {count ? (
                    <span className="ml-1 text-text-3" aria-hidden>
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function chipClass(isOn: boolean) {
  return `rounded-[3px] border px-2 py-1 text-[11px] leading-4 transition-colors ${
    isOn
      ? "border-accent/50 bg-accent/15 text-accent"
      : "border-line bg-ink-2 text-text-1 hover:border-line-strong hover:text-text-0"
  }`;
}

function chipLabel(key: string, option: string) {
  if (key !== "colors") return humanize(option);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full border border-white/15"
        style={{ background: colorSwatch(option) }}
      />
      {humanize(option)}
    </span>
  );
}

const FAMILY_SWATCH: Record<string, string> = {
  red: "#b83a32", orange: "#cf7430", amber: "#c9932f", yellow: "#c9bd3a",
  green: "#3f8a58", teal: "#2f7d7d", cyan: "#3ba3b5", blue: "#3d6ea8",
  purple: "#6a4b8c", magenta: "#a03a7c", pink: "#c2748f", brown: "#6d4c35",
  beige: "#c6b498", white: "#ededed", grey: "#8a8a90", black: "#17171a",
  gold: "#c2a034", silver: "#b6b6bc",
};

function colorSwatch(value: string): string {
  return FAMILY_SWATCH[value] ?? "#4a4a52";
}
