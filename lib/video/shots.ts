import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectSceneChanges,
  extractFrameAt,
  extractRepresentativeFrame,
  frameStats,
  measureMotion,
  SCENE_SAMPLE_FPS,
  probeVideo,
  type ProbeResult,
} from "@/lib/video/ffmpeg";
import { compactMotion, motionSampleRate, sliceMotion, type MotionProfile } from "@/lib/video/motion";

export type DetectedShot = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  /** Scene-change score at this shot's opening cut. 1 for the first shot. */
  cutScore: number;
  /** Frame-to-frame change across the shot, at most 240 samples: the ramps and holds stills cannot show. */
  motion: MotionProfile;
};

/** A shot's span, before its motion is attached. */
export type ShotRange = Omit<DetectedShot, "motion">;

export type ShotDetectionConfig = {
  threshold: number;
  minShotSeconds: number;
  maxShotSeconds: number;
  maxShots: number;
};

export const SHOT_DETECTION: ShotDetectionConfig = {
  /** ffmpeg scene score above which a frame is treated as a cut. */
  threshold: 0.3,
  /** Shorter runs are merged into the neighbouring shot — they are flashes, not shots. */
  minShotSeconds: 0.8,
  /** A held shot longer than this is split, so a locked-off take still yields usable references. */
  maxShotSeconds: 30,
  /** Hard ceiling per video, so one long upload cannot consume an unbounded analysis budget. */
  maxShots: 120,
};

/**
 * Turn cut points into shot ranges.
 *
 * Very short runs are absorbed into the previous shot (whip-pans and flash
 * frames produce spurious cuts), and very long runs are subdivided so a
 * ten-minute locked-off take still produces usable references.
 */
export function segmentShots(
  cutTimes: number[],
  durationSeconds: number,
  options: Partial<ShotDetectionConfig> = {}
): ShotRange[] {
  const cfg = { ...SHOT_DETECTION, ...options };
  if (durationSeconds <= 0) return [];

  const scoreByTime = new Map<number, number>();
  const boundaries = [0];
  for (const t of cutTimes) {
    if (t > 0.05 && t < durationSeconds - 0.05) boundaries.push(t);
  }
  boundaries.push(durationSeconds);
  boundaries.sort((a, b) => a - b);

  // Merge boundaries that would create a sub-minimum run.
  const merged: number[] = [boundaries[0]];
  for (let i = 1; i < boundaries.length - 1; i++) {
    if (boundaries[i] - merged[merged.length - 1] >= cfg.minShotSeconds) {
      merged.push(boundaries[i]);
    }
  }
  const last = boundaries[boundaries.length - 1];
  if (last - merged[merged.length - 1] < cfg.minShotSeconds && merged.length > 1) {
    merged.pop();
  }
  merged.push(last);

  const shots: ShotRange[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const start = merged[i];
    const end = merged[i + 1];
    const span = end - start;
    const segments = Math.max(1, Math.ceil(span / cfg.maxShotSeconds));
    const step = span / segments;
    for (let s = 0; s < segments; s++) {
      shots.push({
        index: shots.length,
        startSeconds: Number((start + s * step).toFixed(3)),
        endSeconds: Number((start + (s + 1) * step).toFixed(3)),
        durationSeconds: Number(step.toFixed(3)),
        cutScore: s === 0 ? (scoreByTime.get(start) ?? (i === 0 ? 1 : 0.5)) : 0,
      });
      if (shots.length >= cfg.maxShots) return shots;
    }
  }

  return shots;
}

export type DetectionOutcome = {
  probe: ProbeResult;
  shots: DetectedShot[];
  /** Frame-to-frame change across the whole segment, uncompacted. */
  motion: MotionProfile;
  truncated: boolean;
};

export async function detectShots(
  file: string,
  options: Partial<ShotDetectionConfig> = {}
): Promise<DetectionOutcome> {
  const cfg = { ...SHOT_DETECTION, ...options };
  const probe = await probeVideo(file);
  if (!probe.hasVideoStream) throw new Error("This file has no video stream");
  if (probe.durationSeconds <= 0) throw new Error("Could not read the video duration");

  const changes = await detectSceneChanges(file, { threshold: cfg.threshold });
  // A second pass, at the source rate: the scene score cannot describe motion
  // inside a shot, and a hold where a speed ramp passes through zero is often
  // one to three frames long, which a 12/s sample lands on only by luck. Cut
  // detection keeps its own pass and does not change under this one.
  const motion = await measureMotion(file, { fps: motionSampleRate(probe.fps) });
  const margin = Math.ceil(motion.fps / SCENE_SAMPLE_FPS);
  const scores = new Map(changes.map((c) => [c.timeSeconds, c.score]));
  const ranges = segmentShots(
    changes.map((c) => c.timeSeconds),
    probe.durationSeconds,
    cfg
  );

  const shots = ranges.map((range) => ({
    ...range,
    cutScore: scores.get(range.startSeconds) || range.cutScore,
    motion: compactMotion(sliceMotion(motion, range.startSeconds, range.endSeconds, margin)),
  }));

  return { probe, shots, motion, truncated: shots.length >= cfg.maxShots };
}

