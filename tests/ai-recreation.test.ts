import { describe, expect, it } from "vitest";
import { normalizeAiRecreation } from "@/lib/ai-recreation";
import {
  AI_FEASIBILITY,
  AI_RECREATION_VERSION,
  AiRecreationSchema,
  StoredAiRecreationSchema,
  type AiRecreation,
  type StoredAiRecreation,
} from "@/lib/validation";

/** A schema-valid model response. Fields a test does not care about are empty. */
function sampleRecreation(overrides: Partial<AiRecreation> = {}): AiRecreation {
  return {
    feasibility: "achievable",
    verdict: "Current image-to-video models hold the smear for about two seconds.",
    approach: "Image-to-video from a stills plate, so the street geometry stays put.",
    tools: [{ name: "Runway Gen-3", role: "Drives the motion pass off the plate." }],
    prompts: [{ target: "Shot 0 base plate", text: "empty city crossing at midday, long exposure" }],
    workflow: ["Shoot or generate a clean plate.", "Drive motion from the plate."],
    settings: ["Motion strength low; the camera must stay locked."],
    hard_parts: ["Faces smear into mush at this exposure."],
    cleanup: ["Rotoscope the foreground back to sharp."],
    ...overrides,
  };
}

/** The same document once stored on videos.ai_recreation. */
function storedRecreation(overrides: Partial<StoredAiRecreation> = {}): StoredAiRecreation {
  return {
    ...sampleRecreation(),
    version: AI_RECREATION_VERSION,
    prompt_version: "ai-recreation-v1",
    generated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ai recreation grammar budget", () => {
  /**
   * Anthropic rejects an output schema whose compiled grammar is too large, and
   * the failure only surfaces on a real call — here, after the reader has
   * already pressed the button and is waiting. The observed failure point is
   * around 5.9k, so this ceiling sits far below it, leaving room to add a field
   * to the recreation without a surprise in production.
   *
   * Byte count is a proxy for grammar complexity, not the thing itself, which
   * is why the ceiling is nowhere near the measured limit.
   */
  it("stays inside the grammar budget with headroom", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const size = JSON.stringify(zodOutputFormat(AiRecreationSchema)).length;
    expect(size).toBeLessThan(2500);
  });

  it("has no array length constraints, which blow up the grammar", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const json = JSON.stringify(zodOutputFormat(AiRecreationSchema));
    expect(json).not.toContain("maxItems");
    expect(json).not.toContain("minItems");
  });
});

describe("StoredAiRecreationSchema", () => {
  it("rejects anything that is not a stored recreation", () => {
    expect(StoredAiRecreationSchema.safeParse(null).success).toBe(false);
    expect(StoredAiRecreationSchema.safeParse({}).success).toBe(false);
    // The envelope without the document: a half-written row.
    expect(
      StoredAiRecreationSchema.safeParse({
        version: AI_RECREATION_VERSION,
        prompt_version: "ai-recreation-v1",
        generated_at: "2026-01-01T00:00:00.000Z",
      }).success
    ).toBe(false);
  });

  it("rejects a document that is missing a required field", () => {
    const missing: Record<string, unknown> = { ...storedRecreation() };
    delete missing.workflow;
    expect(StoredAiRecreationSchema.safeParse(missing).success).toBe(false);

    // The document without the storage envelope — what the model itself returns.
    expect(StoredAiRecreationSchema.safeParse(sampleRecreation()).success).toBe(false);
  });

  it("accepts a complete document", () => {
    const stored = storedRecreation();
    const parsed = StoredAiRecreationSchema.safeParse(stored);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(stored);
  });

  it("accepts a document whose lists are all empty", () => {
    const bare = storedRecreation({
      tools: [],
      prompts: [],
      workflow: [],
      settings: [],
      hard_parts: [],
      cleanup: [],
    });
    expect(StoredAiRecreationSchema.safeParse(bare).success).toBe(true);
  });
});

