/**
 * Frame-to-frame change across a shot.
 *
 * The breakdown model is shown a handful of stills per shot and asked how the
 * shot was made. Stills cannot show a speed ramp, a freeze, a hold or a rewind;
 * this series can. A ramp rises or falls, a hold is a run near zero, and a
 * reverse turns around in a dip. It has no sign, so a rewind reads exactly like
 * forward motion — every description says so.
 */
export type MotionProfile = {
  /** Samples per second. */
  fps: number;
  /**
   * Mean absolute luma difference between consecutive frames, 0..1, four
   * decimals. Sample i covers the change from i/fps to (i+1)/fps, so the first
   * sample sits at the shot's start.
   */
  scores: number[];
};

export type MotionShape =
  | "still"
  | "steady"
  | "rising"
  | "falling"
  | "rise-then-fall"
  | "fall-then-rise"
  | "pulsing"
  | "mixed";

export type MotionSummary = {
  samples: number;
  seconds: number;
  mean: number;
  peak: number;
  shape: MotionShape;
  /**
   * Runs where the picture stops, in seconds from the shot's start. A ramped
   * dip is one the motion slopes into and out of: a speed ramp passing through
   * zero, which is where a reverse turns around. A stepped dip goes from full
   * motion to nothing and back in a sample: a held frame, a freeze, a still.
   */
  dips: Array<{ start: number; end: number; ramped: boolean }>;
  /** Moments far above their surroundings: a flash frame, a missed cut, a whip. */
  spikes: number[];
};

/**
 * Below this peak nothing moved. The value is small because the scores are:
 * ordinary handheld footage sits around 0.01-0.05 and a hard cut is 0.15-0.7.
 */
const STILL_PEAK = 0.005;
/** A dip sample is below this fraction of the profile's median. */
const DIP_FRACTION = 0.35;
/**
 * A dip shorter than this has to sit at the bottom of a V — the samples either
 * side already low — to count. A frame-rate conversion repeats a frame now and
 * then, which is one zero between two ordinary samples; a speed ramp passing
 * through zero slows into its hold and out of it, and at the source rate that
 * hold is often one to three frames long. The shoulders tell them apart.
 */
const DIP_MIN_SECONDS = 0.2;
/** A shoulder sample is below this fraction of the median. */
const SHOULDER_FRACTION = 0.7;
/**
 * How far either side of a dip the slope is read, and how low the run next to
 * the dip has to sit for the dip to count as ramped. A stills sequence or a
 * freeze steps straight from full motion to nothing; a time remap slows into
 * the hold over a quarter of a second or more, so the samples beside the dip
 * are already well under the level.
 */
const RAMP_SECONDS = 0.3;
const RAMP_FRACTION = 0.8;
/** Samples per second the motion pass runs at: the source rate, within reason. */
export function motionSampleRate(sourceFps: number): number {
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) return 24;
  return Math.min(60, Math.max(8, Math.round(sourceFps)));
}
/** A spike sample is above this multiple of its neighbours' median, and above the floor. */
const SPIKE_FRACTION = 4;
const SPIKE_FLOOR = 0.08;
/** A run is trending when its fitted line changes by this fraction of its mean. */
const TREND = 0.5;
/** A trendless run is steady when its smoothed level varies less than this fraction of its mean. */
const FLAT = 0.25;
/** How many dips and spikes a description names before it says "+N more". */
const NAMED_DIPS = 6;
const NAMED_SPIKES = 4;
const SERIES_POINTS = 12;

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The samples of one shot out of a longer series.
 *
 * Sample i compares frame i with frame i+1, so the last sample before a cut is
 * the cut itself and belongs to neither shot: a shot stops short of its end
 * boundary by `margin` samples. The margin is one when the cut was found at
 * this series' own rate; when the cut pass ran slower than the motion pass,
 * the cut could sit on any of the source frames that one cut sample covered,
 * so the margin is the ratio of the two rates. The final shot has no cut after
 * it and keeps its last sample. A shot shorter than one sample still yields one.
 */
export function sliceMotion(
  series: MotionProfile,
  startSeconds: number,
  endSeconds: number,
  margin = 1
): MotionProfile {
  const { fps, scores } = series;
  const start = Math.min(Math.max(0, Math.round(startSeconds * fps)), Math.max(0, scores.length - 1));
  const boundary = Math.round(endSeconds * fps);
  const end =
    boundary >= scores.length ? scores.length : Math.max(start + 1, boundary - Math.max(1, margin));
  return { fps, scores: scores.slice(start, end) };
}

