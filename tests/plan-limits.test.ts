import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readCode } from "./read-source";

/**
 * The plan is the price, the allowance and the length cap, and the three only
 * make sense together: a segment costs what its shots cost, shots are cuts plus
 * one, and length is the only lever that bounds either. So this suite pins the
 * numbers that were decided, the arithmetic that makes them affordable, and the
 * two places a number can escape — the server check that refuses an over-long
 * range, and the copy that tells a person what their cap is.
 */

const state = vi.hoisted(() => ({
  /** Rows the route asked the admin client to insert, in order. */
  inserts: [] as Record<string, unknown>[],
  /* Hoisted alongside the mocks: a mock factory runs during the import phase,
     so anything it closes over has to exist before the imports below do. */
  userId: "11111111-1111-4111-8111-111111111111",
  videoId: "22222222-2222-4222-8222-222222222222",
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // `after` needs a request scope this test does not have, and all it schedules
  // is the warm-start of the worker, which is explicitly best-effort.
  after: () => undefined,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: state.userId, email_confirmed_at: "2026-01-01T00:00:00Z" } },
      }),
    },
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { plan: "free" }, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        insert: (row: Record<string, unknown>) => {
          state.inserts.push(row);
          return chain;
        },
        // The duplicate lookup; nothing seeded, so every submit is a new one.
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: { id: state.videoId }, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: async () => null,
  enforceIpRateLimit: async () => null,
}));

vi.mock("@/lib/capacity", () => ({
  atDailyCapacity: async () => false,
  atCapacityResponse: () => new Response("at capacity", { status: 503 }),
}));

vi.mock("@/lib/videos", () => ({
  monthlyVideoUsage: async () => ({ used: 0, limit: 3, remaining: 3 }),
}));

vi.mock("@/lib/pipeline/queue", () => ({ enqueueJob: async () => undefined }));
vi.mock("@/lib/analytics", () => ({ trackAsync: () => undefined }));

import { POST } from "@/app/api/videos/route";
import {
  PLANS,
  PRO_PRICE_USD_MONTHLY,
  SEGMENT_LENGTH_TOLERANCE_SECONDS,
  formatDurationLimit,
} from "@/lib/plans";
import { clampEdge } from "@/components/segment-trimmer";
import { SHOT_DETECTION, segmentShots } from "@/lib/video/shots";

const FREE_CAP = PLANS.free.maxVideoSeconds;

async function submitRange(start: number, end: number) {
  state.inserts.length = 0;
  const res = await POST(
    new Request("https://shotbreakdown.app/api/videos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filePath: `${state.userId}/clip.mp4`,
        sourceType: "video_upload",
        title: "clip",
        segmentStart: start,
        segmentEnd: end,
      }),
    })
  );
  const body = (await res.json()) as { videoId?: string; error?: string };
  return { status: res.status, body, inserts: state.inserts.slice() };
}

describe("the plan that was decided", () => {
  it("is $15 a month for 72 segments, and 15 seconds on both plans", () => {
    expect(PRO_PRICE_USD_MONTHLY).toBe(15);
    expect(PLANS.pro.videosPerMonth).toBe(72);
    expect(PLANS.free.videosPerMonth).toBe(3);
    expect(PLANS.pro.maxVideoSeconds).toBe(15);
    expect(PLANS.free.maxVideoSeconds).toBe(15);
  });

  it("keeps the shot cap above anything a legal segment can produce", () => {
    expect(PLANS.free.maxShotsPerVideo).toBe(20);
    expect(PLANS.pro.maxShotsPerVideo).toBe(20);

    // Not arithmetic on paper: the real detector, asked to cut on every frame
    // of the longest segment the server will admit. Its floor on shot length is
    // what decides how many shots that can possibly be. A shot cap at or below
    // this number would be reached by an ordinary fast-cut segment, and
    // detectShots truncates at it without raising anything — the user would get
    // a breakdown missing the end of the segment they chose, and no error.
    for (const [id, plan] of Object.entries(PLANS)) {
      const longest = plan.maxVideoSeconds + SEGMENT_LENGTH_TOLERANCE_SECONDS;
      const everyFrame: number[] = [];
      for (let frame = 1; frame / 60 < longest; frame += 1) everyFrame.push(frame / 60);
      const shots = segmentShots(everyFrame, longest, { maxShots: 10_000 });

      expect(shots.length, `${id}: detection ceiling`).toBeGreaterThan(
        Math.floor(longest / SHOT_DETECTION.minShotSeconds) - 2
      );
      expect(shots.length, `${id}: shot cap must not bind`).toBeLessThan(plan.maxShotsPerVideo);
    }
  });
});

