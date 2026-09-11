import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The address-keyed budgets. The per-user buckets bound one account, and an
 * account is a free instant thing, so twenty inboxes is twenty budgets; one
 * address is not. These assertions fail if the IP path starts preferring the
 * user id again, which is what made the per-user buckets bound nothing.
 */

const rpc = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
  row: { allowed: true, remaining: 5, reset_at: null } as {
    allowed: boolean;
    remaining: number;
    reset_at: string | null;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (_name: string, params: Record<string, unknown>) => {
      rpc.calls.push(params);
      return { data: [rpc.row], error: null };
    },
  }),
}));

import { readCode } from "./read-source";
import {
  RATE_LIMITS,
  clientKey,
  enforceIpRateLimit,
  enforceRateLimit,
  ipKey,
  rateLimitResponse,
} from "@/lib/rate-limit";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://shotbreakdown.vercel.app/api/videos", { headers });
}

beforeEach(() => {
  rpc.calls = [];
  rpc.row = { allowed: true, remaining: 5, reset_at: null };
});

describe("the IP buckets exist with the budgets the plan set", () => {
  it.each([
    ["video_submit_ip", 12],
    ["ai_recreation_ip", 10],
    ["segment_breakdown_ip", 10],
  ])("%s is %i per 24h", (bucket, limit) => {
    const rule = RATE_LIMITS[bucket as keyof typeof RATE_LIMITS];
    expect(rule.limit).toBe(limit);
    expect(rule.windowSeconds).toBe(24 * 60 * 60);
  });
});

describe("ipKey", () => {
  it("takes the first hop of x-forwarded-for, which is the client behind Vercel", () => {
    const a = ipKey(request({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" }));
    const b = ipKey(request({ "x-forwarded-for": "203.0.113.7" }));
    expect(a).toBe(b);
  });

  it("separates two addresses", () => {
    expect(ipKey(request({ "x-forwarded-for": "203.0.113.7" }))).not.toBe(
      ipKey(request({ "x-forwarded-for": "203.0.113.8" }))
    );
  });

  it("falls back to x-real-ip, then cf-connecting-ip", () => {
    expect(ipKey(request({ "x-real-ip": "203.0.113.9" }))).toBe(
      ipKey(request({ "x-forwarded-for": "", "x-real-ip": "203.0.113.9" }))
    );
    expect(ipKey(request({ "cf-connecting-ip": "203.0.113.10" }))).not.toBe(
      ipKey(request({ "cf-connecting-ip": "203.0.113.11" }))
    );
  });

  it("is one bucket for every caller with no address at all", () => {
    expect(ipKey(request())).toBe(ipKey(request()));
  });

  it("does not carry the address in the clear", () => {
    expect(ipKey(request({ "x-forwarded-for": "203.0.113.7" }))).not.toContain("203.0.113.7");
  });
});

describe("clientKey is unchanged for its existing callers", () => {
  it("still prefers the user id when there is one", () => {
    expect(clientKey(request({ "x-forwarded-for": "203.0.113.7" }), "user-a")).toBe("u:user-a");
  });

  it("still keys an anonymous caller by address", () => {
    const req = request({ "x-forwarded-for": "203.0.113.7" });
    expect(clientKey(req)).toBe(ipKey(req));
    expect(clientKey(req, null)).toBe(ipKey(req));
  });
});

describe("the IP bucket is independent of the user bucket", () => {
  it("two different signed-in users behind one address share it — that is the point", () => {
    const one = request({ "x-forwarded-for": "203.0.113.7" });
    const two = request({ "x-forwarded-for": "203.0.113.7" });
    expect(ipKey(one)).toBe(ipKey(two));
    expect(clientKey(one, "user-a")).not.toBe(clientKey(two, "user-b"));
  });

  it("enforceIpRateLimit keys by address even though the caller is signed in", async () => {
    const req = request({ "x-forwarded-for": "203.0.113.7" });
    await enforceRateLimit("video_submit", req, "user-a");
    await enforceIpRateLimit("video_submit_ip", req);

    expect(rpc.calls).toHaveLength(2);
    expect(rpc.calls[0]).toMatchObject({ p_bucket: "video_submit", p_subject: "u:user-a" });
    expect(rpc.calls[1]).toMatchObject({
      p_bucket: "video_submit_ip",
      p_subject: ipKey(req),
      p_limit: 12,
      p_window_seconds: 24 * 60 * 60,
    });
  });

  it("sends the same subject for two different signed-in users on one address", async () => {
    const req = request({ "x-forwarded-for": "203.0.113.7" });
    await enforceIpRateLimit("video_submit_ip", req);
    await enforceIpRateLimit("video_submit_ip", req);
    expect(rpc.calls[0].p_subject).toBe(rpc.calls[1].p_subject);
  });

  it("returns null while the bucket has room", async () => {
    await expect(
      enforceIpRateLimit("video_submit_ip", request({ "x-forwarded-for": "203.0.113.7" }))
    ).resolves.toBeNull();
  });

  it("returns the 429 once the bucket is spent", async () => {
    rpc.row = { allowed: false, remaining: 0, reset_at: null };
    const response = await enforceIpRateLimit(
      "video_submit_ip",
      request({ "x-forwarded-for": "203.0.113.7" })
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    await expect(response!.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("accepts an override for a bucket's limit", async () => {
    await enforceIpRateLimit("ai_recreation_ip", request({ "x-forwarded-for": "203.0.113.7" }), {
      limit: 3,
    });
    expect(rpc.calls[0]).toMatchObject({ p_bucket: "ai_recreation_ip", p_limit: 3 });
  });
});

describe("rateLimitResponse", () => {
  it("carries Retry-After to the reset instant", () => {
    const resetAt = new Date(Date.now() + 90_000).toISOString();
    const response = rateLimitResponse({ allowed: false, remaining: 0, resetAt });
    const retryAfter = Number(response.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(80);
    expect(retryAfter).toBeLessThanOrEqual(90);
  });
});

describe("the spending routes apply the IP budget alongside the per-user one", () => {
  it.each([
    ["app/api/videos/route.ts", "video_submit_ip"],
    ["app/api/videos/[id]/breakdown/route.ts", "segment_breakdown_ip"],
    ["app/api/videos/[id]/ai-recreation/route.ts", "ai_recreation_ip"],
  ])("%s enforces %s", (route, bucket) => {
    expect(readCode(route)).toMatch(
      new RegExp(
        `^\\s*const \\w+ = await enforceIpRateLimit\\("${bucket}", request\\);$`,
        "m"
      )
    );
  });
});
