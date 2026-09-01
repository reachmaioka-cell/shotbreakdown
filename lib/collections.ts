import { preferClipFrame } from "@/lib/clip";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveMediaUrl } from "@/lib/media";

export type CollectionKind = "collection" | "sequence";
export type Visibility = "private" | "unlisted" | "public";

export type CollectionSummary = {
  id: string;
  name: string;
  slug: string;
  kind: CollectionKind;
  description: string | null;
  parentId: string | null;
  visibility: Visibility;
  itemCount: number;
  coverUrl: string | null;
  previewUrls: string[];
  updatedAt: string;
  createdAt: string;
};

export type CollectionNode = CollectionSummary & { children: CollectionNode[]; depth: number };

export function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "collection"
  );
}

/** Ensure a per-user unique slug without a race-prone read-then-write loop. */
export async function uniqueSlug(userId: string, base: string): Promise<string> {
  const admin = createAdminClient();
  const root = slugifyName(base);
  const { data } = await admin
    .from("collections")
    .select("slug")
    .eq("user_id", userId)
    .like("slug", `${root}%`);

  const taken = new Set((data ?? []).map((r) => r.slug as string));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 500; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

type CollectionRow = {
  id: string;
  name: string;
  slug: string;
  kind: CollectionKind;
  description: string | null;
  parent_id: string | null;
  visibility: Visibility;
  item_count: number;
  cover_shot_id: string | null;
  updated_at: string;
  created_at: string;
};

/**
 * Collections with a few cover frames each. The preview thumbnails are what
 * make the list read as a visual library rather than a folder tree.
 */
export async function listCollections(
  userId: string,
  options: { kind?: CollectionKind; previews?: number } = {}
): Promise<CollectionSummary[]> {
  const admin = createAdminClient();
  let query = admin
    .from("collections")
    .select(
      "id, name, slug, kind, description, parent_id, visibility, item_count, cover_shot_id, updated_at, created_at"
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (options.kind) query = query.eq("kind", options.kind);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as CollectionRow[];
  if (rows.length === 0) return [];

  const previewCount = options.previews ?? 4;
  const { data: items } = await admin
    .from("collection_items")
    .select("collection_id, position, shots ( thumbnail_path )")
    .in(
      "collection_id",
      rows.map((r) => r.id)
    )
    .order("position")
    .limit(rows.length * previewCount * 3);

  const byCollection = new Map<string, string[]>();
  for (const item of items ?? []) {
    const shot = Array.isArray(item.shots) ? item.shots[0] : item.shots;
    const path = shot?.thumbnail_path as string | undefined;
    if (!path) continue;
    const list = byCollection.get(item.collection_id as string) ?? [];
    if (list.length < previewCount) list.push(path);
    byCollection.set(item.collection_id as string, list);
  }

  return Promise.all(
    rows.map(async (row) => {
      const paths = byCollection.get(row.id) ?? [];
      const previewUrls = (
        await Promise.all(paths.map(async (p) => preferClipFrame(await resolveMediaUrl(p))))
      ).filter((u): u is string => !!u);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        kind: row.kind,
        description: row.description,
        parentId: row.parent_id,
        visibility: row.visibility,
        itemCount: row.item_count,
        coverUrl: previewUrls[0] ?? null,
        previewUrls,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
      };
    })
  );
}

/** Nest a flat list. Orphans (parent outside the list) surface at the root. */
export function buildTree(collections: CollectionSummary[]): CollectionNode[] {
  const byId = new Map<string, CollectionNode>();
  for (const c of collections) byId.set(c.id, { ...c, children: [], depth: 0 });

  const roots: CollectionNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const assignDepth = (nodes: CollectionNode[], depth: number) => {
    for (const node of nodes) {
      node.depth = depth;
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      assignDepth(node.children, depth + 1);
    }
  };
  assignDepth(roots, 0);
  roots.sort((a, b) => a.name.localeCompare(b.name));
  return roots;
}

export type CollectionItem = {
  itemId: string;
  position: number;
  note: string | null;
  shotId: string;
  slug: string | null;
  title: string | null;
  summary: string | null;
  thumbnailUrl: string | null;
  aspectRatio: string | null;
  startSeconds: number;
  durationSeconds: number;
  videoId: string;
  videoTitle: string | null;
  shotSize: string | null;
  movementType: string | null;
  visibility: Visibility;
};

export type CollectionDetail = CollectionSummary & {
  userId: string;
  items: CollectionItem[];
  /**
   * Members withheld from this viewer because the shot itself is private.
   * Shown to the owner so sharing a deck never quietly drops frames.
   */
  hiddenItemCount: number;
  ancestors: { id: string; name: string; slug: string }[];
  children: CollectionSummary[];
};

/**
 * Load a collection with authorization applied.
 * `allowUnlisted` is set only when the caller arrived with a valid share token.
 */
export async function getCollection(
  identifier: { id?: string; userId?: string; slug?: string },
  viewerId: string | null,
  options: { allowUnlisted?: boolean } = {}
): Promise<CollectionDetail | null> {
  const admin = createAdminClient();
  let query = admin
    .from("collections")
    .select(
      "id, user_id, name, slug, kind, description, parent_id, visibility, item_count, cover_shot_id, updated_at, created_at"
    );

  if (identifier.id) query = query.eq("id", identifier.id);
  else if (identifier.userId && identifier.slug) {
    query = query.eq("user_id", identifier.userId).eq("slug", identifier.slug);
  } else return null;

  const { data: row } = await query.maybeSingle();
  if (!row) return null;

  const isOwner = viewerId !== null && row.user_id === viewerId;
  const isPublic = row.visibility === "public";
  const isUnlisted = row.visibility === "unlisted";
  if (!isOwner && !isPublic && !(isUnlisted && options.allowUnlisted)) return null;

  const { data: itemRows } = await admin
    .from("collection_items")
    .select(
      `id, position, note, shot_id,
       shots ( id, slug, title, summary, thumbnail_path, aspect_ratio, start_seconds,
               duration_seconds, video_id, visibility, shot_size, movement_type,
               videos ( title ) )`
    )
    .eq("collection_id", row.id)
    .order("position");

  /*
   * A collection's visibility does not grant access to the shots inside it.
   * This query runs through the admin client, so RLS is bypassed and each
   * member shot has to be checked here: publishing or sharing a deck must never
   * silently expose a private shot the owner did not choose to share.
   *
   * A shot reached through a share link may be unlisted — that is the same
   * grant the link itself carries — but never private.
   */
  const allowedForViewer = (shot: Record<string, unknown> | null): boolean => {
    if (isOwner) return true;
    const visibility = (shot?.visibility as Visibility | undefined) ?? "private";
    if (visibility === "public") return true;
    return visibility === "unlisted" && !!options.allowUnlisted;
  };

  const visibleRows = (itemRows ?? []).filter((item) =>
    allowedForViewer((Array.isArray(item.shots) ? item.shots[0] : item.shots) as Record<string, unknown> | null)
  );
  const hiddenItemCount = (itemRows ?? []).length - visibleRows.length;

  const items: CollectionItem[] = await Promise.all(
    visibleRows.map(async (item) => {
      const shot = (Array.isArray(item.shots) ? item.shots[0] : item.shots) as Record<
        string,
        unknown
      > | null;
      const video = shot
        ? ((Array.isArray(shot.videos) ? shot.videos[0] : shot.videos) as {
            title?: string | null;
          } | null)
        : null;
      return {
        itemId: item.id as string,
        position: item.position as number,
        note: (item.note as string | null) ?? null,
        shotId: item.shot_id as string,
        slug: (shot?.slug as string | null) ?? null,
        title: (shot?.title as string | null) ?? null,
        summary: (shot?.summary as string | null) ?? null,
        thumbnailUrl: preferClipFrame(
          await resolveMediaUrl((shot?.thumbnail_path as string | null) ?? null)
        ),
        aspectRatio: (shot?.aspect_ratio as string | null) ?? null,
        startSeconds: Number(shot?.start_seconds ?? 0),
        durationSeconds: Number(shot?.duration_seconds ?? 0),
        videoId: (shot?.video_id as string) ?? "",
        videoTitle: video?.title ?? null,
        shotSize: (shot?.shot_size as string | null) ?? null,
        movementType: (shot?.movement_type as string | null) ?? null,
        visibility: (shot?.visibility as Visibility) ?? "private",
      };
    })
  );

  const ancestors: { id: string; name: string; slug: string }[] = [];
  let parentId = row.parent_id as string | null;
  for (let i = 0; i < 16 && parentId; i++) {
    const { data: parent } = await admin
      .from("collections")
      .select("id, name, slug, parent_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!parent) break;
    ancestors.unshift({ id: parent.id as string, name: parent.name as string, slug: parent.slug as string });
    parentId = parent.parent_id as string | null;
  }

  const { data: childRows } = await admin
    .from("collections")
    .select(
      "id, name, slug, kind, description, parent_id, visibility, item_count, cover_shot_id, updated_at, created_at"
    )
    .eq("parent_id", row.id)
    .order("name");

  const children: CollectionSummary[] = ((childRows ?? []) as CollectionRow[])
    .filter((c) => isOwner || c.visibility === "public")
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      kind: c.kind,
      description: c.description,
      parentId: c.parent_id,
      visibility: c.visibility,
      itemCount: c.item_count,
      coverUrl: null,
      previewUrls: [],
      updatedAt: c.updated_at,
      createdAt: c.created_at,
    }));

  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    slug: row.slug as string,
    kind: row.kind as CollectionKind,
    description: row.description as string | null,
    parentId: row.parent_id as string | null,
    visibility: row.visibility as Visibility,
    // The stored counter includes members this viewer may not see.
    itemCount: isOwner ? (row.item_count as number) : items.length,
    hiddenItemCount,
    coverUrl: items[0]?.thumbnailUrl ?? null,
    previewUrls: items.slice(0, 4).map((i) => i.thumbnailUrl).filter((u): u is string => !!u),
    updatedAt: row.updated_at as string,
    createdAt: row.created_at as string,
    items,
    ancestors,
    children,
  };
}

/** Which of these shots the viewer has already saved — for filled save icons. */
export async function savedShotIds(userId: string | null, shotIds: string[]): Promise<Set<string>> {
  if (!userId || shotIds.length === 0) return new Set();
  const admin = createAdminClient();
  const { data } = await admin
    .from("saved_shots")
    .select("shot_id")
    .eq("user_id", userId)
    .in("shot_id", shotIds.slice(0, 500));
  return new Set((data ?? []).map((r) => r.shot_id as string));
}
