import { describe, expect, it } from "vitest";
import { segmentShots, SHOT_DETECTION } from "@/lib/video/shots";
import { aspectRatioLabel } from "@/lib/video/ffmpeg";
import { formatTimecode, formatDuration } from "@/lib/shot-format";
import { canonicalColor, canonicalColors, normalizeShotRecord, ShotRecordSchema } from "@/lib/validation";
import { shotEmbeddingText } from "@/lib/embeddings";

describe("segmentShots", () => {
  it("turns cut points into contiguous shots covering the whole duration", () => {
    const shots = segmentShots([3, 6, 9, 12], 15);
    expect(shots).toHaveLength(5);
    expect(shots[0].startSeconds).toBe(0);
    expect(shots[4].endSeconds).toBe(15);
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].startSeconds).toBe(shots[i - 1].endSeconds);
    }
  });

  it("produces one shot when nothing cuts", () => {
    const shots = segmentShots([], 10);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ startSeconds: 0, endSeconds: 10 });
  });

  it("merges runs shorter than the minimum — flash frames are not shots", () => {
    const shots = segmentShots([0.2, 0.4, 0.6, 5], 10);
    expect(shots.every((s) => s.durationSeconds >= SHOT_DETECTION.minShotSeconds)).toBe(true);
  });

  it("splits a very long held take so it still yields usable references", () => {
    const shots = segmentShots([], 95, { maxShotSeconds: 30 });
    expect(shots.length).toBe(4);
    expect(shots.every((s) => s.durationSeconds <= 30.001)).toBe(true);
  });

  it("never exceeds the shot cap", () => {
    const cuts = Array.from({ length: 500 }, (_, i) => (i + 1) * 1.5);
    const shots = segmentShots(cuts, 800, { maxShots: 20 });
    expect(shots.length).toBeLessThanOrEqual(20);
  });

  it("returns nothing for a zero-length input", () => {
    expect(segmentShots([1, 2], 0)).toEqual([]);
  });

  it("ignores cut points outside the duration", () => {
    const shots = segmentShots([-5, 3, 99], 10);
    expect(shots.every((s) => s.startSeconds >= 0 && s.endSeconds <= 10)).toBe(true);
  });
});

describe("aspectRatioLabel", () => {
  it.each([
    [1920, 1080, "16:9"],
    [1080, 1920, "9:16"],
    [1440, 1080, "4:3"],
    [1080, 1080, "1:1"],
    [2048, 858, "2.39:1"],
    [0, 0, ""],
  ])("%ix%i -> %s", (w, h, expected) => {
    expect(aspectRatioLabel(w, h)).toBe(expected);
  });
});

describe("timecodes", () => {
  it.each([
    [0, "0:00"],
    [61, "1:01"],
    [3661, "1:01:01"],
  ])("formatTimecode(%i) === %s", (seconds, expected) => {
    expect(formatTimecode(seconds)).toBe(expected);
  });

  it("formats sub-minute durations readably", () => {
    expect(formatDuration(0.4)).toBe("<1s");
    expect(formatDuration(3.25)).toBe("3.3s");
    expect(formatDuration(90)).toBe("1:30");
  });
});

describe("canonical colours", () => {
  it.each([
    ["deep-teal", "teal"],
    ["warm-amber", "amber"],
    ["near-black", "black"],
    ["pale-skin", "beige"],
    ["burnt-orange", "orange"],
    ["charcoal", "grey"],
    ["cobalt", "blue"],
    ["nonsense", null],
  ])("canonicalColor(%s) === %s", (input, expected) => {
    expect(canonicalColor(input)).toBe(expected);
  });

  it("dedupes and caps the family list", () => {
    expect(canonicalColors(["deep-black", "jet", "ebony", "warm-amber"])).toEqual(["black", "amber"]);
    expect(canonicalColors(Array.from({ length: 20 }, (_, i) => `x${i}`))).toEqual([]);
  });
});

function sampleRecord() {
  return {
    composition: {
      shot_size: "close-up" as const,
      camera_angle: "eye-level" as const,
      camera_height: "eye" as const,
      framing: "centred, symmetrical, subject on the vertical centre line",
      depth: "single shallow plane, background dissolved to bokeh",
    },
    optics: {
      lens_type: "telephoto" as const,
      focal_length_range: "85-105mm",
      depth_of_field: "shallow" as const,
      character: "flattened perspective, no distortion, smooth round bokeh",
    },
    lighting_facets: {
      quality: "soft" as const,
      key_level: "low-key" as const,
      key_direction: "side" as const,
      source: "artificial" as const,
      contrast: "high" as const,
      color_temperature: "warm" as const,
      backlight: true,
      rim_light: false,
      silhouette: false,
      practicals_visible: true,
    },
    color_facets: {
      palette: "warm amber against cool shadow",
      dominant_colors: ["Deep Amber", "near black", "cool grey"],
      hex_colors: ["#c9932f", "NOTHEX", "#8b8b95"],
      saturation: "muted" as const,
      contrast: "high" as const,
      temperature: "warm" as const,
    },
    environment: {
      interior_exterior: "interior" as const,
      location_type: "recording studio",
      time_of_day: "night" as const,
      weather: "none",
      descriptors: ["Studio Booth", "moody"],
    },
    subject: { types: ["person" as const], count: "one", description: "A singer at a mic." },
    movement_facets: { type: "push-in" as const, direction: "forward" as const, speed: "slow" as const },
    mood: ["intimate" as const, "melancholic" as const],
    focal_length_mm_est: 90,
    aperture_est: "f/1.8",
    sensor_format_guess: "full-frame",
    rig_guess: "dolly" as const,
    lighting_notes: "Single soft key from camera right.",
    color_notes: "Warm grade, crushed blacks.",
    ai_tools: "none",
    description: "  A singer lit by a single soft key.  ",
    why_it_works: "  The single source carves the face.  ",
    one_line_summary: "Intimate low-key studio close-up.",
    tags: ["Low Key", "close up", ""],
  };
}

