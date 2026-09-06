"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * The ordered result page, shared between the grid that rendered it and the
 * shot overlay that opens on top of it.
 *
 * The overlay is mounted by a parallel route, so it is a sibling of the grid
 * rather than a child: props and context cannot reach it. A module-level store
 * read through useSyncExternalStore is the smallest thing that spans both
 * trees, and it costs nothing on a page that never publishes.
 *
 * Deliberately dependency-free — nothing here may reach lib/shots.ts, which
 * pulls node:dns in through the SSRF guard and would poison the client bundle.
 */

/** A published result: an href, an id, or a shot-shaped object carrying both. */
export type ResultSetItem =
  | string
  | { id?: string | null; slug?: string | null; href?: string | null };

type Entry = { href: string; keys: string[] };
type Snapshot = { entries: readonly Entry[]; index: ReadonlyMap<string, number> };

/**
 * One shared empty snapshot for the server render and for any client render
 * before a grid has published. useSyncExternalStore compares snapshots by
 * identity, so returning a fresh object or array here would loop forever.
 */
const EMPTY_SNAPSHOT: Snapshot = { entries: [], index: new Map() };
const NO_NEIGHBOURS: Neighbours = { prev: null, next: null };

let snapshot: Snapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

export type Neighbours = { prev: string | null; next: string | null };

function lastSegment(href: string): string | null {
  const path = href.split("?")[0]!.split("#")[0]!;
  const segment = path.split("/").filter(Boolean).pop();
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Index every name a shot can be looked up by — id, slug and the tail of its
 * href — because the grid publishes what it has while the overlay only knows
 * what is in the URL, and those are not always the same string.
 */
function toEntry(item: ResultSetItem): Entry | null {
  const id = typeof item === "string" ? null : (item.id ?? null);
  const slug = typeof item === "string" ? null : (item.slug ?? null);

  let href: string | null;
  if (typeof item === "string") {
    href = item.startsWith("/") ? item : `/shots/${encodeURIComponent(item)}`;
  } else if (item.href) {
    href = item.href;
  } else if (slug || id) {
    href = `/shots/${encodeURIComponent(slug ?? id!)}`;
  } else {
    href = null;
  }
  if (!href) return null;

  const keys: string[] = [];
  for (const key of [id, slug, lastSegment(href)]) {
    if (key && !keys.includes(key)) keys.push(key);
  }
  return { href, keys };
}

function sameOrder(a: readonly Entry[], b: readonly Entry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, i) => entry.href === b[i]!.href);
}

/**
 * Publish the current page of results. Safe to call from a render effect on
 * every update: an unchanged list is dropped rather than notified, so a grid
 * that re-publishes as it pages in does not thrash its subscribers.
 */
export function setResultSet(items: readonly ResultSetItem[]): void {
  const entries: Entry[] = [];
  const index = new Map<string, number>();

  for (const item of items) {
    const entry = toEntry(item);
    if (!entry) continue;
    const position = entries.length;
    entries.push(entry);
    // First occurrence wins: a duplicate id later in the list must not move the
    // neighbours of the copy the user is actually looking at.
    for (const key of entry.keys) if (!index.has(key)) index.set(key, position);
  }

  if (sameOrder(entries, snapshot.entries)) return;
  snapshot = { entries, index };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return EMPTY_SNAPSHOT;
}

/**
 * The hrefs either side of `currentId` in the published result set. Both are
 * null when nothing has been published (a deep link, or a fresh reload), which
 * is the signal to hide prev/next entirely rather than offer dead controls.
 *
 * `currentId` may be an id, a slug, or the shot's href.
 */
export function useResultNeighbours(currentId: string | null | undefined): Neighbours {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return useMemo(() => {
    if (!currentId) return NO_NEIGHBOURS;
    const key = currentId.startsWith("/") ? (lastSegment(currentId) ?? currentId) : currentId;
    const at = current.index.get(key);
    if (at === undefined) return NO_NEIGHBOURS;
    const prev = at > 0 ? (current.entries[at - 1]?.href ?? null) : null;
    const next = current.entries[at + 1]?.href ?? null;
    if (!prev && !next) return NO_NEIGHBOURS;
    return { prev, next };
  }, [current, currentId]);
}
