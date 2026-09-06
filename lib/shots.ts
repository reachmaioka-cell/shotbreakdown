import { clipSourceUrl, preferClipFrame } from "@/lib/clip";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveMediaUrl } from "@/lib/media";
import { ShotMetadataSchema, type ShotMetadata } from "@/lib/validation";
import { overlayBreakdown } from "@/lib/overlay";
import { formatDuration, formatTimecode, shotHref, type ShotCard } from "@/lib/shot-format";
import type { ShotFrame } from "@/lib/shot-format-types";

export { formatDuration, formatTimecode, shotHref };
export type { ShotCard };

export type ShotScope = "public" | "mine" | "saved";


export type ShotSearchFilters = Partial<{
  shot_size: string[];
  camera_angle: string[];
  camera_height: string[];
  movement_type: string[];
  movement_speed: string[];
  lens_type: string[];
  depth_of_field: string[];
  lighting_key: string[];
  lighting_quality: string[];
  key_direction: string[];
  lighting_source: string[];
  color_temperature: string[];
  saturation: string[];
  interior_exterior: string[];
  time_of_day: string[];
  aspect_ratio: string[];
  subject_types: string[];
  moods: string[];
  colors: string[];
  tags: string[];
  source_type: string[];
  video_id: string;
  collection_id: string;
  min_duration: number;
  max_duration: number;
}>;

type SearchRow = {
  id: string;
  slug: string | null;
  video_id: string;
  shot_index: number;
  title: string | null;
  summary: string | null;
  description: string | null;
  thumbnail_path: string | null;
  poster_path: string | null;
  start_seconds: string | number;
  end_seconds: string | number;
  duration_seconds: string | number;
  tags: string[] | null;
  width: number | null;
  height: number | null;
  aspect_ratio: string | null;
  shot_size: string | null;
  camera_angle: string | null;
  movement_type: string | null;
  movement_speed: string | null;
  lens_type: string | null;
  depth_of_field: string | null;
  lighting_key: string | null;
  lighting_quality: string | null;
  color_temperature: string | null;
  time_of_day: string | null;
  interior_exterior: string | null;
  location_type: string | null;
  subject_types: string[] | null;
  moods: string[] | null;
  dominant_colors: string[] | null;
  visibility: "private" | "unlisted" | "public";
  user_id: string | null;
  source_type: string | null;
  video_title: string | null;
  created_at: string;
  score: number;
  matched_keyword: boolean | null;
  matched_semantic: boolean | null;
  total_count: number;
};

async function videoSourceUrls(
  admin: ReturnType<typeof createAdminClient>,
  videoIds: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const unique = [...new Set(videoIds.filter(Boolean))];
  const chunkSize = 80;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data, error } = await admin.from("videos").select("id, source_url").in("id", chunk);
    if (error) {
      console.error("videoSourceUrls", error.message);
      break;
    }
    for (const row of data ?? []) {
      map.set(row.id as string, (row.source_url as string | null) ?? null);
    }
  }
  return map;
}

async function toCard(row: SearchRow, videoSourceUrl?: string | null): Promise<ShotCard> {
  const stored = await resolveMediaUrl(row.thumbnail_path ?? row.poster_path);
  const thumbnailUrl = preferClipFrame(stored, videoSourceUrl);
  return {
    id: row.id,
    slug: row.slug,
    videoId: row.video_id,
    shotIndex: row.shot_index,
    title: row.title,
    summary: row.summary,
    description: row.description,
    thumbnailUrl,
    sourceUrl: clipSourceUrl({
      sourceUrl: videoSourceUrl,
      thumbnailUrl: stored ?? thumbnailUrl,
    }),
    startSeconds: Number(row.start_seconds),
    endSeconds: Number(row.end_seconds),
    durationSeconds: Number(row.duration_seconds),
    width: row.width,
    height: row.height,
    aspectRatio: row.aspect_ratio,
    tags: row.tags ?? [],
    shotSize: row.shot_size,
    cameraAngle: row.camera_angle,
    movementType: row.movement_type,
    lightingKey: row.lighting_key,
    colorTemperature: row.color_temperature,
    timeOfDay: row.time_of_day,
    moods: row.moods ?? [],
    dominantColors: row.dominant_colors ?? [],
    visibility: row.visibility,
    sourceType: row.source_type,
    videoTitle: row.video_title,
    createdAt: row.created_at,
    matchedKeyword: !!row.matched_keyword,
    matchedSemantic: !!row.matched_semantic,
  };
}

export type ShotSearchResult = {
  shots: ShotCard[];
  total: number;
  usedSemantic: boolean;
  degraded: boolean;
};

/**
 * Search shots. Structured filters always apply; a query adds full-text and,
 * where an embedding is available, semantic matching fused by the SQL side.
 *
 * If the embedding provider fails we still return keyword results but say so,
 * rather than pretending the semantic half ran.
 */