describe("the server refuses an over-long segment", () => {
  it("accepts a range exactly at the cap", async () => {
    const { status, body, inserts } = await submitRange(0, FREE_CAP);
    expect(status).toBe(200);
    expect(body.videoId).toBe(state.videoId);
    expect(inserts[0]).toMatchObject({ segment_start: 0, segment_end: FREE_CAP });
  });

  it("accepts a range inside the tolerance, wherever it sits in the file", async () => {
    const atTolerance = await submitRange(0, FREE_CAP + SEGMENT_LENGTH_TOLERANCE_SECONDS);
    expect(atTolerance.status).toBe(200);

    // The check is on the length, not on the out point.
    const offset = await submitRange(90, 90 + FREE_CAP);
    expect(offset.status).toBe(200);
    expect(offset.inserts[0]).toMatchObject({ segment_start: 90, segment_end: 90 + FREE_CAP });
  });

  it("refuses a range past the tolerance, and creates nothing", async () => {
    const justOver = await submitRange(0, FREE_CAP + SEGMENT_LENGTH_TOLERANCE_SECONDS + 0.1);
    expect(justOver.status).toBe(400);
    expect(justOver.inserts).toEqual([]);

    const sixteen = await submitRange(0, 16);
    expect(sixteen.status).toBe(400);
    expect(sixteen.inserts).toEqual([]);

    // The cap this replaced. A client still sending the old one is refused.
    const oldProCap = await submitRange(0, 180);
    expect(oldProCap.status).toBe(400);
    expect(oldProCap.inserts).toEqual([]);
  });

  it("says the length to a tenth, and the cap in the words the pages use", async () => {
    const { body } = await submitRange(0, 15.6);
    expect(body.error).toBe(
      `That segment is 15.6 seconds. Segments are limited to ${formatDurationLimit(FREE_CAP)} on your plan.`
    );
    expect(body.error).toContain("15 seconds");
  });

  it("still refuses an inverted range", async () => {
    const { status, inserts } = await submitRange(12, 4);
    expect(status).toBe(400);
    expect(inserts).toEqual([]);
  });
});

describe("the trimmer's handles cannot leave the cap", () => {
  const duration = 120;
  const move = (which: "in" | "out", to: number, value: { start: number; end: number }) =>
    clampEdge(which, to, value, duration, FREE_CAP);

  it("never proposes a range the server would refuse", () => {
    // Every gesture the scrubber can make, from every kind of starting
    // selection, against the same rule app/api/videos/route.ts applies.
    for (const value of [
      { start: 0, end: FREE_CAP },
      { start: 20, end: 30 },
      { start: 100, end: 110 },
      { start: 0, end: 1 },
      { start: 119, end: 120 },
    ]) {
      for (const to of [-40, 0, 0.4, 7, 62, 74, 119.6, 120, 999]) {
        for (const which of ["in", "out"] as const) {
          const next = move(which, to, value);
          const label = `${which} -> ${to} from ${value.start}-${value.end}`;
          expect(next.end - next.start, label).toBeLessThanOrEqual(FREE_CAP);
          expect(next.end - next.start, label).toBeGreaterThan(0);
          expect(next.start, label).toBeGreaterThanOrEqual(0);
          expect(next.end, label).toBeLessThanOrEqual(duration);
        }
      }
    }
  });

  it("slides the selection rather than walling the handle", () => {
    // The gesture this exists for: a hook a minute into a long source. Walling
    // the handle at start + cap made this take ten alternating drags, because
    // each one could only gain the cap's width on the edge that was not stuck.
    let range = { start: 0, end: FREE_CAP };
    range = move("out", 74, range);
    expect(range).toEqual({ start: 74 - FREE_CAP, end: 74 });
    range = move("in", 62, range);
    expect(range).toEqual({ start: 62, end: 74 });
  });

  it("moves one edge on its own while the selection is under the cap", () => {
    expect(move("out", 8, { start: 2, end: 4 })).toEqual({ start: 2, end: 8 });
    expect(move("in", 3, { start: 0, end: 10 })).toEqual({ start: 3, end: 10 });
  });

  it("keeps the other rules it always had", () => {
    // Never outside the file, never shorter than a second of selection.
    expect(move("out", 999, { start: 118, end: 119 })).toEqual({ start: 118, end: duration });
    expect(move("in", 9.9, { start: 0, end: 10 })).toEqual({ start: 9, end: 10 });
  });
});

/**
 * Every file that could render a limit to a person. Walked rather than listed,
 * because the point is that a *new* surface cannot reintroduce the bug either.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("no surface can print '0 minutes' again", () => {
  it("is what the old arithmetic would do at this cap", () => {
    for (const [id, plan] of Object.entries(PLANS)) {
      // The bug, reproduced: app/upgrade/page.tsx and app/settings/page.tsx
      // both rendered this next to the word "minutes".
      expect(Math.round(plan.maxVideoSeconds / 60), id).toBe(0);
      expect(formatDurationLimit(plan.maxVideoSeconds), id).toMatch(/^\d+ seconds$/);
      expect(formatDurationLimit(plan.maxVideoSeconds), id).not.toMatch(/^0\b/);
    }
  });

  it("is not divided by 60 anywhere a person can see it", () => {
    const offenders = [...sourceFiles("app"), ...sourceFiles("components")].filter((file) =>
      /(maxVideoSeconds|maxSeconds)\s*\/\s*60/.test(readCode(file))
    );
    expect(offenders).toEqual([]);
  });

  it("is rendered through formatDurationLimit on every page that states it", () => {
    for (const file of [
      "app/upgrade/page.tsx",
      "app/settings/page.tsx",
      "app/upload/page.tsx",
      "components/upload-form.tsx",
      "components/segment-trimmer.tsx",
    ]) {
      expect(readCode(file), file).toContain("formatDurationLimit");
    }
  });

  it("reads the cap from the plan rather than spelling it out", () => {
    // A hardcoded "15 seconds" survives the next price change and starts lying.
    const cap = String(PLANS.free.maxVideoSeconds);
    for (const file of ["app/upgrade/page.tsx", "app/settings/page.tsx", "app/upload/page.tsx"]) {
      expect(readCode(file), file).not.toMatch(new RegExp(`${cap}\\s*(seconds|second|s\\b)`));
    }
  });
});

/** Proves the walk above actually reached files, not an empty directory. */
it("scans the real source tree", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components")];
  expect(files.length).toBeGreaterThan(30);
  expect(files).toContain("app/upgrade/page.tsx");
});
