/**
 * Plan entitlements. Every limit here is enforced server-side; nothing in the
 * browser is trusted to hold a user inside their plan.
 */

export type PlanId = "free" | "pro";

export type PlanLimits = {
  /** Videos a user may submit for analysis per rolling month. */
  videosPerMonth: number;
  /** Longest single video, in seconds. */
  maxVideoSeconds: number;
  /** Largest upload, in bytes. */
  maxUploadBytes: number;
  /** Most shots analysed from one video. */
  maxShotsPerVideo: number;
  /** Saved shots ceiling. */
  maxSavedShots: number;
  /** Collections ceiling. */
  maxCollections: number;
  /** Semantic search and Find Similar. */
  semanticSearch: boolean;
  /** PDF / CSV / JSON export. */
  exports: boolean;
  /** Queue priority for the worker. */
  jobPriority: number;
};

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    videosPerMonth: 3,
    maxVideoSeconds: 5 * 60,
    maxUploadBytes: 300 * 1024 * 1024,
    maxShotsPerVideo: 40,
    maxSavedShots: 100,
    maxCollections: 5,
    semanticSearch: true,
    exports: false,
    jobPriority: 0,
  },
  pro: {
    videosPerMonth: 100,
    maxVideoSeconds: 30 * 60,
    maxUploadBytes: 2 * 1024 * 1024 * 1024,
    maxShotsPerVideo: 120,
    maxSavedShots: 100_000,
    maxCollections: 500,
    semanticSearch: true,
    exports: true,
    jobPriority: 10,
  },
};

export function planLimits(plan: string | null | undefined): PlanLimits {
  return PLANS[(plan === "pro" ? "pro" : "free") as PlanId];
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes % 1024 ** 3 === 0 ? 0 : 1)}GB`;
  return `${Math.round(bytes / 1024 ** 2)}MB`;
}

export function formatDurationLimit(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
