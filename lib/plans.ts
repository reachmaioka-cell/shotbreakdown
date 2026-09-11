/**
 * Plan entitlements. Every limit here is enforced server-side; nothing in the
 * browser is trusted to hold a user inside their plan.
 */

export type PlanId = "free" | "pro";

export type PlanLimits = {
  /** Segments a user may submit for analysis per rolling month. */
  videosPerMonth: number;
  /**
   * Longest single segment, in seconds.
   *
   * This is a product boundary, not a cost ceiling. A breakdown has to be
   * specific about what happens and how each shot is cut; over a few minutes
   * that stops being one answer and becomes a summary of many. The uploader
   * trims to the part they care about before anything is analysed.
   */
  maxVideoSeconds: number;
  /** Largest upload, in bytes. Measured on the file, before trimming. */
  maxUploadBytes: number;
  /** Most shots analysed from one segment. */
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
    maxVideoSeconds: 60,
    maxUploadBytes: 300 * 1024 * 1024,
    maxShotsPerVideo: 12,
    maxSavedShots: 100,
    maxCollections: 5,
    semanticSearch: true,
    exports: false,
    jobPriority: 0,
  },
  pro: {
    videosPerMonth: 100,
    maxVideoSeconds: 180,
    maxUploadBytes: 2 * 1024 * 1024 * 1024,
    maxShotsPerVideo: 30,
    maxSavedShots: 100_000,
    maxCollections: 500,
    semanticSearch: true,
    exports: true,
    jobPriority: 10,
  },
};

/**
 * What Pro costs, in whole US dollars per month.
 *
 * The pricing page used to hardcode "$12" while the charge came from whatever
 * STRIPE_PRICE_ID happened to point at. When those two disagree the customer
 * is charged an amount the page never showed, which is a chargeback and a
 * refund, not a support ticket. This constant is what the page renders and
 * what `assertPriceMatches()` in lib/stripe.ts compares the live Price to.
 */
export const PRO_PRICE_USD_MONTHLY = 12;

export function planLimits(plan: string | null | undefined): PlanLimits {
  return PLANS[(plan === "pro" ? "pro" : "free") as PlanId];
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes % 1024 ** 3 === 0 ? 0 : 1)}GB`;
  return `${Math.round(bytes / 1024 ** 2)}MB`;
}

/**
 * Segment caps are a minute or three, so "1 minute" reads as a rounding of
 * something longer. Below two minutes we say the seconds.
 */
export function formatDurationLimit(seconds: number): string {
  if (seconds < 120) return `${Math.round(seconds)} seconds`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * How far past the plan cap a segment may land before the pipeline rejects it.
 *
 * Container timestamps, keyframe placement and the browser's duration estimate
 * disagree by fractions of a second, so an exact comparison would fail a
 * segment the user trimmed correctly.
 */
export const SEGMENT_LENGTH_TOLERANCE_SECONDS = 0.5;

/**
 * Below this, a trim is not worth a re-encode: the range covers the file.
 * Also the threshold for recording the range as provenance at all.
 */
export const SEGMENT_TRIM_EPSILON_SECONDS = 0.05;
