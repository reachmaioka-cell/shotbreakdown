import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ffmpegPath, measureMotion } from "@/lib/video/ffmpeg";
import {
  compactMotion,
  describeMotion,
  motionSampleRate,
  sliceMotion,
  summarizeMotion,
  type MotionProfile,
} from "@/lib/video/motion";

const FPS = 12;

/** A series with a little deterministic jitter so a flat run still looks like footage. */
function series(seconds: number, level: (t: number) => number): MotionProfile {
  const scores: number[] = [];
  for (let i = 0; i < seconds * FPS; i++) {
    const jitter = 1 + 0.06 * Math.sin(i * 1.7);
    scores.push(Number((level(i / FPS) * jitter).toFixed(4)));
  }
  return { fps: FPS, scores };
}

describe("summarizeMotion shapes", () => {
  it("calls a picture that never changes still", () => {
    const summary = summarizeMotion(series(5, () => 0.001));
    expect(summary.shape).toBe("still");
    expect(summary.dips).toEqual([]);
    expect(summary.spikes).toEqual([]);
  });

  it("calls a locked-off level steady", () => {
    expect(summarizeMotion(series(6, () => 0.02)).shape).toBe("steady");
  });

  it("reads a speed ramp up as rising and a ramp down as falling", () => {
    expect(summarizeMotion(series(6, (t) => 0.005 + 0.006 * t)).shape).toBe("rising");
    expect(summarizeMotion(series(6, (t) => 0.041 - 0.006 * t)).shape).toBe("falling");
  });

  it("reads a ramp through a peak and a ramp through a trough", () => {
    expect(summarizeMotion(series(6, (t) => 0.005 + 0.03 * Math.sin((Math.PI * t) / 6))).shape).toBe(
      "rise-then-fall"
    );
    expect(summarizeMotion(series(6, (t) => 0.035 - 0.03 * Math.sin((Math.PI * t) / 6))).shape).toBe(
      "fall-then-rise"
    );
  });

  it("calls three or more spikes pulsing and lists their times", () => {
    const profile = series(6, () => 0.02);
    for (const i of [12, 36, 60]) profile.scores[i] = 0.5;
    const summary = summarizeMotion(profile);
    expect(summary.shape).toBe("pulsing");
    expect(summary.spikes).toEqual([1, 3, 5]);
  });

  it("reads a whip pan as one spike at its peak, not as pulsing or a trend", () => {
    const profile = series(6, (t) => (t >= 2 && t < 2.5 ? 0.3 : 0.02));
    profile.scores[27] = 0.34;
    const summary = summarizeMotion(profile);
    expect(summary.spikes).toEqual([2.3]);
    expect(summary.shape).toBe("steady");
  });

  it("keeps a still picture still when a flash frame lands in it", () => {
    const profile = series(6, () => 0.002);
    profile.scores[30] = 0.1;
    const summary = summarizeMotion(profile);
    expect(summary.shape).toBe("still");
    expect(summary.spikes).toEqual([2.5]);
    expect(summary.dips).toEqual([]);
  });

  it("calls a level that wanders without a trend mixed", () => {
    const profile = series(8, (t) => 0.02 + 0.015 * Math.sin(t * 4));
    expect(summarizeMotion(profile).shape).toBe("mixed");
  });

  it("rounds the mean and peak to three decimals", () => {
    const summary = summarizeMotion(series(4, () => 0.0123456));
    expect(summary.mean).toBe(0.012);
    expect(summary.peak).toBe(0.013);
    expect(summary.samples).toBe(48);
    expect(summary.seconds).toBe(4);
  });
});