describe("feasibility", () => {
  it.each(AI_FEASIBILITY)("accepts %s", (value) => {
    expect(AiRecreationSchema.safeParse(sampleRecreation({ feasibility: value })).success).toBe(
      true
    );
  });

  it("rejects a verdict word the UI has no label for", () => {
    for (const value of ["easy", "impossible", "Achievable", "", null]) {
      const parsed = AiRecreationSchema.safeParse({
        ...sampleRecreation(),
        feasibility: value,
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe("normalizeAiRecreation", () => {
  /*
   * The list-marker stripper once ate the leading digits of any decimal or
   * ratio, so "3.5 CFG scale" was stored as "5 CFG scale". It lands hardest on
   * `settings`, whose entire job is carrying model values, and it is silent:
   * the raw string is never kept, so nothing downstream can notice.
   */
  it("keeps decimals, ratios and durations intact", () => {
    const settings = [
      "3.5 CFG scale, 24 sampling steps",
      "16:9 aspect, 1080p",
      "0.04s decay per echo",
      "1.25 motion strength",
      "7.5 guidance scale",
    ];
    const out = normalizeAiRecreation(sampleRecreation({ settings }));
    expect(out.settings).toEqual(settings);
  });

  it("still strips genuine list markers", () => {
    const out = normalizeAiRecreation(
      sampleRecreation({
        workflow: ["1. Generate the plate.", "Step 3: set the seed", "2) Lock the seed across shots"],
      })
    );
    expect(out.workflow).toEqual([
      "Generate the plate.",
      "set the seed",
      "Lock the seed across shots",
    ]);
  });

  /*
   * A tool named with no stated role in this pipeline, or a prompt with a
   * target and nothing to paste, is the padding the prompt forbids. Rendering
   * either would put a row on the page that answers nothing.
   */
  it("drops empty tools and prompts", () => {
    const out = normalizeAiRecreation(
      sampleRecreation({
        tools: [
          { name: "Runway Gen-3", role: "Drives the motion pass off the plate." },
          { name: "Some Model", role: "   " },
          { name: "", role: "Upscales the finished pass." },
        ],
        prompts: [
          { target: "Shot 0 base plate", text: "empty city crossing at midday" },
          { target: "Shot 1", text: "   " },
        ],
      })
    );

    expect(out.tools).toEqual([
      { name: "Runway Gen-3", role: "Drives the motion pass off the plate." },
    ]);
    expect(out.prompts).toEqual([
      { target: "Shot 0 base plate", text: "empty city crossing at midday" },
    ]);
  });

  it("trims the text it keeps", () => {
    const out = normalizeAiRecreation(
      sampleRecreation({
        verdict: "   Close, but the crowd smears.   ",
        approach: "\n  Image-to-video from a plate.\n",
        tools: [{ name: "  Runway Gen-3  ", role: "  Motion pass.  " }],
        prompts: [{ target: "  Shot 0  ", text: "  long exposure crossing  " }],
        workflow: ["  1. Generate the plate.  ", "  Generate the plate.  "],
        cleanup: ["   "],
      })
    );

    expect(out.verdict).toBe("Close, but the crowd smears.");
    expect(out.approach).toBe("Image-to-video from a plate.");
    expect(out.tools).toEqual([{ name: "Runway Gen-3", role: "Motion pass." }]);
    expect(out.prompts).toEqual([{ target: "Shot 0", text: "long exposure crossing" }]);
    // The list cleaner strips a numbered prefix and dedupes what is left, so
    // the same step written twice lands once.
    expect(out.workflow).toEqual(["Generate the plate."]);
    expect(out.cleanup).toEqual([]);
  });

  it("still parses against the schema after normalizing", () => {
    const out = normalizeAiRecreation(sampleRecreation());
    expect(AiRecreationSchema.safeParse(out).success).toBe(true);
  });
});
