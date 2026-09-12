import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PIPELINE_LIMITS } from "@/lib/pipeline/stages";
import { probeVideo, runFfmpeg } from "@/lib/video/ffmpeg";

/**
 * The saving is in the wiring, not in the helper.
 *
 * downscaleForModel can be correct and still cost full price if the stage that
 * loads frames calls the plain fetcher instead. So this drives the real
 * analyzeOneShot over a stubbed database and storage layer and asserts on the
 * bytes that actually reach the model: stored frame in at 1280, model frame
 * out at 768.
 */

vi.mock("@/lib/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media")>()),
  fetchAnalysisImage: vi.fn(),
}));

vi.mock("@/lib/shot-analysis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shot-analysis")>()),
  analyzeShotFrames: vi.fn(),
}));

vi.mock("@/lib/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/embeddings")>()),
  embed: vi.fn(async () => new Array(1536).fill(0)),
}));

const { fetchAnalysisImage } = await import("@/lib/media");
const { analyzeShotFrames } = await import("@/lib/shot-analysis");
const { analyzeOneShot } = await import("@/lib/pipeline/stages");

/**
 * Just enough Supabase for analyzeOneShot: read frames, sign, write back.
 *
 * The middle frame is the representative one so the stage picks first,
 * representative and last — the three-frame shape a real shot call has.
 */
function stubAdmin(frames: { id: string; storage_path: string }[]) {
  const rows = frames.map((f, i) => ({
    ...f,
    timestamp_seconds: i,
    is_representative: i === Math.min(1, frames.length - 1),
  }));
  const framesQuery = {
    select: () => framesQuery,
    eq: () => framesQuery,
    order: async () => ({ data: rows }),
  };
  const shotsQuery = {
    update: () => shotsQuery,
    eq: async () => ({ error: null }),
  };
  return {
    from: (table: string) => (table === "shot_frames" ? framesQuery : shotsQuery),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/${path}` },
          error: null,
        }),
      }),
    },
  };
}

describe("the frames analyzeOneShot actually sends", () => {
  let dir = "";
  let stored: Buffer;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sb-wiring-"));
    const path = join(dir, "stored.jpg");
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
      path,
    ]);
    stored = await readFile(path);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("downscales every frame on the way into the request", async () => {
    vi.mocked(fetchAnalysisImage).mockResolvedValue({
      buffer: stored,
      contentType: "image/jpeg",
    });
    vi.mocked(analyzeShotFrames).mockResolvedValue({
      one_line_summary: "A test card, held.",
      tags: [],
    } as never);

    await analyzeOneShot(
      stubAdmin([
        { id: "f0", storage_path: "frames/0.jpg" },
        { id: "f1", storage_path: "frames/1.jpg" },
        { id: "f2", storage_path: "frames/2.jpg" },
      ]) as never,
      {
        shotId: "shot-1",
        shotIndex: 0,
        startSeconds: 0,
        endSeconds: 2,
        videoId: "video-1",
        videoTitle: "Wiring check",
        sourceType: "video_upload",
        shotCount: 3,
        preferences: null,
        insights: null,
      }
    );

    const sent = vi.mocked(analyzeShotFrames).mock.calls[0][0].images;
    expect(sent).toHaveLength(3);

    // The stub handed back a full-width frame every time, so any width other
    // than MODEL_FRAME_WIDTH means the downscale was skipped on the way in.
    expect((await probeVideo(join(dir, "stored.jpg"))).width).toBe(PIPELINE_LIMITS.FRAME_WIDTH);
    for (const [i, image] of sent.entries()) {
      const out = join(dir, `sent-${i}.jpg`);
      await writeFile(out, image.buffer);
      expect((await probeVideo(out)).width).toBe(PIPELINE_LIMITS.MODEL_FRAME_WIDTH);
    }
  });
});
