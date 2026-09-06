"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Checkbox } from "@/components/ui/primitives";
import { FILTER_GROUPS, countActiveFilters, filtersFromParams, humanize } from "@/lib/filters";

export type FacetCounts = Record<string, { value: string; count: number }[]>;

/** One of the viewer's segments, for the Segment group. Loaded by the page. */
export type SegmentOption = { id: string; title: string | null };

export type ScopeTab = { key: string; label: string; href: string };

/**
 * Values from the data rather than a fixed vocabulary (tags, aspect ratios)
 * have no natural end, and a rail that scrolls for a screen and a half is not a
 * rail. The long tail is reachable through search instead.
 */
const OPEN_VOCABULARY_LIMIT = 24;

/*
 * Swatches for the colour families the analyzer emits. Deliberately a lookup
 * and not a computation: a family name is a word, not a hue, and guessing a
 * colour for a name we do not know would put a confident wrong chip next to a
 * frame. Anything unrecognised gets the neutral.
 */
const FAMILY_SWATCH: Record<string, string> = {
  red: "#b83a32", orange: "#cf7430", amber: "#c9932f", yellow: "#c9bd3a",
  green: "#3f8a58", teal: "#2f7d7d", cyan: "#3ba3b5", blue: "#3d6ea8",
  purple: "#6a4b8c", magenta: "#a03a7c", pink: "#c2748f", brown: "#6d4c35",
  beige: "#c6b498", white: "#ededed", grey: "#8a8a90", black: "#17171a",
  gold: "#c2a034", silver: "#b6b6bc",
};

const NEUTRAL_SWATCH = "#4a4a52";

/**
 * The Shots rail: scope, then every axis the search can narrow on, as
 * checkboxes with the count each one would return.
 *
 * All of the state is the URL. Nothing here is remembered locally except which
 * groups are open, so any view of the library can be copied out of the address
 * bar and land somebody else on the same set of frames.
 */
