import { describe, expect, it } from "vitest";
import {
  MAX_BREAKDOWN_FRAMES,
  SEGMENT_PROMPT_VERSION,
  selectFrameIndices,
} from "@/lib/segment-breakdown";
import { formatDurationLimit } from "@/lib/plans";
import {
  DEPARTMENTS,
  SEGMENT_BREAKDOWN_VERSION,
  SegmentBreakdownSchema,
  StoredSegmentBreakdownSchema,
  TechniqueSchema,
  normalizeSegmentBreakdown,
  normalizeTechnique,
  readSegmentBreakdown,
  type SegmentBreakdown,
  type StoredSegmentBreakdown,
  type Technique,
  type TechniqueRoute,
} from "@/lib/validation";

/** A complete route: three real steps, which is the least the prompt accepts. */
function sampleRoute(overrides: Partial<TechniqueRoute> = {}): TechniqueRoute {
  return {
    name: "In post: time remap with frame blending",
    when: "You have normal-speed footage and a subject who held still.",
    steps: [
      "Speed/Duration 600%, Time Interpolation: Frame Blending (Resolve free: Retime, Frame Blend).",
      "Freeze one clean frame of the subject and mask it over the blended plate.",
      "Grade the smear to match the sharp plate before adding grain.",
    ],
    gives_up: "",
    ...overrides,
  };
}

function sampleTechnique(overrides: Partial<Technique> = {}): Technique {
  return {
    name: "Time remap: normal-speed footage sped up 6x with frame blending; subject holds still.",
    evidence:
      "The traffic smear is stepped and ghosted, which a 1/24s shutter cannot make; the man is sharp only because he held still.",
    routes: [sampleRoute()],
    ...overrides,
  };
}

/** A schema-valid model response. Fields the test does not care about are empty. */
function sampleBreakdown(overrides: Partial<SegmentBreakdown> = {}): SegmentBreakdown {
  return {
    title: "Night arrival",
    what_happens: "A car pulls up outside a lit house on a suburban street at night.",
    focus_answer: "",
    technique: sampleTechnique(),
    shot_sequence: [],
    departments: [],
    difficulty: "moderate",
    crew: "2: operator, one performer.",
    kit: {
      minimum: "A phone on a tripod; loses the smooth push-in.",
      full: "Mirrorless body, 35mm prime, slider, one bounce.",
    },
    ...overrides,
  };
}