describe("normalizeShotRecord", () => {
  it("normalises tags, colours and descriptors", () => {
    const out = normalizeShotRecord(sampleRecord());
    expect(out.tags).toEqual(["low-key", "close-up"]);
    expect(out.color_facets.dominant_colors).toEqual(["amber", "black", "grey"]);
    expect(out.color_facets.hex_colors).toEqual(["#c9932f", "#8b8b95"]);
    expect(out.environment.descriptors).toEqual(["studio-booth", "moody"]);
    expect(out.description).toBe("A singer lit by a single soft key.");
  });

  it("keeps the model's descriptive colour names for display", () => {
    const out = normalizeShotRecord(sampleRecord());
    expect(out.color_facets.color_names).toEqual(["deep-amber", "near-black", "cool-grey"]);
  });

  it("still validates against the schema after normalisation", () => {
    expect(ShotRecordSchema.safeParse(normalizeShotRecord(sampleRecord())).success).toBe(true);
  });

  it("drops unknown moods instead of failing the record", () => {
    const out = normalizeShotRecord({
      ...sampleRecord(),
      mood: ["intimate", "dark", "tense", "moody"],
    });
    expect(out.mood).toEqual(["intimate", "tense"]);
  });

  it("falls back to cinematic when every mood is invalid", () => {
    const out = normalizeShotRecord({ ...sampleRecord(), mood: ["dark", "moody"] });
    expect(out.mood).toEqual(["cinematic"]);
  });
});

describe("shotEmbeddingText", () => {
  it("leads with the description and includes every facet family", () => {
    const text = shotEmbeddingText(normalizeShotRecord(sampleRecord()));
    expect(text.startsWith("A singer lit by a single soft key.")).toBe(true);
    for (const fragment of [
      "close-up",
      "push-in camera move",
      "low-key key",
      "side key direction",
      "backlight",
      "recording studio",
      "night",
      "intimate",
      "shallow depth of field",
    ]) {
      expect(text).toContain(fragment);
    }
  });

  it("survives a legacy record with no facets", () => {
    const text = shotEmbeddingText({
      one_line_summary: "Old breakdown",
      tags: ["static"],
      lighting: { key: "soft window" },
      color: { look: "warm" },
      lens: "35mm",
    });
    expect(text).toContain("Old breakdown");
    expect(text).toContain("soft window");
  });
});

describe("structured-output grammar budget", () => {
  /**
   * Anthropic rejects an output schema whose compiled grammar is too large, and
   * the failure only surfaces when a real video is analysed — every shot fails
   * with a 400. Measured against the live API: 5941 bytes was rejected, 5746
   * accepted. The schema is held at ~5590 to keep room for a few more facets.
   *
   * Byte count is a proxy for grammar complexity, not the thing itself, so the
   * ceiling is deliberately below the observed failure point.
   */
  it("stays inside the grammar budget with headroom", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const size = JSON.stringify(zodOutputFormat(ShotRecordSchema)).length;
    expect(size).toBeLessThan(5800);
  });

  it("does not ask the model for fields normalisation derives", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const json = JSON.stringify(zodOutputFormat(ShotRecordSchema));
    expect(json).not.toContain("color_names");
  });

  it("has no array length constraints, which blow up the grammar", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const json = JSON.stringify(zodOutputFormat(ShotRecordSchema));
    expect(json).not.toContain("maxItems");
    expect(json).not.toContain("minItems");
  });
});

describe("recreation guide schema", () => {
  it("stays well under the grammar budget", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const { RecreationGuideSchema } = await import("@/lib/validation");
    const size = JSON.stringify(zodOutputFormat(RecreationGuideSchema)).length;
    expect(size).toBeLessThan(2500);
  });

  it("hasRecreationGuide is true only when steps exist", async () => {
    const { hasRecreationGuide } = await import("@/lib/validation");
    expect(hasRecreationGuide(null)).toBe(false);
    expect(hasRecreationGuide({ recreation_steps: [] })).toBe(false);
    expect(hasRecreationGuide({ recreation_steps: ["Lock off on sticks."] })).toBe(true);
  });
});