describe("summarizeMotion dips", () => {
  it("finds exactly one dip, at the right times, when the picture stops mid-shot", () => {
    const profile = series(6, () => 0.02);
    // 2.5s to 3.0s: six samples at a tenth of the level.
    for (let i = 30; i < 36; i++) profile.scores[i] = 0.002;
    const summary = summarizeMotion(profile);
    expect(summary.dips).toEqual([{ start: 2.5, end: 3, ramped: false }]);
    expect(summary.shape).toBe("steady");
  });

  it("ignores a single low sample between ordinary ones but keeps a run of about 0.2s", () => {
    const profile = series(6, () => 0.02);
    // A repeated frame from a rate conversion: one zero, full motion either side.
    profile.scores[12] = 0.001;
    profile.scores[48] = 0.001;
    profile.scores[49] = 0.001;
    expect(summarizeMotion(profile).dips).toEqual([{ start: 4, end: 4.2, ramped: false }]);
  });

  it("keeps a one-sample hold at the bottom of a V: a speed ramp passing through zero", () => {
    const profile = series(6, () => 0.02);
    // Slowing into the hold and out of it, as a ramp through zero does at the source rate.
    [0.016, 0.012, 0.007].forEach((v, i) => (profile.scores[33 + i] = v));
    profile.scores[36] = 0.003;
    [0.007, 0.012, 0.016].forEach((v, i) => (profile.scores[37 + i] = v));
    expect(summarizeMotion(profile).dips).toEqual([{ start: 3, end: 3.1, ramped: true }]);
    expect(describeMotion(profile)).toContain("dips to near zero at 3-3.1s ramped;");
  });

  it("tells a ramp through zero from a held frame by the slope either side", () => {
    // A time remap slows into the hold and out of it over a third of a second.
    const remap = series(6, () => 0.02);
    const slope = [0.016, 0.012, 0.009, 0.006, 0.004, 0.002];
    slope.forEach((v, i) => (remap.scores[30 + i] = v));
    remap.scores[36] = 0.001;
    [...slope].reverse().forEach((v, i) => (remap.scores[37 + i] = v));
    const ramped = summarizeMotion(remap).dips;
    expect(ramped).toHaveLength(1);
    expect(ramped[0].ramped).toBe(true);
    expect(describeMotion(remap)).toMatch(/dips to near zero at [0-9.-]+s ramped;/);

    // A still held on the timeline: full motion, nothing, full motion.
    const held = series(6, () => 0.02);
    for (let i = 33; i < 39; i++) held.scores[i] = 0.001;
    const stepped = summarizeMotion(held).dips;
    expect(stepped).toEqual([{ start: 2.8, end: 3.3, ramped: false }]);
    expect(describeMotion(held)).toContain("2.8-3.3s stepped;");
  });

  it("measures a dip against the profile's own level, not an absolute floor", () => {
    const whipPan = series(6, () => 0.3);
    for (let i = 24; i < 30; i++) whipPan.scores[i] = 0.05;
    expect(summarizeMotion(whipPan).dips).toEqual([{ start: 2, end: 2.5, ramped: false }]);
  });

  it("reports no dips when the profile has no level to dip below", () => {
    const profile = series(6, () => 0.003);
    profile.scores[10] = 0.01;
    expect(summarizeMotion(profile).dips).toEqual([]);
  });

  it("names the freeze when a shot freezes for most of its length", () => {
    const profile = series(7, (t) => (t < 2 ? 0.02 : 0.0005));
    const summary = summarizeMotion(profile);
    expect(summary.dips).toEqual([{ start: 2, end: 7, ramped: false }]);
    expect(summary.shape).toBe("steady");
  });

  it("does not let a dip in the middle of a steady shot read as fall-then-rise", () => {
    const profile = series(8, () => 0.02);
    for (let i = 42; i < 54; i++) profile.scores[i] = 0.001;
    expect(summarizeMotion(profile).shape).toBe("steady");
  });
});

