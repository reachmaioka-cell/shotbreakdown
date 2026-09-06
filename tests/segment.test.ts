import { describe, expect, it } from "vitest";
import { MAX_BREAKDOWN_FRAMES, selectFrameIndices } from "@/lib/segment-breakdown";
import { formatDurationLimit } from "@/lib/plans";
import {
  DEPARTMENTS,
  SEGMENT_BREAKDOWN_VERSION,
  SegmentBreakdownSchema,
  normalizeSegmentBreakdown,
  readSegmentBreakdown,
  type SegmentBreakdown,
  type StoredSegmentBreakdown,
} from "@/lib/validation";

/** A schema-valid model response. Fields the test does not care about are empty. */
function sampleBreakdown(overrides: Partial<SegmentBreakdown> = {}): SegmentBreakdown {
  return {
    title: "Night arrival",
    what_happens: "A car pulls up outside a lit house.",
    setting: "Suburban street, night.",
    approach: "Two wides and a push-in, all available light.",
    focus_answer: "",
    shot_sequence: [],
    departments: [],
    shot_list: [],
    prep_checklist: [],
    minimum_crew: "Two.",
    difficulty: "moderate",
    budget_tiers: { under_500_usd: [], under_5000_usd: [], full_production: [] },
    common_mistakes: [],
    ...overrides,
  };
}

/** The same document once stored on videos.breakdown. */
function storedBreakdown(overrides: Partial<StoredSegmentBreakdown> = {}): StoredSegmentBreakdown {
  return {
    ...sampleBreakdown(),
    version: SEGMENT_BREAKDOWN_VERSION,
    prompt_version: "segment-v1",
    focus: "How was the push-in done?",
    generated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function shotInputs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    shotIndex: i,
    timecode: `0:0${i}-0:0${i + 1}`,
    summary: `Shot ${i} summary`,
  }));
}

describe("segment breakdown grammar budget", () => {
  /**
   * Anthropic rejects an output schema whose compiled grammar is too large, and
   * the failure only surfaces when a real segment is analysed — the breakdown
   * job fails with a 400 after the frames have already been read and paid for.
   * The shot-record schema was measured against the live API at ~5.7k, so this
   * ceiling is well inside the known-good range, leaving room to add a field or
   * two to a department brief without a surprise in production.
   *
   * Byte count is a proxy for grammar complexity, not the thing itself, which
   * is why the ceiling sits far below the observed failure point.
   */
  it("stays inside the grammar budget with headroom", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const size = JSON.stringify(zodOutputFormat(SegmentBreakdownSchema)).length;
    expect(size).toBeLessThan(4500);
  });

  it("has no array length constraints, which blow up the grammar", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const json = JSON.stringify(zodOutputFormat(SegmentBreakdownSchema));
    expect(json).not.toContain("maxItems");
    expect(json).not.toContain("minItems");
  });
});

describe("normalizeSegmentBreakdown departments", () => {
  it("returns all nine departments in canonical order when the model returns three", () => {
    const out = normalizeSegmentBreakdown(
      sampleBreakdown({
        departments: [
          { role: "color", headline: "Cool the exteriors.", steps: [], gear: [], pitfalls: [] },
          { role: "camera", headline: "One body, two primes.", steps: [], gear: [], pitfalls: [] },
          { role: "sound", headline: "Wild the street tone.", steps: [], gear: [], pitfalls: [] },
        ],
      }),
      shotInputs(2)
    );

    expect(out.departments).toHaveLength(9);
    expect(out.departments.map((d) => d.role)).toEqual([...DEPARTMENTS]);
  });

  it("keeps what the model wrote for the departments it did answer", () => {
    const out = normalizeSegmentBreakdown(
      sampleBreakdown({
        departments: [
          {
            role: "camera",
            headline: "One body, two primes.",
            steps: ["Set the 35mm on sticks."],
            gear: ["Any mirrorless body — a phone on a tripod also works"],
            pitfalls: ["Do not hand-hold the push-in."],
          },
        ],
      }),
      shotInputs(1)
    );

    const camera = out.departments.find((d) => d.role === "camera");
    expect(camera).toMatchObject({
      headline: "One body, two primes.",
      steps: ["Set the 35mm on sticks."],
      pitfalls: ["Do not hand-hold the push-in."],
    });
  });

  it("fills a missing department with an empty brief that still says something", () => {
    const out = normalizeSegmentBreakdown(sampleBreakdown({ departments: [] }), shotInputs(1));

    for (const brief of out.departments) {
      expect(brief.headline.trim().length).toBeGreaterThan(0);
      expect(brief.steps).toEqual([]);
      expect(brief.gear).toEqual([]);
      expect(brief.pitfalls).toEqual([]);
    }
  });

  it("strips a numbered prefix from steps", () => {
    const out = normalizeSegmentBreakdown(
      sampleBreakdown({
        departments: [
          {
            role: "director",
            headline: "Play the arrival in two beats.",
            steps: ["Step 3: Block the walk to the door.", "3. Call action on the headlights.", "3) Hold after the door shuts."],
            gear: [],
            pitfalls: [],
          },
        ],
      }),
      shotInputs(1)
    );

    const director = out.departments.find((d) => d.role === "director");
    expect(director?.steps).toEqual([
      "Block the walk to the door.",
      "Call action on the headlights.",
      "Hold after the door shuts.",
    ]);
  });

  it("dedupes repeated steps", () => {
    const out = normalizeSegmentBreakdown(
      sampleBreakdown({
        departments: [
          {
            role: "editorial",
            headline: "Cut on the door.",
            steps: ["Cut on the door close.", "1. Cut on the door close.", "CUT ON THE DOOR CLOSE.", "Hold the tail two seconds."],
            gear: [],
            pitfalls: [],
          },
        ],
      }),
      shotInputs(1)
    );

    const editorial = out.departments.find((d) => d.role === "editorial");
    expect(editorial?.steps).toEqual(["Cut on the door close.", "Hold the tail two seconds."]);
  });
});

