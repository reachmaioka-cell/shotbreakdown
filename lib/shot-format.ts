/**
 * Pure helpers safe to import from client components.
 *
 * Kept out of lib/shots.ts because that module reaches the database and the
 * SSRF-guarded fetch layer, which pull node:dns into any bundle that touches
 * them.
 */

export function shotHref(shot: { slug: string | null; id: string }): string {
  return shot.slug ? `/shots/${shot.slug}` : `/shots/${shot.id}`;
}

export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return formatTimecode(seconds);
}

export type ShotCard = {
  id: string;
  slug: string | null;
  videoId: string;
  shotIndex: number;
  title: string | null;
  summary: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  /** Watch/embed source when the tile can play (YouTube, TikTok, or reconstructed from a thumb). */
  sourceUrl: string | null;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  tags: string[];
  shotSize: string | null;
  cameraAngle: string | null;
  movementType: string | null;
  lightingKey: string | null;
  colorTemperature: string | null;
  timeOfDay: string | null;
  moods: string[];
  dominantColors: string[];
  visibility: "private" | "unlisted" | "public";
  sourceType: string | null;
  videoTitle: string | null;
  createdAt: string;
  /**
   * Why this shot came back. Used to explain a result without exposing search
   * internals: a literal term hit reads differently to a look-alike match.
   */
  matchedKeyword?: boolean;
  matchedSemantic?: boolean;
};