/** The same document once stored on videos.breakdown. */
function storedBreakdown(overrides: Partial<StoredSegmentBreakdown> = {}): StoredSegmentBreakdown {
  return {
    ...sampleBreakdown(),
    version: SEGMENT_BREAKDOWN_VERSION,
    prompt_version: SEGMENT_PROMPT_VERSION,
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

/** "w0 w1 w2 …": a text of exactly `count` words, each one identifiable. */
function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `w${i}`).join(" ");
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
   * is why the ceiling sits far below the observed failure point. It came down
   * from 4500 with v3, which retired half the fields: a schema that quietly
   * grew back to its old size should be caught here, not in production.
   */
  it("stays inside the grammar budget with headroom", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const size = JSON.stringify(zodOutputFormat(SegmentBreakdownSchema)).length;
    expect(size).toBeLessThan(3500);
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
          { role: "color", headline: "Cool the exteriors.", steps: [], pitfalls: [] },
          { role: "camera", headline: "One body, two primes.", steps: [], pitfalls: [] },
          { role: "sound", headline: "Wild the street tone.", steps: [], pitfalls: [] },
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
            steps: ["Set the 35mm on sticks [a phone on a tripod also works]."],
            pitfalls: ["Do not hand-hold the push-in."],
          },
        ],
      }),
      shotInputs(1)
    );

    const camera = out.departments.find((d) => d.role === "camera");
    expect(camera).toMatchObject({
      headline: "One body, two primes.",
      steps: ["Set the 35mm on sticks [a phone on a tripod also works]."],
      pitfalls: ["Do not hand-hold the push-in."],
    });
  });

  it("fills a missing department with an empty brief that still says something", () => {
    const out = normalizeSegmentBreakdown(sampleBreakdown({ departments: [] }), shotInputs(1));

    for (const brief of out.departments) {
      expect(brief.headline.trim().length).toBeGreaterThan(0);
      expect(brief.steps).toEqual([]);
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
            steps: [
              "Step 3: Block the walk to the door.",
              "3. Call action on the headlights.",
              "3) Hold after the door shuts.",
            ],
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
            steps: [
              "Cut on the door close.",
              "1. Cut on the door close.",
              "CUT ON THE DOOR CLOSE.",
              "Hold the tail two seconds.",
            ],
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

describe("normalizeSegmentBreakdown word ceilings", () => {
  /*
   * The prompt asks for these ceilings; the normalizer guarantees them. The
   * renderer lays the page out on that guarantee, so a model that ignores the
   * prompt must not be able to push a paragraph into the read or a step into
   * the department accordion that runs past the ceiling.
   */
  /*
   * The prompt asks for 60 and 40; the normalizer cuts at 90 and 60. The gap is
   * deliberate: a step that runs a clause over the ask still carries its
   * values, and a cut in the middle of them would lose exactly what the reader
   * came for. The ceiling exists for a model that ignored the ask entirely.
   */
  it("clamps what_happens to 90 words with a trailing ellipsis", () => {
    const out = normalizeSegmentBreakdown(
      sampleBreakdown({ what_happens: words(140) }),
      shotInputs(1)
    );

    expect(out.what_happens.split(" ")).toHaveLength(90);
    expect(out.what_happens.startsWith("w0 w1 w2")).toBe(true);
    expect(out.what_happens.endsWith("…")).toBe(true);
    expect(out.what_happens).not.toContain("w90");
  });

  it("clamps a department step to 60 words", () => {
    const out = normalizeSegmentBreakdown(
      sampleBreakdown({
        departments: [
          { role: "camera", headline: "One setup.", steps: [words(100)], pitfalls: [] },
        ],
      }),
      shotInputs(1)
    );

    const step = out.departments.find((d) => d.role === "camera")?.steps[0] ?? "";
    expect(step.split(" ")).toHaveLength(60);
    expect(step.endsWith("…")).toBe(true);
    expect(step).not.toContain("w60");
  });

  it("cuts at the last sentence end rather than mid-clause when one falls in the back half", () => {
    // 50 words, a full stop after word 44, then 5 more words past the ceiling.
    const sentence = `${words(45).replace(/w44$/, "w44.")} ${words(55).split(" ").slice(45).join(" ")}`;
    const out = normalizeSegmentBreakdown(
      sampleBreakdown({
        departments: [
          { role: "camera", headline: "One setup.", steps: [`${sentence} ${words(20)}`], pitfalls: [] },
        ],
      }),
      shotInputs(1)
    );
    const step = out.departments.find((d) => d.role === "camera")?.steps[0] ?? "";
    expect(step.endsWith("w44.")).toBe(true);
    expect(step.endsWith("…")).toBe(false);
  });

  it("leaves text under the ceiling untouched, with no ellipsis", () => {
    const out = normalizeSegmentBreakdown(sampleBreakdown(), shotInputs(1));
    expect(out.what_happens).toBe(sampleBreakdown().what_happens);
    expect(out.what_happens.endsWith("…")).toBe(false);
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

describe("normalizeTechnique", () => {
  const route = (name: string, steps: string[]): TechniqueRoute => ({
    name,
    when: "",
    steps,
    gives_up: "",
  });

  it("fills a safe empty shape from undefined", () => {
    for (const raw of [undefined, null] as const) {
      expect(normalizeTechnique(raw)).toEqual({ name: "", evidence: "", routes: [] });
    }
  });

  it("returns empty fields rather than throwing on a half-built object", () => {
    const half = { name: "Well shot, no trick." } as unknown as Technique;
    expect(normalizeTechnique(half)).toEqual({
      name: "Well shot, no trick.",
      evidence: "",
      routes: [],
    });
  });

  /*
   * A route is a complete recipe or it is nothing: a name with no steps under
   * it would render as a heading the reader cannot follow. The cap is three
   * because the page shows the first route open and the rest as disclosures,
   * and a fourth route to the same look has never been anything but padding.
   * Order is kept because the route actually used comes first by contract.
   */
  it("drops a route with no steps, keeps a route with steps, caps at 3 routes", () => {
    const out = normalizeTechnique(
      sampleTechnique({
        routes: [
          route("In post: frame blending", ["Retime to 600%.", "Frame Blending on.", "Render."]),
          route("In camera: long exposure stills", []),
          route("In camera: nothing written", ["   ", ""]),
          route("Hybrid: stills plate over blended video", ["Shoot stills.", "Blend the video.", "Comp."]),
          route("In camera: ND and a slow shutter", ["Fit a 10-stop ND.", "Shoot at 1/4s.", "Hold still."]),
          route("In post: echo", ["Add Echo.", "Six echoes.", "Decay to taste."]),
        ],
      })
    );

    expect(out.routes.map((r) => r.name)).toEqual([
      "In post: frame blending",
      "Hybrid: stills plate over blended video",
      "In camera: ND and a slow shutter",
    ]);
    expect(out.routes.every((r) => r.steps.length > 0)).toBe(true);
  });

  it("clamps a 200-word evidence to 110 words with a trailing ellipsis", () => {
    const out = normalizeTechnique(sampleTechnique({ evidence: words(200) }));

    expect(out.evidence.split(" ")).toHaveLength(110);
    expect(out.evidence.startsWith("w0 w1 w2")).toBe(true);
    expect(out.evidence.endsWith("…")).toBe(true);
    expect(out.evidence).not.toContain("w110");

    // Exactly at the ceiling nothing is cut, so nothing is marked as cut.
    const exact = normalizeTechnique(sampleTechnique({ evidence: words(110) })).evidence;
    expect(exact.split(" ")).toHaveLength(110);
    expect(exact.endsWith("…")).toBe(false);
  });

  it("strips list markers and dedupes route steps like department steps", () => {
    const out = normalizeTechnique(
      sampleTechnique({
        routes: [
          route("In post: frame blending", [
            "1. Retime to 600%.",
            "Step 2: Frame Blending on.",
            "2) frame blending ON.",
            "3) Render.",
          ]),
        ],
      })
    );

    expect(out.routes[0].steps).toEqual(["Retime to 600%.", "Frame Blending on.", "Render."]);
  });

  /*
   * A route step is where the real values live — the prompt refuses "apply
   * frame blending" and asks for "Speed/Duration 600%". A step that opens with
   * a value must keep it: "1.25x speed" stored as "25x speed" is a different
   * recipe, and nothing on the page says the number was touched.
   */
  it("keeps a step that opens with a decimal, ratio or duration intact", () => {
    const steps = [
      "1.25x speed with Frame Blending, not Optical Flow.",
      "16:9 crop before the retime so the blend has no black edge.",
      "0.04s decay per echo, six echoes.",
    ];
    const out = normalizeTechnique(sampleTechnique({ routes: [route("In post: echo", steps)] }));
    expect(out.routes[0].steps).toEqual(steps);
  });
});

describe("normalizeSegmentBreakdown technique", () => {
  it("carries a complete technique through unchanged", () => {
    const out = normalizeSegmentBreakdown(sampleBreakdown(), shotInputs(1));
    expect(out.technique).toEqual(sampleTechnique());
  });

  it("runs the technique through normalizeTechnique", () => {
    const out = normalizeSegmentBreakdown(
      sampleBreakdown({
        technique: sampleTechnique({
          routes: [
            sampleRoute(),
            { name: "In camera: no steps written", when: "", steps: [], gives_up: "" },
          ],
        }),
      }),
      shotInputs(1)
    );
    expect(out.technique.routes).toHaveLength(1);
    expect(out.technique.routes[0].name).toBe(sampleRoute().name);
  });

  it("gives the renderer a technique object even when the model returned a bare one", () => {
    const raw = {
      ...sampleBreakdown(),
      technique: { name: "Well shot, no trick." },
    } as unknown as SegmentBreakdown;
    const out = normalizeSegmentBreakdown(raw, shotInputs(1));
    expect(out.technique).toEqual({ name: "Well shot, no trick.", evidence: "", routes: [] });
  });
});

describe("readSegmentBreakdown", () => {
  it("returns null for anything that is not a stored breakdown", () => {
    expect(readSegmentBreakdown(null)).toBeNull();
    expect(readSegmentBreakdown(undefined)).toBeNull();
    expect(readSegmentBreakdown({})).toBeNull();
    // A breakdown shape with the storage envelope missing.
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

  /*
   * BACKWARD COMPATIBILITY. Every breakdown written before the technique spine
   * (segment-v1 and segment-v2; still present in real databases) sits in
   * videos.breakdown carrying setting, approach, shot_list, prep_checklist,
   * budget_tiers, common_mistakes and minimum_crew — v2 also post_production —
   * and NO technique, crew or kit. The stored schema keeps each retired key
   * optional and makes technique, crew and kit optional as well, for exactly
   * this row.
   *
   * Were technique required on StoredSegmentBreakdownSchema, safeParse would
   * fail on the missing key, readSegmentBreakdown would return null, and the
   * owner would open a finished segment to an empty page. This test would fail
   * at the not-null assertion below. The generation schema still demands the
   * field, so this is a read-side allowance, not a loosening of what the model
   * may return; the last two assertions prove the optional override is the
   * only thing keeping the row readable.
   */
  it("still returns a document for a stored row carrying the old keys and no technique", () => {
    const legacy: Record<string, unknown> = {
      version: SEGMENT_BREAKDOWN_VERSION,
      prompt_version: "segment-v2",
      focus: "how do they do this effect",
      generated_at: "2026-01-01T00:00:00.000Z",
      title: "Paulista median, still man in moving traffic",
      what_happens: "A man stands still on a bike-lane median while traffic smears past.",
      setting: "Avenida Paulista, midday, hard sun.",
      approach: "One locked-off wide, a single take long enough to build the smear.",
      focus_answer: "A long exposure, with the subject holding still.",
      shot_sequence: [
        {
          shot_index: 0,
          timecode: "0:00-0:07",
          what_happens: "He stands; the traffic streaks.",
          how_it_was_made: "MFS, eye level, static, ~28mm.",
          cut_note: "",
        },
      ],
      departments: DEPARTMENTS.map((role) => ({
        role,
        headline: `${role} headline.`,
        steps: role === "camera" ? ["Lock off on sticks."] : [],
        pitfalls: [],
      })),
      shot_list: ["0 / MFS / eye level / static / ~28mm"],
      prep_checklist: ["Tripod.", "10-stop ND."],
      minimum_crew: "2",
      difficulty: "easy",
      budget_tiers: { under_500_usd: ["Phone on a tripod."], under_5000_usd: [], full_production: [] },
      common_mistakes: ["Letting the subject shift during the exposure."],
      post_production: {
        key_technique: "Frame blending",
        in_camera_or_post: "Post.",
        pipeline: [],
        alternatives: [],
        pitfalls: [],
      },
    };
    for (const key of ["technique", "crew", "kit"]) expect(key in legacy).toBe(false);

    const read = readSegmentBreakdown(legacy);
    expect(read).not.toBeNull();
    expect(read?.title).toBe("Paulista median, still man in moving traffic");
    expect(read?.departments).toHaveLength(DEPARTMENTS.length);
    expect(read?.shot_sequence).toHaveLength(1);
    expect(read?.technique).toBeUndefined();
    expect(read?.crew).toBeUndefined();
    expect(read?.kit).toBeUndefined();

    // The generation schema, where technique is required, rejects the same object...
    expect(SegmentBreakdownSchema.safeParse(legacy).success).toBe(false);
    // ...and so does the stored schema the moment technique is made required on it.
    const strict = StoredSegmentBreakdownSchema.extend({ technique: TechniqueSchema });
    expect(strict.safeParse(legacy).success).toBe(false);
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