/**
 * Bin-average down to at most `maxSamples`; the rate drops by the same factor.
 * The default keeps thirty seconds at 24/s whole. Past that a hold shorter
 * than a bin is averaged away, which is the trade for a bounded row.
 */
export function compactMotion(profile: MotionProfile, maxSamples = 720): MotionProfile {
  const { fps, scores } = profile;
  if (scores.length <= maxSamples) return profile;
  const factor = Math.ceil(scores.length / maxSamples);
  const binned: number[] = [];
  for (let i = 0; i < scores.length; i += factor) {
    binned.push(round(mean(scores.slice(i, i + factor)), 4));
  }
  return { fps: fps / factor, scores: binned };
}

/** Index runs where every sample is below `limit`. */
function runsBelow(scores: number[], limit: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= scores.length; i++) {
    const low = i < scores.length && scores[i] < limit;
    if (low && start < 0) start = i;
    if (!low && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}

/**
 * Runs of samples far above their surroundings, each with its highest
 * sample; the window is about a second each side. A run is one spike: a
 * flash frame or a missed cut is one sample, a whip pan a few, and the
 * series shows the width either way.
 */
function findSpikes(scores: number[], fps: number): Array<{ start: number; end: number; top: number }> {
  const radius = Math.max(2, Math.round(fps));
  const high = (i: number): boolean => {
    if (scores[i] <= SPIKE_FLOOR) return false;
    const local = median(scores.slice(Math.max(0, i - radius), i + radius + 1));
    return scores[i] > local * SPIKE_FRACTION;
  };
  const spikes: Array<{ start: number; end: number; top: number }> = [];
  for (let i = 0; i < scores.length; i++) {
    if (!high(i)) continue;
    const start = i;
    let top = i;
    while (i + 1 < scores.length && high(i + 1)) {
      i++;
      if (scores[i] > scores[top]) top = i;
    }
    spikes.push({ start, end: i, top });
  }
  return spikes;
}

/** Change of the least-squares line across the run, as a fraction of the run's mean. */
function relativeTrend(values: number[]): number {
  const n = values.length;
  const level = mean(values);
  if (n < 2 || level === 0) return 0;
  const tMean = (n - 1) / 2;
  let cov = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    cov += (i - tMean) * (values[i] - level);
    variance += (i - tMean) ** 2;
  }
  return ((cov / variance) * (n - 1)) / level;
}

/** Variation of the smoothed run as a fraction of its mean, so sample-to-sample jitter does not count. */
function wobble(values: number[], window: number): number {
  const level = mean(values);
  if (values.length < window || level === 0) return 0;
  const smoothed: number[] = [];
  for (let i = 0; i + window <= values.length; i++) {
    smoothed.push(mean(values.slice(i, i + window)));
  }
  const deviation = Math.sqrt(mean(smoothed.map((v) => (v - level) ** 2)));
  return deviation / level;
}

/**
 * The run's shape, judged with dips and spikes already masked out: a hold in
 * the middle of a steady pan must not read as fall-then-rise.
 */
function classify(masked: number[], fps: number): MotionShape {
  if (masked.length < 4) return "steady";
  const half = masked.length >> 1;
  const first = relativeTrend(masked.slice(0, half));
  const second = relativeTrend(masked.slice(half));
  if (first > TREND && second < -TREND) return "rise-then-fall";
  if (first < -TREND && second > TREND) return "fall-then-rise";
  const whole = relativeTrend(masked);
  if (whole > TREND) return "rising";
  if (whole < -TREND) return "falling";
  return wobble(masked, Math.max(3, Math.round(fps / 2))) < FLAT ? "steady" : "mixed";
}