describe("sliceMotion", () => {
  const whole: MotionProfile = { fps: FPS, scores: Array.from({ length: 179 }, (_, i) => i / 1000) };

  it("starts a shot on the sample at its start time", () => {
    const shot = sliceMotion(whole, 3.25, 6);
    expect(shot.fps).toBe(FPS);
    expect(shot.scores[0]).toBe(39 / 1000);
  });

  it("leaves the cut sample out of the shot before it", () => {
    // The cut at 6.0s is sample 71, the change from frame 71 to frame 72.
    const shot = sliceMotion(whole, 0, 6);
    expect(shot.scores).toHaveLength(71);
    expect(shot.scores[shot.scores.length - 1]).toBe(70 / 1000);
    const next = sliceMotion(whole, 6, 9);
    expect(next.scores[0]).toBe(72 / 1000);
  });

  it("drops as many samples before an interior cut as the rate ratio says", () => {
    // Motion at 24/s, cuts found at 12/s: the cut sits on either of two samples.
    const fast: MotionProfile = { fps: 24, scores: Array.from({ length: 358 }, (_, i) => i / 1000) };
    const shot = sliceMotion(fast, 0, 6, 2);
    expect(shot.scores).toHaveLength(142);
    expect(shot.scores[shot.scores.length - 1]).toBe(141 / 1000);
    expect(sliceMotion(fast, 6, 9, 2).scores[0]).toBe(144 / 1000);
    // The last shot keeps everything regardless of the margin.
    expect(sliceMotion(fast, 12, 15, 2).scores[sliceMotion(fast, 12, 15, 2).scores.length - 1]).toBe(357 / 1000);
  });

  it("lets the last shot reach the last sample", () => {
    const shot = sliceMotion(whole, 12, 15);
    expect(shot.scores[shot.scores.length - 1]).toBe(178 / 1000);
    expect(shot.scores).toHaveLength(35);
  });

  it("yields one sample for a shot shorter than one sample", () => {
    expect(sliceMotion(whole, 2, 2.02).scores).toEqual([24 / 1000]);
    expect(sliceMotion(whole, 14.99, 15).scores).toHaveLength(1);
  });

  it("keeps the fps of the series", () => {
    expect(sliceMotion({ fps: 6, scores: [0.1, 0.2, 0.3, 0.4] }, 0, 1).fps).toBe(6);
  });
});

describe("compactMotion", () => {
  it("leaves a short profile alone", () => {
    const profile = series(5, () => 0.02);
    expect(compactMotion(profile)).toBe(profile);
  });

  it("bin-averages to at most the requested samples and recomputes the rate", () => {
    const profile: MotionProfile = { fps: FPS, scores: Array.from({ length: 500 }, (_, i) => i / 10000) };
    const compact = compactMotion(profile, 240);
    expect(compact.scores.length).toBeLessThanOrEqual(240);
    expect(compact.scores).toHaveLength(167);
    expect(compact.fps).toBe(4);
    expect(compact.scores[0]).toBe(0.0001);
    expect(compact.scores[1]).toBe(0.0004);
  });

  it("uses a default that keeps thirty seconds at 24/s whole", () => {
    const halfMinute: MotionProfile = { fps: 24, scores: Array.from({ length: 720 }, () => 0.02) };
    expect(compactMotion(halfMinute)).toBe(halfMinute);
    const profile: MotionProfile = { fps: 24, scores: Array.from({ length: 2000 }, () => 0.02) };
    const compact = compactMotion(profile);
    expect(compact.scores).toHaveLength(667);
    expect(compact.fps).toBe(8);
  });
});

