/**
 * The editorial queue is the one place in the product that can turn a private
 * row into a public page, so its gate is worth pinning down: the flag, a
 * session, and `profiles.is_admin` all have to hold, and both actions only
 * ever touch editorial rows. Every assertion here fails if one of those
 * conditions is dropped from the page or the route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  features: { adminReview: true },
  user: null as { id: string } | null,
  profile: null as { is_admin: boolean } | null,
  // What the service-role client hands back from the write / the queue read.
  writeResult: { data: [{ id: "shot-1" }], error: null } as {
    data: { id: string }[] | null;
    error: { message: string } | null;
  },
  calls: [] as unknown[][],
}));

vi.mock("@/lib/features", () => ({ FEATURES: state.features }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.profile }),
          single: async () => ({ data: state.profile }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => {
  // One recording builder: every filter lands in state.calls so a test can
  // assert on the predicate the caller actually sent. The builder is itself
  // awaitable, the way postgrest-js is, so a chain can end anywhere.
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.writeResult).then(resolve, reject),
  };
  const record = (name: string) => (...args: unknown[]) => {
    state.calls.push([name, ...args]);
    return chain;
  };
  for (const name of ["select", "update", "eq", "neq", "not", "order", "limit", "contains"]) {
    chain[name] = record(name);
  }
  return {
    createAdminClient: () => ({
      from: (table: string) => {
        state.calls.push(["from", table]);
        return chain;
      },
    }),
  };
});

vi.mock("@/lib/learning/hooks", () => ({ queueVerifiedLearning: vi.fn(async () => {}) }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/lib/media", () => ({ resolveMediaUrlMap: async () => new Map<string, string>() }));

const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/admin/review/route");
  return POST(
    new Request("http://localhost/api/admin/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
};

const SHOT = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  state.features.adminReview = true;
  state.user = { id: "user-1" };
  state.profile = { is_admin: true };
  state.writeResult = { data: [{ id: SHOT }], error: null };
  state.calls.length = 0;
});

describe("POST /api/admin/review — gate", () => {
  it("404s when the feature flag is off, even for an admin", async () => {
    state.features.adminReview = false;
    const res = await post({ shotId: SHOT, action: "publish" });
    expect(res.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("404s for an anonymous request", async () => {
    state.user = null;
    const res = await post({ shotId: SHOT, action: "publish" });
    expect(res.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("404s for a signed-in non-admin", async () => {
    state.profile = { is_admin: false };
    const res = await post({ shotId: SHOT, action: "publish" });
    expect(res.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("404s when the account has no profile row at all", async () => {
    state.profile = null;
    const res = await post({ shotId: SHOT, action: "publish" });
    expect(res.status).toBe(404);
  });

  it("never answers 403 — a refusal must not confirm the page exists", async () => {
    for (const setup of [
      () => (state.features.adminReview = false),
      () => (state.user = null),
      () => (state.profile = { is_admin: false }),
    ]) {
      state.features.adminReview = true;
      state.user = { id: "user-1" };
      state.profile = { is_admin: true };
      setup();
      expect((await post({ shotId: SHOT, action: "publish" })).status).toBe(404);
    }
  });
});

describe("POST /api/admin/review — writes", () => {
  it("publishes only an editorial, complete row", async () => {
    const res = await post({ shotId: SHOT, action: "publish" });
    expect(res.status).toBe(200);
    expect(state.calls).toContainEqual(["update", { visibility: "public" }]);
    expect(state.calls).toContainEqual(["eq", "id", SHOT]);
    expect(state.calls).toContainEqual(["eq", "status", "complete"]);
    expect(state.calls).toContainEqual(["eq", "is_editorial", true]);
  });

  it("404s when the guard matched nothing, so a private upload cannot be published by id", async () => {
    state.writeResult = { data: [], error: null };
    const res = await post({ shotId: SHOT, action: "publish" });
    expect(res.status).toBe(404);
  });

  it("clears is_editorial on reject so the row leaves the queue for good", async () => {
    const res = await post({ shotId: SHOT, action: "reject" });
    expect(res.status).toBe(200);
    expect(state.calls).toContainEqual(["update", { visibility: "private", is_editorial: false }]);
    expect(state.calls).toContainEqual(["eq", "is_editorial", true]);
  });

  it("rejects a malformed body before touching the database", async () => {
    const res = await post({ shotId: "not-a-uuid", action: "publish" });
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
});

describe("/admin/review page — gate and queue", () => {
  const page = async () => (await import("@/app/admin/review/page")).default();

  it("404s when the feature flag is off, even for an admin", async () => {
    state.features.adminReview = false;
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.calls).toHaveLength(0);
  });

  it("404s for an anonymous visitor", async () => {
    state.user = null;
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.calls).toHaveLength(0);
  });

  it("404s for a signed-in non-admin", async () => {
    state.profile = { is_admin: false };
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.calls).toHaveLength(0);
  });

  it("lists editorial rows only, so no customer's private upload is offered for publication", async () => {
    state.writeResult = { data: [], error: null };
    await page();
    expect(state.calls).toContainEqual(["from", "shots"]);
    expect(state.calls).toContainEqual(["eq", "is_editorial", true]);
    expect(state.calls).toContainEqual(["eq", "status", "complete"]);
    expect(state.calls).toContainEqual(["neq", "visibility", "public"]);
  });
});