export async function searchShots(options: {
  query?: string | null;
  filters?: ShotSearchFilters;
  limit?: number;
  offset?: number;
  viewerId?: string | null;
  scope?: ShotScope;
  semantic?: boolean;
}): Promise<ShotSearchResult> {
  const admin = createAdminClient();
  const query = options.query?.trim() || null;
  let embedding: number[] | null = null;
  let degraded = false;

  if (query && options.semantic !== false) {
    try {
      const { embed } = await import("@/lib/embeddings");
      embedding = await embed(query);
    } catch (e) {
      degraded = true;
      console.error("searchShots embed", e instanceof Error ? e.message : e);
    }
  }

  const { data, error } = await admin.rpc("search_shots", {
    p_query: query,
    p_embedding: embedding,
    p_filters: (options.filters ?? {}) as unknown as Record<string, unknown>,
    p_limit: options.limit ?? 48,
    p_offset: options.offset ?? 0,
    p_viewer: options.viewerId ?? null,
    p_scope: options.scope ?? "public",
  });

  if (error) throw new Error(`search_shots: ${error.message}`);

  const rows = (data ?? []) as SearchRow[];
  const sourceByVideo = await videoSourceUrls(
    admin,
    rows.map((row) => row.video_id)
  );
  const shots = await Promise.all(
    rows.map((row) => toCard(row, sourceByVideo.get(row.video_id) ?? null))
  );

  return {
    shots,
    total: rows[0]?.total_count ? Number(rows[0].total_count) : 0,
    usedSemantic: embedding !== null,
    degraded,
  };
}

export type FacetCount = { facet: string; value: string; count: number };

export async function shotFacetCounts(options: {
  viewerId?: string | null;
  scope?: ShotScope;
}): Promise<Record<string, FacetCount[]>> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("shot_facet_counts", {
    p_viewer: options.viewerId ?? null,
    p_scope: options.scope ?? "public",
  });
  if (error) throw new Error(`shot_facet_counts: ${error.message}`);

  const grouped: Record<string, FacetCount[]> = {};
  for (const row of (data ?? []) as { facet: string; value: string; count: number }[]) {
    const entry = { facet: row.facet, value: row.value, count: Number(row.count) };
    (grouped[row.facet] ??= []).push(entry);
  }
  return grouped;
}

export async function findSimilarShots(options: {
  shotId: string;
  limit?: number;
  viewerId?: string | null;
}): Promise<ShotCard[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("similar_shots", {
    p_shot_id: options.shotId,
    p_limit: options.limit ?? 24,
    p_viewer: options.viewerId ?? null,
  });
  if (error) throw new Error(`similar_shots: ${error.message}`);

  const rows = (data ?? []) as {
    id: string;
    slug: string | null;
    video_id: string;
    title: string | null;
    summary: string | null;
    thumbnail_path: string | null;
    aspect_ratio: string | null;
    width: number | null;
    height: number | null;
    visibility: "private" | "unlisted" | "public";
    similarity: number;
  }[];

  const sourceByVideo = await videoSourceUrls(
    admin,
    rows.map((row) => row.video_id)
  );

  return Promise.all(
    rows.map(async (row) => {
      const stored = await resolveMediaUrl(row.thumbnail_path);
      const videoSourceUrl = sourceByVideo.get(row.video_id) ?? null;
      const thumbnailUrl = preferClipFrame(stored, videoSourceUrl);
      return {
        id: row.id,
        slug: row.slug,
        videoId: row.video_id,
        shotIndex: 0,
        title: row.title,
        summary: row.summary,
        description: null,
        thumbnailUrl,
        sourceUrl: clipSourceUrl({
          sourceUrl: videoSourceUrl,
          thumbnailUrl: stored ?? thumbnailUrl,
        }),
        startSeconds: 0,
        endSeconds: 0,
        durationSeconds: 0,
        width: row.width,
        height: row.height,
        aspectRatio: row.aspect_ratio,
        tags: [],
        shotSize: null,
        cameraAngle: null,
        movementType: null,
        lightingKey: null,
        colorTemperature: null,
        timeOfDay: null,
        moods: [],
        dominantColors: [],
        visibility: row.visibility,
        sourceType: null,
        videoTitle: null,
        createdAt: "",
      };
    })
  );
}

export type ShotDetail = {
  id: string;
  slug: string | null;
  videoId: string;
  userId: string | null;
  shotIndex: number;
  title: string | null;
  metadata: ShotMetadata | null;
  rawMetadata: Record<string, unknown> | null;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  representativeTimestamp: number | null;
  representativeFrameId: string | null;
  posterUrl: string | null;
  thumbnailUrl: string | null;
  playbackUrl: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  tags: string[];
  visibility: "private" | "unlisted" | "public";
  status: string;
  errorMessage: string | null;
  viewCount: number;
  saveCount: number;
  createdAt: string;
  video: {
    id: string;
    title: string | null;
    sourceType: string;
    sourceUrl: string | null;
    durationSeconds: number | null;
    shotCount: number;
    visibility: string;
    userId: string | null;
  } | null;
};