export function summarizeMotion(profile: MotionProfile): MotionSummary {
  const { fps, scores } = profile;
  const peak = scores.length ? Math.max(...scores) : 0;
  const base = {
    samples: scores.length,
    seconds: round(scores.length / fps, 1),
    mean: round(mean(scores), 3),
    peak: round(peak, 3),
  };
  const still = { ...base, shape: "still" as const, dips: [] };
  if (peak < STILL_PEAK) return { ...still, spikes: [] };
  const seconds = (i: number): number => round(i / fps, 1);

  const spikeRuns = findSpikes(scores, fps);
  const spikes = spikeRuns.map((run) => seconds(run.top));

  // A still picture with a flash frame or a missed cut in it is still still.
  const masked = new Set<number>();
  for (const { start, end } of spikeRuns) {
    for (let i = start; i <= end; i++) masked.add(i);
  }
  if (scores.every((s, i) => masked.has(i) || s < STILL_PEAK)) return { ...still, spikes };

  // Thresholds are relative: a still picture and a whip pan differ by a
  // hundredfold, and a "near zero" on one is a peak on the other. The level
  // is the median of the samples that move, so a shot that freezes for most
  // of its length still has its motion to dip below; with under a second of
  // movement there is no level to measure against.
  const moving = scores.filter((s) => s >= STILL_PEAK);
  const level = median(moving);
  const minRun = Math.max(1, Math.round(DIP_MIN_SECONDS * fps));
  const shoulder = (i: number): boolean => i < 0 || i >= scores.length || scores[i] < level * SHOULDER_FRACTION;
  const dipRuns =
    moving.length / fps >= 1
      ? runsBelow(scores, level * DIP_FRACTION).filter(
          ([start, end]) => end - start + 1 >= minRun || (shoulder(start - 1) && shoulder(end + 1))
        )
      : [];

  for (const [start, end] of dipRuns) {
    for (let i = start; i <= end; i++) masked.add(i);
  }
  const rampWindow = Math.max(2, Math.round(RAMP_SECONDS * fps));
  const ramped = ([start, end]: [number, number]): boolean => {
    const before = scores.slice(Math.max(0, start - rampWindow), start);
    const after = scores.slice(end + 1, end + 1 + rampWindow);
    const sloped = (side: number[]): boolean => side.length >= 2 && mean(side) < level * RAMP_FRACTION;
    return sloped(before) || sloped(after);
  };
  const shape =
    spikeRuns.length >= 3
      ? "pulsing"
      : classify(
          scores.filter((_, i) => !masked.has(i)),
          fps
        );

  return {
    ...base,
    shape,
    dips: dipRuns.map((run) => ({ start: seconds(run[0]), end: seconds(run[1] + 1), ramped: ramped(run) })),
    spikes,
  };
}

/** At most `limit` entries, then a count of the rest. */
function name(entries: string[], limit: number): string {
  if (entries.length <= limit) return entries.join(", ");
  return `${entries.slice(0, limit).join(", ")}, +${entries.length - limit} more`;
}

/** The series as `points` evenly spaced bin averages, in percent of the peak. */
function seriesPercent(scores: number[], peak: number, points: number): number[] {
  const bins = Math.min(points, scores.length);
  const out: number[] = [];
  for (let k = 0; k < bins; k++) {
    const from = Math.floor((k * scores.length) / bins);
    const to = Math.floor(((k + 1) * scores.length) / bins);
    out.push(peak > 0 ? Math.round((100 * mean(scores.slice(from, to))) / peak) : 0);
  }
  return out;
}

/**
 * One line for a prompt, never more than sixty words.
 *
 * Dips are always named with their times and whether the motion ramped into
 * them: they are the tell for holds, freezes and ramps through zero, and the
 * ramp is what separates a time remap from a held still. The ending is fixed
 * because the model must not be tempted to read a direction into energy that
 * has none.
 */
export function describeMotion(profile: MotionProfile): string {
  const summary = summarizeMotion(profile);
  const parts = [
    `motion ${round(profile.fps, 1)}/s over ${summary.seconds}s (frame-to-frame change): ` +
      `mean ${summary.mean.toFixed(3)} peak ${summary.peak.toFixed(3)}, shape ${summary.shape}`,
  ];
  if (summary.dips.length) {
    const dips = summary.dips.map(
      (d) => `${d.start === d.end ? `${d.start}s` : `${d.start}-${d.end}s`} ${d.ramped ? "ramped" : "stepped"}`
    );
    parts.push(`dips to near zero at ${name(dips, NAMED_DIPS)}`);
  }
  if (summary.spikes.length) {
    parts.push(`spikes at ${name(summary.spikes.map((t) => `${t}s`), NAMED_SPIKES)}`);
  }
  if (profile.scores.length) {
    const peak = Math.max(...profile.scores);
    parts.push(`series % of peak: ${seriesPercent(profile.scores, peak, SERIES_POINTS).join(" ")}`);
  }
  parts.push("direction of movement not readable");
  return parts.join("; ");
}
