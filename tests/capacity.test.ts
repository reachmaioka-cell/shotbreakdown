import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The site-wide ceiling. Per-account limits bound one account and accounts are
 * free, so this is the only number that bounds the day's bill: every assertion
 * here fails if the cap stops being read, stops being counted, or stops being
 * returned as a refusal the client can act on.
 */

const state = vi.hoisted(() => ({
  /** What the counting query resolves to. */
  result: { count: 0, error: null } as { count: number | null; error: { message: string } | null },
  calls: [] as unknown[][],
}));

vi.mock("@/lib/supabase/admin", () => {
  // A recording builder that is itself awaitable, the way postgrest-js is, so
  // a test can assert on the predicate the caller actually sent.
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.result).then(resolve, reject),
  };
  const record = (name: string) => (...args: unknown[]) => {
    state.calls.push([name, ...args]);
    return chain;
  };
  for (const name of ["select", "gt", "neq", "eq"]) chain[name] = record(name);
  return {
    createAdminClient: () => ({
      from: (table: string) => {
        state.calls.push(["from", table]);
        return chain;
      },
    }),
  };
});

const reported = vi.hoisted(() => ({ calls: [] as { message: string; context: unknown }[] }));

vi.mock("@/lib/errors", () => ({
  reportError: (error: unknown, context: Record<string, unknown>) => {
    reported.calls.push({
      message: error instanceof Error ? error.message : String(error),
      context,
    });
  },
}));

import {
  atCapacityResponse,
  atDailyCapacity,
  dailySegmentCap,
  secondsToUtcMidnight,
  segmentsCreatedToday,
} from "@/lib/capacity";

const previousCap = process.env.DAILY_SEGMENT_CAP;

beforeEach(() => {
  state.result = { count: 0, error: null };
  state.calls = [];
  reported.calls = [];
  delete process.env.DAILY_SEGMENT_CAP;
});

afterEach(() => {
  if (previousCap === undefined) delete process.env.DAILY_SEGMENT_CAP;
  else process.env.DAILY_SEGMENT_CAP = previousCap;
});

describe("dailySegmentCap", () => {
  it("defaults to 150 when the env var is unset", () => {
    expect(dailySegmentCap()).toBe(150);
  });

  it("reads the env var", () => {
    process.env.DAILY_SEGMENT_CAP = "12";
    expect(dailySegmentCap()).toBe(12);
  });

  it("reads it again on the next call, so a preview deploy can run at another cap", () => {
    process.env.DAILY_SEGMENT_CAP = "1";
    expect(dailySegmentCap()).toBe(1);
    process.env.DAILY_SEGMENT_CAP = "2";
    expect(dailySegmentCap()).toBe(2);
  });

  it("takes a cap of 0 literally — the switch that closes new uploads", () => {
    process.env.DAILY_SEGMENT_CAP = "0";
    expect(dailySegmentCap()).toBe(0);
  });

  it.each([["abc"], [""], ["  "], ["-5"], ["NaN"]])(
    "falls back to the default rather than to zero for %o",
    (value) => {
      process.env.DAILY_SEGMENT_CAP = value;
      // A typo in an env var must not silently close the site.
      expect(dailySegmentCap()).toBe(150);
    }
  );

  it("floors a fractional cap", () => {
    process.env.DAILY_SEGMENT_CAP = "7.9";
    expect(dailySegmentCap()).toBe(7);
  });
});