describe("normalizeSegmentBreakdown shot sequence", () => {
  const entry = (shotIndex: number, what: string) => ({
    shot_index: shotIndex,
    timecode: "9:99-9:99",
    what_happens: what,
    how_it_was_made: "Locked off.",
    cut_note: "",
  });

  it("returns exactly one entry per real shot, in shot_index order", () => {
    const out = normalizeSegmentBreakdown(
      sampleBreakdown({
        shot_sequence: [
          entry(2, "Third"),
          entry(0, "First"),
          entry(0, "First again"),
          // A shot number the segment does not contain: the model miscounted.
          entry(7, "Does not exist"),
        ],
      }),
      shotInputs(3)
    );

    expect(out.shot_sequence).toHaveLength(3);
    expect(out.shot_sequence.map((s) => s.shot_index)).toEqual([0, 1, 2]);
    expect(out.shot_sequence.map((s) => s.what_happens)).toEqual([
      "First again",
      "Shot 1 summary",
      "Third",
    ]);
  });

  it("falls back to the real timecode for a shot the model skipped", () => {
    const out = normalizeSegmentBreakdown(sampleBreakdown({ shot_sequence: [] }), shotInputs(2));
    expect(out.shot_sequence.map((s) => s.timecode)).toEqual(["0:00-0:01", "0:01-0:02"]);
  });
});

describe("readSegmentBreakdown", () => {
  it("returns null for anything that is not a stored breakdown", () => {
    expect(readSegmentBreakdown(null)).toBeNull();
    expect(readSegmentBreakdown(undefined)).toBeNull();
    expect(readSegmentBreakdown({})).toBeNull();
    // A breakdown shape with the storage envelope missing — an older row.
    expect(readSegmentBreakdown(sampleBreakdown())).toBeNull();
    expect(readSegmentBreakdown({ title: "Night arrival", version: 1 })).toBeNull();
  });

  it("returns the document when it is valid", () => {
    const stored = storedBreakdown();
    expect(readSegmentBreakdown(stored)).toEqual(stored);
  });

  it("accepts a breakdown written with no focus", () => {
    const stored = storedBreakdown({ focus: null });
    expect(readSegmentBreakdown(stored)?.focus).toBeNull();
  });
});

describe("selectFrameIndices", () => {
  it("takes every shot when the segment is under the cap", () => {
    expect(selectFrameIndices(7, 12)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("spreads across a long segment, keeping the first and last shot", () => {
    const picked = selectFrameIndices(20, 12);
    expect(picked).toHaveLength(12);
    expect(picked).toContain(0);
    expect(picked).toContain(19);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it("handles the degenerate counts", () => {
    expect(selectFrameIndices(1, 12)).toEqual([0]);
    expect(selectFrameIndices(0, 12)).toEqual([]);
  });

  it("never returns an index outside the segment", () => {
    for (let count = 1; count <= 40; count += 1) {
      const picked = selectFrameIndices(count);
      expect(picked.length).toBe(Math.min(count, MAX_BREAKDOWN_FRAMES));
      for (const index of picked) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(count);
      }
    }
  });
});

describe("formatDurationLimit", () => {
  it.each([
    [60, "60 seconds"],
    [180, "3 minutes"],
    [120, "2 minutes"],
  ])("formatDurationLimit(%i) === %s", (seconds, expected) => {
    expect(formatDurationLimit(seconds)).toBe(expected);
  });
});