/** Load one shot with authorization applied. Returns null when not visible. */
export async function getShot(
  shotId: string,
  viewerId: string | null,
  options: { bySlug?: boolean; allowUnlisted?: boolean } = {}
): Promise<ShotDetail | null> {
  const admin = createAdminClient();
  const column = options.bySlug ? "slug" : "id";

  const { data, error } = await admin
    .from("shots")
    .select(
      `id, slug, video_id, user_id, shot_index, title, metadata, metadata_edits,
       start_seconds, end_seconds, duration_seconds, representative_timestamp,
       representative_frame_id, poster_path, thumbnail_path, width, height,
       aspect_ratio, tags, visibility, status, error_message, view_count, save_count, created_at,
       videos!inner ( id, title, source_type, source_url, file_path, duration_seconds, shot_count, visibility, user_id )`
    )
    .eq(column, shotId)
    .maybeSingle();

  if (error || !data) return null;

  const isOwner = viewerId !== null && data.user_id === viewerId;
  const isPublic = data.visibility === "public";
  const isUnlisted = data.visibility === "unlisted";
  if (!isOwner && !isPublic && !(isUnlisted && options.allowUnlisted)) return null;

  const rawMetadata = data.metadata as Record<string, unknown> | null;
  const merged = rawMetadata
    ? overlayBreakdown(rawMetadata, data.metadata_edits as Record<string, unknown> | null)
    : null;
  const parsed = merged ? ShotMetadataSchema.safeParse(merged) : null;

  const video = Array.isArray(data.videos) ? data.videos[0] : data.videos;
  const sourceUrl = (video?.source_url as string | null) ?? null;
  const storedPoster = await resolveMediaUrl(data.poster_path as string | null);
  const storedThumb = await resolveMediaUrl(data.thumbnail_path as string | null);
  const playbackUrl =
    typeof video?.file_path === "string" && video.file_path
      ? await resolveMediaUrl(video.file_path)
      : null;

  return {
    id: data.id as string,
    slug: data.slug as string | null,
    videoId: data.video_id as string,
    userId: data.user_id as string | null,
    shotIndex: data.shot_index as number,
    title: data.title as string | null,
    metadata: parsed?.success ? parsed.data : (merged as ShotMetadata | null),
    rawMetadata: merged,
    startSeconds: Number(data.start_seconds),
    endSeconds: Number(data.end_seconds),
    durationSeconds: Number(data.duration_seconds),
    representativeTimestamp:
      data.representative_timestamp !== null ? Number(data.representative_timestamp) : null,
    representativeFrameId: data.representative_frame_id as string | null,
    posterUrl: preferClipFrame(storedPoster ?? storedThumb, sourceUrl),
    thumbnailUrl: preferClipFrame(storedThumb ?? storedPoster, sourceUrl),
    width: data.width as number | null,
    height: data.height as number | null,
    aspectRatio: data.aspect_ratio as string | null,
    tags: (data.tags as string[] | null) ?? [],
    visibility: data.visibility as ShotDetail["visibility"],
    status: data.status as string,
    errorMessage: data.error_message as string | null,
    viewCount: (data.view_count as number) ?? 0,
    saveCount: (data.save_count as number) ?? 0,
    createdAt: data.created_at as string,
    video: video
      ? {
          id: video.id as string,
          title: video.title as string | null,
          sourceType: video.source_type as string,
          sourceUrl,
          durationSeconds:
            video.duration_seconds !== null ? Number(video.duration_seconds) : null,
          shotCount: (video.shot_count as number) ?? 0,
          visibility: video.visibility as string,
          userId: video.user_id as string | null,
        }
      : null,
    playbackUrl,
  };
}

export type { ShotFrame } from "@/lib/shot-format-types";

export async function getShotFrames(
  shotId: string,
  viewerId: string | null,
  options: { allowPublic?: boolean } = {}
): Promise<ShotFrame[]> {
  const admin = createAdminClient();
  const { data: shot } = await admin
    .from("shots")
    .select("id, user_id, visibility")
    .eq("id", shotId)
    .maybeSingle();

  if (!shot) return [];
  const isOwner = viewerId !== null && shot.user_id === viewerId;
  if (!isOwner && !(options.allowPublic && shot.visibility !== "private")) return [];

  const { data } = await admin
    .from("shot_frames")
    .select("id, timestamp_seconds, storage_path, thumb_path, is_representative, score")
    .eq("shot_id", shotId)
    .order("timestamp_seconds");

  return Promise.all(
    (data ?? []).map(async (row) => ({
      id: row.id as string,
      timestampSeconds: Number(row.timestamp_seconds),
      url: await resolveMediaUrl(row.storage_path as string),
      thumbUrl: await resolveMediaUrl((row.thumb_path as string | null) ?? (row.storage_path as string)),
      isRepresentative: !!row.is_representative,
      score: row.score !== null ? Number(row.score) : null,
    }))
  );
}