describe("describeMotion", () => {
  const words = (line: string) => line.trim().split(/\s+/).length;
  const seriesPoints = (line: string) => line.match(/series % of peak: ([0-9 ]+)/)?.[1].split(" ") ?? [];

  it("prints one line with twelve series points and the fixed ending", () => {
    const line = describeMotion(series(7, (t) => 0.005 + 0.006 * t));
    expect(line).not.toContain("\n");
    expect(line.startsWith("motion 12/s over 7s (frame-to-frame change): mean ")).toBe(true);
    expect(line).toContain("shape rising");
    expect(seriesPoints(line)).toHaveLength(12);
    expect(line.endsWith("; direction of movement not readable")).toBe(true);
    expect(words(line)).toBeLessThanOrEqual(60);
  });

  it("names the dips with their times", () => {
    const profile = series(6, () => 0.02);
    for (let i = 30; i < 36; i++) profile.scores[i] = 0.002;
    const line = describeMotion(profile);
    expect(line).toContain("dips to near zero at 2.5-3s stepped;");
    expect(words(line)).toBeLessThanOrEqual(60);
  });

  it("stays under sixty words with many dips and spikes", () => {
    const profile = series(40, () => 0.02);
    for (let start = 12; start < 480; start += 36) {
      profile.scores[start] = 0.002;
      profile.scores[start + 1] = 0.002;
      profile.scores[start + 2] = 0.002;
    }
    for (let i = 24; i < 480; i += 48) profile.scores[i] = 0.5;
    const line = describeMotion(profile);
    expect(line).toContain("+");
    expect(line).toContain("spikes at");
    expect(seriesPoints(line)).toHaveLength(12);
    expect(words(line)).toBeLessThanOrEqual(60);
  });

  it("describes a still and an empty profile without error", () => {
    expect(describeMotion(series(3, () => 0.001))).toContain("shape still");
    const empty = describeMotion({ fps: FPS, scores: [] });
    expect(empty).toContain("over 0s");
    expect(empty.endsWith("direction of movement not readable")).toBe(true);
  });
});

const REFERENCE_CLIP =
  "/private/tmp/claude-501/-Users-kendowling-shotbreakdown/82f8a9fe-f772-4ab4-ab69-820fd8cd77a0/scratchpad/kenframes/segment.mp4";

describe.skipIf(!existsSync(ffmpegPath()) || !existsSync(REFERENCE_CLIP))("measureMotion on the reference clip", () => {
  it("returns a 12/s profile with a hold where the ramp turns around", async () => {
    const profile = await measureMotion(REFERENCE_CLIP);
    expect(profile.fps).toBe(12);
    expect(profile.scores.length).toBeGreaterThanOrEqual(80);
    expect(profile.scores.length).toBeLessThanOrEqual(96);
    expect(profile.scores.every((s) => s >= 0 && s <= 1)).toBe(true);
    const summary = summarizeMotion(profile);
    expect(summary.mean).toBeGreaterThan(0.015);
    expect(summary.mean).toBeLessThan(0.03);
    // The bundled ffmpeg keeps the other frame parity from a current build, so
    // the shorter holds near 3.0s and 4.75s fall between its 12/s samples;
    // the longest one, at 6.3-6.5s, is seen either way.
    expect(summary.dips.some((d) => d.start >= 6.2 && d.end <= 6.7)).toBe(true);
    const line = describeMotion(profile);
    expect(line).toContain("dips to near zero at");
    expect(line.trim().split(/\s+/).length).toBeLessThanOrEqual(60);
  }, 60_000);

  it("at the source rate sees every hold where a speed ramp turns around", async () => {
    // The clip is a long-shutter time-lapse take, speed-ramped and rewound in
    // post; the ramps pass through zero at about 3.0s, 4.75s and 6.4s.
    const profile = await measureMotion(REFERENCE_CLIP, { fps: motionSampleRate(24) });
    expect(profile.fps).toBe(24);
    expect(profile.scores.length).toBeGreaterThanOrEqual(170);
    const { dips } = summarizeMotion(profile);
    const near = (t: number) => dips.find((d) => d.start - 0.3 <= t && t <= d.end + 0.3);
    // Each turnaround is a ramp through zero, not a held frame.
    for (const t of [3.0, 4.75, 6.4]) {
      expect(near(t)).toBeDefined();
      expect(near(t)?.ramped).toBe(true);
    }
  }, 60_000);
});
