/**
 * Plan entitlements. Every limit here is enforced server-side; nothing in the
 * browser is trusted to hold a user inside their plan.
 */

export type PlanId = "free" | "pro";

export type PlanLimits = {
  /** Segments a user may submit for analysis per rolling month. */
  videosPerMonth: number;
  /**
   * Longest single segment, in seconds. The same on both plans.
   *
   * A segment costs what its shots cost — one model call each — and shots are
   * cuts plus one, so length is the only lever that bounds one analysis.
   * Fifteen seconds of music video is five to ten shots; a minute was up to
   * thirty. The cap is what pays for a generous monthly allowance, so it is
   * the product boundary: the uploader trims to the part they care about, and
   * the breakdown is specific about every shot in it.
   */
  maxVideoSeconds: number;
  /** Largest upload, in bytes. Measured on the file, before trimming. */
  maxUploadBytes: number;
  /**
   * Most shots analysed from one segment.
   *
   * This used to be the per-plan cost dial; the length cap took that job. At
   * SHOT_DETECTION.minShotSeconds (0.8s) the longest segment either plan can
   * submit — the cap plus the tolerance below — cannot break into more than
   * nineteen shots, so both plans sit one above that. Deliberately unreachable:
   * detectShots stops at this number without saying so, so a cap that bound
   * would hand a fast-cut fifteen seconds back with its last seconds missing
   * and no error. It stays as the backstop for the day the length cap or
   * minShotSeconds moves.
   */
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
    maxVideoSeconds: 15,
    maxUploadBytes: 300 * 1024 * 1024,
    maxShotsPerVideo: 20,
    maxSavedShots: 100,
    maxCollections: 5,
    semanticSearch: true,
    exports: false,
    jobPriority: 0,
  },
  pro: {
    videosPerMonth: 72,
    maxVideoSeconds: 15,
    maxUploadBytes: 2 * 1024 * 1024 * 1024,
    maxShotsPerVideo: 20,
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
export const PRO_PRICE_USD_MONTHLY = 15;

export function planLimits(plan: string | null | undefined): PlanLimits {
  return PLANS[(plan === "pro" ? "pro" : "free") as PlanId];
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes % 1024 ** 3 === 0 ? 0 : 1)}GB`;
  return `${Math.round(bytes / 1024 ** 2)}MB`;
}

/**
 * A length limit as a person would say it.
 *
 * The caps are seconds now, and rounding one of those to minutes is how the
 * pricing page came to offer "up to 0 minutes per video". Anything under two
 * minutes is said in seconds; this is the only thing that should ever render a
 * cap to a human.
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
 * segment the user trimmed correctly. It earns its keep hardest on a file
 * nobody trimmed: the browser waves through a clip it measured at 15.0s and
 * ffprobe then reads 15.03.
 *
 * Half a second was a rounding error against the old three-minute cap and is
 * 3% of this one, so it was worth re-deciding. It stays as it is. What it
 * absorbs is a property of timestamp precision, not a fraction of the cap, so
 * shrinking it with the cap would start refusing correctly trimmed segments —
 * and what it can cost is bounded: half a second is at most one more shot at
 * SHOT_DETECTION.minShotSeconds, still well inside maxShotsPerVideo.
 */
export const SEGMENT_LENGTH_TOLERANCE_SECONDS = 0.5;

/**
 * Below this, a trim is not worth a re-encode: the range covers the file.
 * Also the threshold for recording the range as provenance at all.
 */
export const SEGMENT_TRIM_EPSILON_SECONDS = 0.05;