export type CandidateFrame = {
  timestampSeconds: number;
  buffer: Buffer;
  bytes: number;
  score: number;
  isRepresentative: boolean;
};

/**
 * Score a candidate frame for use as the shot's representative image.
 *
 * - Detail: JPEG size at fixed quality tracks how much real detail the frame
 *   holds, so blurred and motion-smeared frames score low.
 * - Exposure: frames that are nearly black or blown out are poor references.
 * - Tonal range: a wide luma spread means the frame reads, not a flat wash.
 */
function scoreFrame(bytes: number, meanLuma: number, spread: number, maxBytes: number): number {
  const detail = maxBytes > 0 ? bytes / maxBytes : 0;
  const exposure = 1 - Math.min(1, Math.abs(meanLuma - 118) / 118);
  const range = Math.min(1, spread / 160);
  return Number((detail * 0.5 + exposure * 0.3 + range * 0.2).toFixed(4));
}

export type ShotFramesResult = {
  frames: CandidateFrame[];
  representativeIndex: number;
};

/**
 * Extract candidate frames for one shot and choose the strongest.
 *
 * ffmpeg's own `thumbnail` filter proposes the most representative frame by
 * histogram distance; that proposal competes with evenly-spaced candidates on
 * the score above, and the winner becomes the representative. Every candidate
 * is kept so the user can override the choice by scrubbing.
 */
export async function extractShotFrames(
  file: string,
  shot: { startSeconds: number; endSeconds: number },
  options: { candidates?: number; width?: number } = {}
): Promise<ShotFramesResult> {
  const candidateCount = Math.max(2, options.candidates ?? 5);
  const width = options.width ?? 1280;
  const duration = Math.max(0.05, shot.endSeconds - shot.startSeconds);

  const dir = await mkdtemp(join(tmpdir(), "sb-shot-"));
  try {
    const timestamps: number[] = [];
    for (let i = 0; i < candidateCount; i++) {
      const fraction = (i + 1) / (candidateCount + 1);
      timestamps.push(Number((shot.startSeconds + duration * fraction).toFixed(3)));
    }

    const collected: { time: number; path: string }[] = [];

    const thumbPath = join(dir, "thumb.jpg");
    try {
      await extractRepresentativeFrame(file, shot.startSeconds, duration, thumbPath, { width });
      await stat(thumbPath);
      collected.push({ time: Number((shot.startSeconds + duration / 2).toFixed(3)), path: thumbPath });
    } catch {
      // The thumbnail filter can fail on very short shots; the evenly spaced
      // candidates below still give us something to choose from.
    }

    for (let i = 0; i < timestamps.length; i++) {
      const out = join(dir, `c${i}.jpg`);
      try {
        await extractFrameAt(file, timestamps[i], out, { width });
        await stat(out);
        collected.push({ time: timestamps[i], path: out });
      } catch {
        // A single unreadable timestamp must not fail the shot.
      }
    }

    if (collected.length === 0) throw new Error("Could not extract any frame from this shot");

    const raw = await Promise.all(
      collected.map(async (c) => {
        const buffer = await readFile(c.path);
        const stats = await frameStats(c.path).catch(() => ({ meanLuma: 118, stdevLuma: 128 }));
        return { ...c, buffer, stats };
      })
    );

    const maxBytes = Math.max(...raw.map((r) => r.buffer.byteLength));
    const scored = raw.map((r) => ({
      timestampSeconds: r.time,
      buffer: r.buffer,
      bytes: r.buffer.byteLength,
      score: scoreFrame(r.buffer.byteLength, r.stats.meanLuma, r.stats.stdevLuma, maxBytes),
      isRepresentative: false,
    }));

    // ffmpeg's own pick (index 0 when present) gets a small edge on ties.
    if (collected[0].path.endsWith("thumb.jpg")) scored[0].score += 0.05;

    let best = 0;
    for (let i = 1; i < scored.length; i++) {
      if (scored[i].score > scored[best].score) best = i;
    }
    scored[best].isRepresentative = true;

    scored.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    const representativeIndex = scored.findIndex((s) => s.isRepresentative);

    return { frames: scored, representativeIndex };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