export function FilterSidebar({
  facets,
  segments = [],
  scopes = [],
  scope,
}: {
  facets: FacetCounts;
  segments?: SegmentOption[];
  scopes?: ScopeTab[];
  scope?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const segmentName = useId();

  const active = useMemo(() => filtersFromParams(new URLSearchParams(params.toString())), [params]);
  const videoId = params.get("video_id");
  const activeCount = countActiveFilters(active) + (videoId ? 1 : 0);

  // Which groups start open: the primary axes, plus anything already narrowing
  // the results, so an active filter is never hidden inside a closed group.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = { __segment: true };
    for (const group of FILTER_GROUPS) {
      initial[group.key] = group.primary || (active[group.key]?.length ?? 0) > 0;
    }
    return initial;
  });

  function push(next: URLSearchParams) {
    // Paging state belongs to a result set that no longer exists.
    next.delete("offset");
    startTransition(() =>
      router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
    );
  }

  function toggle(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    const current = next.getAll(key).flatMap((v) => v.split(",")).filter(Boolean);
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    next.delete(key);
    if (updated.length > 0) next.set(key, updated.join(","));
    push(next);
  }

  function clearAll() {
    const next = new URLSearchParams();
    // The query and the scope are not filters: clearing the narrowing should
    // not throw away what was searched for or whose shots are being browsed.
    const q = params.get("q");
    if (q) next.set("q", q);
    const currentScope = params.get("scope");
    if (currentScope) next.set("scope", currentScope);
    push(next);
  }

  function clearGroup(key: string) {
    const next = new URLSearchParams(params.toString());
    next.delete(key);
    push(next);
  }

  function selectSegment(id: string | null) {
    const next = new URLSearchParams(params.toString());
    next.delete("video_id");
    if (id) next.set("video_id", id);
    push(next);
  }

  return (
    <div
      className={`flex flex-col gap-1 p-2 transition-opacity ${pending ? "opacity-60" : ""}`}
      aria-busy={pending}
    >
      {scopes.length > 0 ? (
        <nav aria-label="Shot scope" className="flex items-center gap-0.5 rounded-[var(--radius)] bg-ink-2 p-0.5">
          {scopes.map((tab) => {
            const on = tab.key === scope;
            return (
              <Link
                key={tab.key}
                href={tab.href}
                aria-current={on ? "page" : undefined}
                className={`flex h-7 flex-1 items-center justify-center rounded-[var(--radius)] px-2 text-[12px] transition-colors ${
                  on ? "bg-ink-3 text-text-0" : "text-text-2 hover:text-text-0"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {activeCount > 0 ? (
        <div className="flex items-center justify-between gap-2 px-1 py-1">
          <span className="eyebrow">
            {activeCount} filter{activeCount === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="text-[12px] text-text-2 transition-colors hover:text-text-0"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {segments.length > 0 ? (
        <Group
          label="Segment"
          /*
           * Open by default only while the list is short enough to read at a
           * glance. Someone with fifty segments would otherwise scroll past all
           * of them to reach shot size, which is the filter they actually came
           * for. A chosen segment forces it open so the active filter is visible.
           */
          open={open.__segment ?? (Boolean(videoId) || segments.length <= 8)}
          onToggle={(next) => setOpen((current) => ({ ...current, __segment: next }))}
          badge={videoId ? 1 : 0}
          onClear={videoId ? () => selectSegment(null) : undefined}
        >
          {/*
            One segment at a time: the search takes a single video_id, so these
            are radios rather than checkboxes that could never both be on.
          */}
          <fieldset
            className={`m-0 border-0 p-0 ${
              segments.length > 10 ? "max-h-64 overflow-y-auto no-scrollbar pr-1" : ""
            }`}
          >
            <legend className="sr-only">Filter by segment</legend>
            <SegmentRadio
              name={segmentName}
              label="All segments"
              checked={!videoId}
              onSelect={() => selectSegment(null)}
            />
            {segments.map((segment) => (
              <SegmentRadio
                key={segment.id}
                name={segmentName}
                label={segment.title?.trim() || "Untitled segment"}
                checked={videoId === segment.id}
                onSelect={() => selectSegment(segment.id)}
              />
            ))}
          </fieldset>
        </Group>
      ) : null}

      {FILTER_GROUPS.map((group) => {
        const counts = facets[group.key] ?? [];
        const countMap = new Map(counts.map((c) => [c.value, c.count]));
        const selected = active[group.key] ?? [];
        /*
         * A value with no shots behind it is noise, so it is dropped — unless
         * it is currently selected, in which case removing the row would leave
         * the user no way to switch it off.
         */
        const options = group.options
          ? group.options.filter((o) => countMap.has(o) || selected.includes(o))
          : [
              ...new Set([
                ...counts.slice(0, OPEN_VOCABULARY_LIMIT).map((c) => c.value),
                ...selected,
              ]),
            ];
        if (options.length === 0) return null;

        return (
          <Group
            key={group.key}
            label={group.label}
            open={open[group.key] ?? group.primary}
            onToggle={(next) => setOpen((current) => ({ ...current, [group.key]: next }))}
            badge={selected.length}
            onClear={selected.length > 0 ? () => clearGroup(group.key) : undefined}
          >
            {options.map((option) => (
              <Checkbox
                key={option}
                label={
                  group.key === "colors" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 shrink-0 rounded-full border border-white/15"
                        style={{ background: FAMILY_SWATCH[option] ?? NEUTRAL_SWATCH }}
                      />
                      {humanize(option)}
                    </span>
                  ) : (
                    humanize(option)
                  )
                }
                checked={selected.includes(option)}
                count={countMap.get(option)}
                onChange={() => toggle(group.key, option)}
              />
            ))}
          </Group>
        );
      })}
    </div>
  );
}

/**
 * A collapsible section. <details> because the platform already knows how to
 * open and close one from the keyboard and how to tell a screen reader which
 * state it is in — the only thing added here is remembering it in React so a
 * re-render on every URL change cannot snap it shut.
 */
function Group({
  label,
  open,
  onToggle,
  badge,
  onClear,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  badge?: number;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="border-t border-line first:border-t-0"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-1 py-1.5 text-[12px] text-text-1 transition-colors hover:text-text-0 [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden
          width="8"
          height="8"
          viewBox="0 0 8 8"
          className={`shrink-0 text-text-3 transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M2 1.5 5.5 4 2 6.5Z" fill="currentColor" />
        </svg>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge ? <span className="shrink-0 tabular-nums text-[11px] text-accent">{badge}</span> : null}
      </summary>

      <div className="pb-2">
        {children}
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="mt-0.5 px-2 py-1 text-[11px] text-text-3 transition-colors hover:text-text-1"
          >
            Clear {label.toLowerCase()}
          </button>
        ) : null}
      </div>
    </details>
  );
}

function SegmentRadio({
  name,
  label,
  checked,
  onSelect,
}: {
  name: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius)] px-2 py-1 text-[12px] hover:bg-ink-2">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="h-3.5 w-3.5 shrink-0 accent-accent"
      />
      <span className={`min-w-0 flex-1 truncate ${checked ? "text-text-0" : "text-text-1"}`}>
        {label}
      </span>
    </label>
  );
}
