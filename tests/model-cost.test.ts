import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { downscaleForModel, PIPELINE_LIMITS } from "@/lib/pipeline/stages";
import { shotRequestParams } from "@/lib/shot-analysis";
import { shotSystemPrompt } from "@/lib/prompts/shot";
import { MAX_BREAKDOWN_FRAMES, planFrameBudget } from "@/lib/segment-breakdown";
import { probeVideo, runFfmpeg } from "@/lib/video/ffmpeg";

/**
 * What a segment costs to analyse is decided by three numbers — how big the
 * frames are, how many of them go in, and how much of each request repeats —
 * so those are what these assert. The token counts in the comments are from
 * Anthropic's counter against real stored frames, not estimates.
 */

function promptFor(index: number) {
  return shotSystemPrompt({
    frameCount: 3,
    videoTitle: "Title sequence, rough cut",
    shotPosition: { index, total: 7 },
    timecode: `0:0${index * 2}.00 – 0:0${index * 2 + 2}.00`,
    knowledgeBlock: "Depth of field: the distance either side of focus that still reads sharp.",
    focus: "How did they light the close-up?",
  });
}

describe("the per-shot call's cacheable prefix", () => {
  it("keeps everything that repeats across a segment's shots in one block", () => {
    const first = promptFor(0);
    const second = promptFor(1);

    // Byte-identical or the cache misses: this is the whole mechanism.
    expect(second.shared).toBe(first.shared);
    expect(first.shared).toContain("Fill EVERY field");
    expect(first.shared).toContain("How did they light the close-up?");
  });

  it("keeps what changes per shot out of it", () => {
    const first = promptFor(0);
    const second = promptFor(1);

    expect(second.perShot).not.toBe(first.perShot);
    expect(first.perShot).toContain("shot 1 of 7");
    expect(second.perShot).toContain("shot 2 of 7");
    expect(first.shared).not.toContain("shot 1 of 7");
  });

  it("puts the breakpoint on the shared block and nothing after it", () => {
    const params = shotRequestParams(
      promptFor(0),
      [{ buffer: Buffer.from("not-a-real-jpeg"), contentType: "image/jpeg" }],
      "Analyse this shot.",
      true
    );

    const system = params.system as { text: string; cache_control?: unknown }[];
    expect(Array.isArray(system)).toBe(true);
    expect(system).toHaveLength(2);
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].cache_control).toBeUndefined();

    // The frames differ shot to shot, so they must sit after the breakpoint.
    const content = params.messages[0].content as { type: string }[];
    expect(content.map((b) => b.type)).toEqual(["image", "text"]);
  });

  it("writes no cache when the segment is one shot, because nothing reads it", () => {
    const params = shotRequestParams(
      promptFor(0),
      [{ buffer: Buffer.from("not-a-real-jpeg"), contentType: "image/jpeg" }],
      "Analyse this shot.",
      false
    );

    const system = params.system as { cache_control?: unknown }[];
    expect(system[0].cache_control).toBeUndefined();
  });
});

describe("frames the model reads", () => {
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sb-frame-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores at poster resolution and sends a smaller copy", async () => {
    // A stored frame is the shot's poster, so it stays at full width; only the
    // copy in the request shrinks. 1280px is 1200 input tokens, 768px is 452.
    expect(PIPELINE_LIMITS.FRAME_WIDTH).toBe(1280);
    expect(PIPELINE_LIMITS.MODEL_FRAME_WIDTH).toBe(768);

    const stored = join(dir, "stored.jpg");
    await runFfmpeg([
      "-hide_banner",
      "-nostats",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=${PIPELINE_LIMITS.FRAME_WIDTH}x720:duration=1:rate=1`,
      "-frames:v",
      "1",
      "-y",
      stored,
    ]);

    const buffer = await readFile(stored);
    const forModel = await downscaleForModel({ buffer, contentType: "image/jpeg" });
    const sent = join(dir, "sent.jpg");
    await writeFile(sent, forModel.buffer);

    expect((await probeVideo(stored)).width).toBe(PIPELINE_LIMITS.FRAME_WIDTH);
    expect((await probeVideo(sent)).width).toBe(PIPELINE_LIMITS.MODEL_FRAME_WIDTH);
    expect(forModel.buffer.byteLength).toBeLessThan(buffer.byteLength);
  });
});

describe("the breakdown's frame budget", () => {
  it("spends eight frames on a segment, not twelve", () => {
    expect(MAX_BREAKDOWN_FRAMES).toBe(8);
    const sevenShots = planFrameBudget([5, 5, 5, 5, 5, 5, 5]);
    expect(sevenShots.reduce((a, b) => a + b, 0)).toBe(8);
    expect(sevenShots.every((n) => n >= 1)).toBe(true);
  });

  it("still gives a one-shot segment every frame it has", () => {
    // The technique read compares frames inside a shot. Two frames cannot show
    // a ramp, a hold or a reverse, so the few-shot case keeps the whole sample.
    expect(planFrameBudget([5])).toEqual([5]);
    expect(planFrameBudget([5, 5])).toEqual([4, 4]);
  });

  it("gives one frame each when there are more shots than frames", () => {
    const budget = planFrameBudget(Array.from({ length: 20 }, () => 5));
    expect(budget.reduce((a, b) => a + b, 0)).toBe(8);
    expect(budget.every((n) => n <= 1)).toBe(true);
  });
});

/**
 * Who decides to pay for the cache write.
 *
 * shotRequestParams only obeys the flag it is handed; the decision is made one
 * level up, from the segment's shot count, and that is the half a revert would
 * quietly undo. So this drives the real analyzeShotFrames with the SDK stubbed
 * out and reads the flag off the request it built.
 */
describe("who pays for the cache write", () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];

  beforeAll(() => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          // No parsed record comes back, so analyzeShotFrames retries and then
          // gives up. The request it built is what this is here to inspect.
          parse: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
            sent.push(params);
            return { parsed_output: null };
          },
        };
      },
    }));
    vi.doMock("@/lib/knowledge", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/knowledge")>()),
      retrieveKnowledge: async () => [],
    }));
  });

  afterAll(() => {
    vi.doUnmock("@anthropic-ai/sdk");
    vi.doUnmock("@/lib/knowledge");
    vi.resetModules();
  });

  async function requestFor(shotCount: number) {
    vi.resetModules();
    sent.length = 0;
    const { analyzeShotFrames } = await import("@/lib/shot-analysis");
    await analyzeShotFrames({
      images: [{ buffer: Buffer.from("not-a-real-jpeg"), contentType: "image/jpeg" }],
      videoTitle: "Cache decision",
      shotIndex: 0,
      shotCount,
      startSeconds: 0,
      endSeconds: 2,
    }).catch(() => undefined);
    return sent[0];
  }

  it("writes the cache when later shots in the segment will read it", async () => {
    const params = await requestFor(7);
    const system = params.system as { cache_control?: unknown }[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("writes no cache for a one-shot segment", async () => {
    // A write bills at 125% of plain input and a single call has nothing to
    // read it back, so caching there is a guaranteed loss.
    const params = await requestFor(1);
    const system = params.system as { cache_control?: unknown }[];
    expect(system[0].cache_control).toBeUndefined();
  });
});
