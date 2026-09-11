/**
 * The editorial queue is where the corpus is curated, so its gate is worth
 * pinning down: the flag, a session, and `profiles.is_admin` all have to hold,
 * and both actions only ever touch editorial rows.
 *
 * The second thing pinned here is the split the whole model rests on. Curation
 * (`review_status`) and exposure (`visibility`) are separate axes: approving
 * must not publish anything, and there must be no way to publish from this
 * surface at all — publication is scripts/publish-editorial.ts, run once at
 * launch. Every assertion fails if one of those conditions is dropped from the
 * page or the route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  features: { adminReview: true, adminLearning: false },
  user: null as { id: string; email?: string } | null,
  profile: null as { is_admin: boolean } | null,
  // What the service-role client hands back from the write / the queue read.
  writeResult: { data: [{ id: "shot-1" }], error: null } as {
    data: { id: string }[] | null;
    error: { message: string } | null;
    count?: number;
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
  for (const name of ["select", "update", "eq", "neq", "not", "order", "limit", "contains", "in"]) {
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
vi.mock("@/components/shell/app-shell", () => ({ AppShell: () => null }));
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

/** The payload the route handed to `.update()`, whatever else it also called. */
const updatePayload = () =>
  state.calls.find((call) => call[0] === "update")?.[1] as Record<string, unknown> | undefined;

const SHOT = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  state.features.adminReview = true;
  state.features.adminLearning = false;
  state.user = { id: "user-1", email: "admin@shotbreakdown.test" };
  state.profile = { is_admin: true };
  state.writeResult = { data: [{ id: SHOT }], error: null };
  state.calls.length = 0;
});

describe("POST /api/admin/review — gate", () => {
  it("404s when the feature flag is off, even for an admin", async () => {
    state.features.adminReview = false;
    const res = await post({ shotId: SHOT, action: "approve" });
    expect(res.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("404s for an anonymous request", async () => {
    state.user = null;
    const res = await post({ shotId: SHOT, action: "approve" });
    expect(res.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("404s for a signed-in non-admin", async () => {
    state.profile = { is_admin: false };
    const res = await post({ shotId: SHOT, action: "approve" });
    expect(res.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("404s when the account has no profile row at all", async () => {
    state.profile = null;
    const res = await post({ shotId: SHOT, action: "approve" });
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
      expect((await post({ shotId: SHOT, action: "approve" })).status).toBe(404);
    }
  });
});

describe("POST /api/admin/review — the decision", () => {
  it("approves an editorial, complete row without touching its visibility", async () => {
    const res = await post({ shotId: SHOT, action: "approve" });
    expect(res.status).toBe(200);
    expect(updatePayload()).toMatchObject({ review_status: "approved", reviewed_by: "user-1" });
    expect(updatePayload()).not.toHaveProperty("visibility");
    expect(state.calls).toContainEqual(["eq", "id", SHOT]);
    expect(state.calls).toContainEqual(["eq", "status", "complete"]);
    expect(state.calls).toContainEqual(["eq", "is_editorial", true]);
  });

  it("stamps the moment of the decision", async () => {
    const before = Date.now();
    await post({ shotId: SHOT, action: "approve" });
    const at = Date.parse(updatePayload()?.reviewed_at as string);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("credits the acting admin, not the row's owner or a client-supplied id", async () => {
    state.user = { id: "the-real-admin" };
    await post({ shotId: SHOT, action: "approve", reviewedBy: "someone-else" });
    expect(updatePayload()?.reviewed_by).toBe("the-real-admin");
  });

  it("records a rejection durably and forces the row private", async () => {
    const res = await post({ shotId: SHOT, action: "reject" });
    expect(res.status).toBe(200);
    expect(updatePayload()).toMatchObject({
      review_status: "rejected",
      visibility: "private",
      reviewed_by: "user-1",
    });
    // Auditable: the row stays in the corpus carrying the decision rather than
    // losing the flag that says what it is.
    expect(updatePayload()).not.toHaveProperty("is_editorial");
    expect(state.calls).toContainEqual(["eq", "is_editorial", true]);
  });

  it("offers no way to publish — that is the launch script's job alone", async () => {
    const res = await post({ shotId: SHOT, action: "publish" });
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("never writes visibility: 'public', whatever it is asked to do", async () => {
    for (const action of ["approve", "reject"]) {
      state.calls.length = 0;
      await post({ shotId: SHOT, action });
      expect(updatePayload()?.visibility).not.toBe("public");
    }
  });

  it("404s when the guard matched nothing, so a non-editorial id decides nothing", async () => {
    for (const action of ["approve", "reject"]) {
      state.writeResult = { data: [], error: null };
      const res = await post({ shotId: SHOT, action });
      expect(res.status).toBe(404);
    }
  });

  it("rejects a malformed body before touching the database", async () => {
    const res = await post({ shotId: "not-a-uuid", action: "approve" });
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
});

describe("/admin/review page — gate and queue", () => {
  const page = async (tab?: string) =>
    (await import("@/app/admin/review/page")).default({ searchParams: Promise.resolve({ tab }) });

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

  it("lists editorial rows only, so no customer's private upload is offered for review", async () => {
    state.writeResult = { data: [], error: null };
    await page();
    expect(state.calls).toContainEqual(["from", "shots"]);
    expect(state.calls).toContainEqual(["eq", "is_editorial", true]);
    expect(state.calls).toContainEqual(["eq", "status", "complete"]);
  });

  it("the queue is the pending rows, not everything that is not public", async () => {
    state.writeResult = { data: [], error: null };
    await page();
    expect(state.calls).toContainEqual(["eq", "review_status", "pending"]);
    // The old queue keyed on exposure. A private row that was already ruled on
    // must not come back round.
    expect(state.calls).not.toContainEqual(["neq", "visibility", "public"]);
  });

  it("the second tab lists the approved rows", async () => {
    state.writeResult = { data: [], error: null };
    await page("approved");
    expect(state.calls).toContainEqual(["eq", "review_status", "approved"]);
  });

  it("counts both states whichever tab is open", async () => {
    state.writeResult = { data: [], error: null };
    await page();
    const counts = state.calls.filter(
      (call) => call[0] === "select" && call[2] !== undefined
    );
    expect(counts.length).toBe(2);
    expect(counts[0][2]).toMatchObject({ count: "exact", head: true });
  });
});