describe("segmentsCreatedToday", () => {
  it("counts videos from the last 24 hours, failures excluded, through the admin client", async () => {
    state.result = { count: 41, error: null };
    const before = Date.now();
    await expect(segmentsCreatedToday()).resolves.toBe(41);

    expect(state.calls[0]).toEqual(["from", "videos"]);
    expect(state.calls[1]).toEqual(["select", "id", { count: "exact", head: true }]);

    const [, column, since] = state.calls[2] as [string, string, string];
    expect(column).toBe("created_at");
    // Rolling, not calendar: the window is always the last 24 hours.
    const windowMs = before - new Date(since).getTime();
    expect(windowMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    expect(windowMs).toBeLessThan(24 * 60 * 60 * 1000 + 5_000);

    expect(state.calls[3]).toEqual(["neq", "status", "failed"]);
  });

  it("reads a null count as zero", async () => {
    state.result = { count: null, error: null };
    await expect(segmentsCreatedToday()).resolves.toBe(0);
  });

  it("throws when the count cannot be read", async () => {
    state.result = { count: null, error: { message: "relation does not exist" } };
    await expect(segmentsCreatedToday()).rejects.toThrow();
  });
});

describe("atDailyCapacity", () => {
  it("is false below the cap", async () => {
    process.env.DAILY_SEGMENT_CAP = "10";
    state.result = { count: 3, error: null };
    await expect(atDailyCapacity()).resolves.toBe(false);
    expect(reported.calls).toHaveLength(0);
  });

  it("is true at the cap", async () => {
    process.env.DAILY_SEGMENT_CAP = "10";
    state.result = { count: 10, error: null };
    await expect(atDailyCapacity()).resolves.toBe(true);
  });

  it("is true past the cap", async () => {
    process.env.DAILY_SEGMENT_CAP = "10";
    state.result = { count: 11, error: null };
    await expect(atDailyCapacity()).resolves.toBe(true);
  });

  it("logs at 80% so the cap can be raised before anyone is turned away", async () => {
    process.env.DAILY_SEGMENT_CAP = "10";
    state.result = { count: 8, error: null };
    await expect(atDailyCapacity()).resolves.toBe(false);
    expect(reported.calls).toHaveLength(1);
    expect(reported.calls[0].message).toBe("Daily segment cap at 80%: 8/10");
  });

  it("does not log at 79%", async () => {
    process.env.DAILY_SEGMENT_CAP = "100";
    state.result = { count: 79, error: null };
    await expect(atDailyCapacity()).resolves.toBe(false);
    expect(reported.calls).toHaveLength(0);
  });

  it("logs at 100% because that is a user being refused", async () => {
    process.env.DAILY_SEGMENT_CAP = "10";
    state.result = { count: 10, error: null };
    await atDailyCapacity();
    expect(reported.calls).toHaveLength(1);
    expect(reported.calls[0].message).toBe("Daily segment cap reached: 10/10");
    expect(reported.calls[0].context).toMatchObject({ used: 10, cap: 10 });
  });

  it("fails open when the count cannot be read, and says so", async () => {
    process.env.DAILY_SEGMENT_CAP = "1";
    state.result = { count: null, error: { message: "counter unavailable" } };
    // Refusing every upload site-wide is worse than running uncapped for as
    // long as the fault lasts; the per-account plan limits still hold.
    await expect(atDailyCapacity()).resolves.toBe(false);
    expect(reported.calls).toHaveLength(1);
    expect(reported.calls[0].context).toMatchObject({ source: "atDailyCapacity" });
  });
});

describe("secondsToUtcMidnight", () => {
  it("is a whole day at the stroke of midnight", () => {
    expect(secondsToUtcMidnight(new Date("2026-09-11T00:00:00.000Z"))).toBe(86_400);
  });

  it("is a minute at one minute to midnight", () => {
    expect(secondsToUtcMidnight(new Date("2026-09-11T23:59:00.000Z"))).toBe(60);
  });

  it("rounds up, so nobody is told to retry into the same refusal", () => {
    expect(secondsToUtcMidnight(new Date("2026-09-11T23:59:59.500Z"))).toBe(1);
  });

  it("is never zero", () => {
    expect(secondsToUtcMidnight(new Date("2026-09-11T23:59:59.999Z"))).toBe(1);
  });

  it("crosses a month boundary", () => {
    expect(secondsToUtcMidnight(new Date("2026-09-30T23:00:00.000Z"))).toBe(3_600);
  });

  it("crosses a year boundary", () => {
    expect(secondsToUtcMidnight(new Date("2026-12-31T22:00:00.000Z"))).toBe(7_200);
  });
});

describe("atCapacityResponse", () => {
  it("is a 503 with the body and the header the upload page is written against", async () => {
    const now = new Date("2026-09-11T23:00:00.000Z");
    const response = atCapacityResponse(now);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("3600");
    await expect(response.json()).resolves.toEqual({
      error: "at_capacity",
      message: "We're at capacity for today. Try again tomorrow.",
      retryAfter: 3_600,
    });
  });

  it("keeps the header and the body on the same number", async () => {
    const response = atCapacityResponse(new Date("2026-09-11T06:30:00.000Z"));
    const body = (await response.json()) as { retryAfter: number };
    expect(response.headers.get("Retry-After")).toBe(String(body.retryAfter));
  });
});

describe("the upload route returns the refusal", () => {
  /*
   * Read from the route file: the ceiling is only a ceiling if the one route
   * that starts a segment consults it, after the plan check and before the row
   * is created.
   */
  const route = "app/api/videos/route.ts";
  it("checks capacity after the plan limit and before the insert", async () => {
    const { readCode } = await import("./read-source");
    const text = readCode(route);
    expect(text).toMatch(/^\s*if \(await atDailyCapacity\(\)\) return atCapacityResponse\(\);$/m);
    const planAt = text.indexOf("plan_limit_reached");
    const capacityAt = text.indexOf("atDailyCapacity()");
    const insertAt = text.indexOf('.from("videos")');
    expect(planAt).toBeGreaterThan(-1);
    expect(capacityAt).toBeGreaterThan(planAt);
    expect(insertAt).toBeGreaterThan(capacityAt);
  });
});
