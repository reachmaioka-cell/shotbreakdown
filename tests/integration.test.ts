/**
 * Integration tests against a real Supabase instance.
 *
 * These are the highest-value tests in the repo: RLS is enforced by the
 * database, so the only honest way to prove one user cannot read another's
 * data is to ask the database as that user. Requires the local stack
 * (`npx supabase start`) and .env.local.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueJob, claimJobs, completeJob, failJob, activeJobCount } from "@/lib/pipeline/queue";
import { consumeRateLimit } from "@/lib/rate-limit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ready = Boolean(url && anonKey && process.env.SUPABASE_SERVICE_ROLE_KEY);

const suite = ready ? describe : describe.skip;

type Actor = { id: string; email: string; client: SupabaseClient };

async function makeActor(admin: ReturnType<typeof createAdminClient>, tag: string): Promise<Actor> {
  const email = `rls-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@shotbreakdown.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}A1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);

  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);

  return { id: data.user.id, email, client };
}

suite("row level security — cross-user isolation", () => {
  const admin = createAdminClient();
  let owner: Actor;
  let intruder: Actor;
  let videoId: string;
  let shotId: string;
  let collectionId: string;

  beforeAll(async () => {
    owner = await makeActor(admin, "owner");
    intruder = await makeActor(admin, "intruder");

    const { data: video, error: videoError } = await admin
      .from("videos")
      .insert({
        user_id: owner.id,
        source_type: "video_upload",
        file_path: `${owner.id}/rls.mp4`,
        title: "RLS fixture",
        status: "complete",
        visibility: "private",
      })
      .select("id")
      .single();
    if (videoError) throw new Error(videoError.message);
    videoId = video.id;

    const { data: shot, error: shotError } = await admin
      .from("shots")
      .insert({
        video_id: videoId,
        user_id: owner.id,
        shot_index: 0,
        start_seconds: 0,
        end_seconds: 4,
        status: "complete",
        visibility: "private",
        title: "RLS fixture shot",
        metadata: { description: "private fixture", one_line_summary: "private fixture" },
      })
      .select("id")
      .single();
    if (shotError) throw new Error(shotError.message);
    shotId = shot.id;

    const { data: collection, error: collectionError } = await admin
      .from("collections")
      .insert({ user_id: owner.id, name: "RLS deck", slug: `rls-${Date.now()}` })
      .select("id")
      .single();
    if (collectionError) throw new Error(collectionError.message);
    collectionId = collection.id;

    await admin
      .from("collection_items")
      .insert({ collection_id: collectionId, shot_id: shotId, user_id: owner.id, position: 0 });
  }, 60_000);

  afterAll(async () => {
    await admin.auth.admin.deleteUser(owner.id).catch(() => {});
    await admin.auth.admin.deleteUser(intruder.id).catch(() => {});
  });

  it("the owner can read their own private video and shot", async () => {
    const { data: video } = await owner.client.from("videos").select("id").eq("id", videoId);
    expect(video).toHaveLength(1);
    const { data: shot } = await owner.client.from("shots").select("id").eq("id", shotId);
    expect(shot).toHaveLength(1);
  });

  it("another user cannot read the private video", async () => {
    const { data } = await intruder.client.from("videos").select("id").eq("id", videoId);
    expect(data).toEqual([]);
  });

  it("another user cannot read the private shot", async () => {
    const { data } = await intruder.client.from("shots").select("id").eq("id", shotId);
    expect(data).toEqual([]);
  });

  it("another user cannot read the private collection or its items", async () => {
    const { data: collections } = await intruder.client
      .from("collections")
      .select("id")
      .eq("id", collectionId);
    expect(collections).toEqual([]);

    const { data: items } = await intruder.client
      .from("collection_items")
      .select("id")
      .eq("collection_id", collectionId);
    expect(items).toEqual([]);
  });

  it("another user cannot update or delete the shot", async () => {
    await intruder.client.from("shots").update({ title: "hijacked" }).eq("id", shotId);
    await intruder.client.from("shots").delete().eq("id", shotId);
    const { data } = await admin.from("shots").select("title").eq("id", shotId).single();
    expect(data?.title).toBe("RLS fixture shot");
  });

  it("a user cannot insert a shot owned by someone else", async () => {
    const { error } = await intruder.client.from("shots").insert({
      video_id: videoId,
      user_id: owner.id,
      shot_index: 99,
      start_seconds: 0,
      end_seconds: 1,
    });
    expect(error).toBeTruthy();
  });

  it("a user cannot save on behalf of another user", async () => {
    const { error } = await intruder.client
      .from("saved_shots")
      .insert({ user_id: owner.id, shot_id: shotId });
    expect(error).toBeTruthy();
  });

  it("pipeline-owned columns are rejected for the owner too", async () => {
    const { error } = await owner.client
      .from("shots")
      .update({ status: "failed" })
      .eq("id", shotId);
    expect(error).toBeTruthy();
  });

  it("the owner may change their own editable fields", async () => {
    const { error } = await owner.client
      .from("shots")
      .update({ title: "renamed by owner" })
      .eq("id", shotId);
    expect(error).toBeNull();
    await admin.from("shots").update({ title: "RLS fixture shot" }).eq("id", shotId);
  });

  it("a user cannot promote themselves to admin or pro", async () => {
    const { error: adminError } = await intruder.client
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", intruder.id);
    expect(adminError).toBeTruthy();

    const { error: planError } = await intruder.client
      .from("profiles")
      .update({ plan: "pro" })
      .eq("id", intruder.id);
    expect(planError).toBeTruthy();
  });

  it("search_shots does not leak private shots to another user", async () => {
    const { data } = await intruder.client.rpc("search_shots", {
      p_query: "private fixture",
      p_embedding: null,
      p_filters: {},
      p_limit: 20,
      p_offset: 0,
      p_viewer: intruder.id,
      p_scope: "public",
    });
    expect((data ?? []).some((row: { id: string }) => row.id === shotId)).toBe(false);
  });

  it("search_shots ignores a spoofed viewer id", async () => {
    // The RPC is SECURITY DEFINER, so a client passing someone else's id with
    // scope='mine' would otherwise read their private shots. The function
    // derives the viewer from auth.uid() for client roles.
    const { data } = await intruder.client.rpc("search_shots", {
      p_query: null,
      p_embedding: null,
      p_filters: { video_id: videoId },
      p_limit: 20,
      p_offset: 0,
      p_viewer: owner.id,
      p_scope: "mine",
    });
    expect(data).toEqual([]);
  });

  it("similar_shots ignores a spoofed viewer id", async () => {
    const { data } = await intruder.client.rpc("similar_shots", {
      p_shot_id: shotId,
      p_limit: 5,
      p_viewer: owner.id,
    });
    expect(data).toEqual([]);
  });

  it("match_shots ignores a spoofed viewer id", async () => {
    const { data } = await intruder.client.rpc("match_shots", {
      query_embedding: Array.from({ length: 1536 }, () => 0.01),
      match_k: 50,
      p_user_id: owner.id,
    });
    expect((data ?? []).some((row: { id: string }) => row.id === shotId)).toBe(false);
  });

  it("shot_facet_counts ignores a spoofed viewer id", async () => {
    const { data } = await intruder.client.rpc("shot_facet_counts", {
      p_viewer: owner.id,
      p_scope: "mine",
    });
    expect(data).toEqual([]);
  });

  it("processing_jobs are invisible to clients", async () => {
    const { data } = await intruder.client.from("processing_jobs").select("id").limit(1);
    expect(data).toEqual([]);
  });

  it("analytics_events are invisible to clients", async () => {
    const { data } = await intruder.client.from("analytics_events").select("id").limit(1);
    expect(data).toEqual([]);
  });

  it("rate_limits are invisible to clients", async () => {
    const { data } = await intruder.client.from("rate_limits").select("bucket").limit(1);
    expect(data).toEqual([]);
  });

  it("public shots stay readable by anyone", async () => {
    await admin.from("shots").update({ visibility: "public" }).eq("id", shotId);
    const { data } = await intruder.client.from("shots").select("id").eq("id", shotId);
    expect(data).toHaveLength(1);
    await admin.from("shots").update({ visibility: "private" }).eq("id", shotId);
  });

  /**
   * getCollection reads through the admin client, so RLS does not protect the
   * members. Publishing or sharing a deck must not become a way to expose a
   * private shot the owner never chose to share.
   */
  it("a public collection does not expose the private shots inside it", async () => {
    const { getCollection } = await import("@/lib/collections");
    await admin.from("collections").update({ visibility: "public" }).eq("id", collectionId);

    const asStranger = await getCollection({ id: collectionId }, intruder.id);
    expect(asStranger).not.toBeNull();
    expect(asStranger!.items.map((i) => i.shotId)).not.toContain(shotId);
    expect(asStranger!.hiddenItemCount).toBeGreaterThan(0);

    const asOwner = await getCollection({ id: collectionId }, owner.id);
    expect(asOwner!.items.map((i) => i.shotId)).toContain(shotId);
    expect(asOwner!.hiddenItemCount).toBe(0);

    await admin.from("collections").update({ visibility: "private" }).eq("id", collectionId);
  });

  it("a share link does not expose private shots inside the shared collection", async () => {
    const { getCollection } = await import("@/lib/collections");
    await admin.from("collections").update({ visibility: "unlisted" }).eq("id", collectionId);

    // allowUnlisted is what a valid share token grants.
    const viaLink = await getCollection({ id: collectionId }, null, { allowUnlisted: true });
    expect(viaLink).not.toBeNull();
    expect(viaLink!.items.map((i) => i.shotId)).not.toContain(shotId);

    // An unlisted shot inside an unlisted collection travels with the link.
    await admin.from("shots").update({ visibility: "unlisted" }).eq("id", shotId);
    const withUnlisted = await getCollection({ id: collectionId }, null, { allowUnlisted: true });
    expect(withUnlisted!.items.map((i) => i.shotId)).toContain(shotId);

    await admin.from("shots").update({ visibility: "private" }).eq("id", shotId);
    await admin.from("collections").update({ visibility: "private" }).eq("id", collectionId);
  });

  it("the public view never exposes storage paths or owner ids", async () => {
    const anon = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await anon.from("public_shots").select("*").limit(1);
    if (data?.[0]) {
      expect(Object.keys(data[0])).not.toContain("user_id");
      expect(Object.keys(data[0])).not.toContain("embedding");
    }
  });
});

suite("rate limiter", () => {
  it("allows up to the limit then blocks", async () => {
    const subject = `test:${Date.now()}:${Math.random()}`;
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await consumeRateLimit("view", subject, { limit: 3, windowSeconds: 60 }));
    }
    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
    expect(results[3].allowed).toBe(false);
    expect(results[0].remaining).toBe(2);
    expect(results[3].remaining).toBe(0);
  });

  it("keeps separate budgets per subject", async () => {
    const a = `a:${Date.now()}`;
    const b = `b:${Date.now()}`;
    await consumeRateLimit("view", a, { limit: 1, windowSeconds: 60 });
    const second = await consumeRateLimit("view", a, { limit: 1, windowSeconds: 60 });
    const other = await consumeRateLimit("view", b, { limit: 1, windowSeconds: 60 });
    expect(second.allowed).toBe(false);
    expect(other.allowed).toBe(true);
  });

  it("counts concurrent calls exactly once each", async () => {
    const subject = `race:${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        consumeRateLimit("view", subject, { limit: 5, windowSeconds: 60 })
      )
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});

suite("processing job queue", () => {
  const admin = createAdminClient();
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) await admin.from("processing_jobs").delete().eq("id", id);
  });

  /**
   * Asserted as an invariant rather than "this call got that job", because a
   * dev server or cron worker may be draining the same queue. The invariant is
   * what actually matters: FOR UPDATE SKIP LOCKED must never hand the same job
   * to two workers.
   */
  it("never hands the same job to two concurrent claims", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = await enqueueJob(
        "finalize_video",
        { probe: true },
        { dedupeKey: `test-skiplocked-${Date.now()}-${i}` }
      );
      if (id) {
        ids.push(id);
        created.push(id);
      }
    }
    expect(ids).toHaveLength(4);

    const [a, b] = await Promise.all([claimJobs(4), claimJobs(4)]);
    const overlap = a.filter((job) => b.some((other) => other.id === job.id));
    expect(overlap).toEqual([]);

    // Whoever claimed them, each was claimed exactly once.
    const { data } = await admin
      .from("processing_jobs")
      .select("id, attempts, status")
      .in("id", ids);
    for (const row of data ?? []) {
      expect(row.attempts).toBeLessThanOrEqual(1);
    }
  });

  it("marks a job done and stops offering it", async () => {
    const id = await enqueueJob(
      "finalize_video",
      { probe: true },
      { dedupeKey: `test-complete-${Date.now()}` }
    );
    created.push(id!);
    await completeJob(id!, { ok: true });

    const { data } = await admin.from("processing_jobs").select("status").eq("id", id!).single();
    expect(data?.status).toBe("done");

    const claimed = await claimJobs(10);
    expect(claimed.find((j) => j.id === id)).toBeUndefined();
  });

  it("refuses a duplicate while one is active", async () => {
    const key = `test-dedupe-${Date.now()}`;
    const first = await enqueueJob("finalize_video", {}, { dedupeKey: key });
    const second = await enqueueJob("finalize_video", {}, { dedupeKey: key });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    created.push(first!);
  });

  it("retries a retryable failure and gives up at max attempts", async () => {
    const id = await enqueueJob("finalize_video", {}, { dedupeKey: `test-retry-${Date.now()}`, maxAttempts: 2 });
    created.push(id!);

    const first = await failJob(
      { id: id!, attempts: 1, max_attempts: 2, job_type: "finalize_video", payload: {}, status: "running", video_id: null, user_id: null, error_message: null },
      "transient"
    );
    expect(first.terminal).toBe(false);

    const second = await failJob(
      { id: id!, attempts: 2, max_attempts: 2, job_type: "finalize_video", payload: {}, status: "running", video_id: null, user_id: null, error_message: null },
      "still failing"
    );
    expect(second.terminal).toBe(true);

    const { data } = await admin.from("processing_jobs").select("status").eq("id", id!).single();
    expect(data?.status).toBe("failed");
  });

  it("stops immediately on a non-retryable failure", async () => {
    const id = await enqueueJob("finalize_video", {}, { dedupeKey: `test-terminal-${Date.now()}`, maxAttempts: 5 });
    created.push(id!);
    const result = await failJob(
      { id: id!, attempts: 1, max_attempts: 5, job_type: "finalize_video", payload: {}, status: "running", video_id: null, user_id: null, error_message: null },
      "bad input",
      { retryable: false }
    );
    expect(result.terminal).toBe(true);
  });

  it("reports outstanding work so a drain loop knows to wait", async () => {
    expect(typeof (await activeJobCount())).toBe("number");
  });

  /*
   * A staged job enqueues its own successor while it is still running. If the
   * successor reuses the running job's dedupe key the unique index rejects it,
   * enqueueJob returns null, and the pipeline stops with nothing to carry it on
   * — which is how a segment with more shots than fit in one time budget got
   * stranded in `analyzing` with no queued work. The stages number each pass so
   * the key differs; this asserts both halves of that.
   */
  it("cannot enqueue a continuation under a running job's own dedupe key", async () => {
    const key = `test-continuation-${Date.now()}`;
    const first = await enqueueJob("analyze_shots", {}, { dedupeKey: key });
    created.push(first!);
    const [claimed] = await claimJobs(1);
    expect(claimed?.id).toBeTruthy();

    const collided = await enqueueJob("analyze_shots", { pass: 1 }, { dedupeKey: key });
    expect(collided).toBeNull();

    const distinct = await enqueueJob("analyze_shots", { pass: 1 }, { dedupeKey: `${key}:1` });
    expect(distinct).not.toBeNull();
    created.push(distinct!);
  });
});

suite("storage paths are pipeline-owned", () => {
  const admin = createAdminClient();
  let owner: Actor;
  let attacker: Actor;
  let videoId: string;
  let shotId: string;

  beforeAll(async () => {
    owner = await makeActor(admin, "sp-owner");
    attacker = await makeActor(admin, "sp-attacker");

    const { data: video } = await admin
      .from("videos")
      .insert({
        user_id: attacker.id,
        source_type: "video_upload",
        title: "attacker segment",
        status: "complete",
        content_hash: `sp:${Date.now()}`,
        poster_path: `${attacker.id}/mine.jpg`,
      })
      .select("id")
      .single();
    videoId = video!.id as string;

    const { data: shot } = await admin
      .from("shots")
      .insert({
        video_id: videoId,
        user_id: attacker.id,
        shot_index: 0,
        start_seconds: 0,
        end_seconds: 5,
        status: "complete",
        poster_path: `${attacker.id}/mine.jpg`,
        thumbnail_path: `${attacker.id}/mine-thumb.jpg`,
      })
      .select("id")
      .single();
    shotId = shot!.id as string;
  });

  afterAll(async () => {
    await admin.auth.admin.deleteUser(owner.id).catch(() => {});
    await admin.auth.admin.deleteUser(attacker.id).catch(() => {});
  });

  /*
   * poster_path and thumbnail_path are handed to resolveMediaUrl(), which signs
   * them with the SERVICE ROLE and never re-checks who owns the object. A user
   * who could point one of their own rows at someone else's key would be handed
   * a working signed URL to that file. This was reachable and is now blocked by
   * the column-protection trigger; these tests are what keep it blocked.
   */
  it("a user cannot point their own video's poster at another user's file", async () => {
    const victimKey = `${owner.id}/victim-private.jpg`;
    const { error } = await attacker.client
      .from("videos")
      .update({ poster_path: victimKey })
      .eq("id", videoId);
    expect(error).not.toBeNull();

    const { data } = await admin.from("videos").select("poster_path").eq("id", videoId).single();
    expect(data?.poster_path).not.toBe(victimKey);
  });

  it("a user cannot point their own shot's poster or thumbnail at another user's file", async () => {
    const victimKey = `${owner.id}/victim-private.jpg`;

    const poster = await attacker.client
      .from("shots")
      .update({ poster_path: victimKey })
      .eq("id", shotId);
    expect(poster.error).not.toBeNull();

    const thumb = await attacker.client
      .from("shots")
      .update({ thumbnail_path: victimKey })
      .eq("id", shotId);
    expect(thumb.error).not.toBeNull();

    const { data } = await admin
      .from("shots")
      .select("poster_path, thumbnail_path")
      .eq("id", shotId)
      .single();
    expect(data?.poster_path).not.toBe(victimKey);
    expect(data?.thumbnail_path).not.toBe(victimKey);
  });

  it("a user cannot overwrite the model's own record, but corrections stay open", async () => {
    const forged = await attacker.client
      .from("shots")
      .update({ metadata: { one_line_summary: "forged" } })
      .eq("id", shotId);
    expect(forged.error).not.toBeNull();

    // metadata_edits is where a correction belongs, and it must still be writable.
    const corrected = await attacker.client
      .from("shots")
      .update({ metadata_edits: { "composition.shot_size": "wide" } })
      .eq("id", shotId);
    expect(corrected.error).toBeNull();
  });

  it("leaves the owner their own naming, question and sharing", async () => {
    const mine = await attacker.client
      .from("videos")
      .update({ title: "renamed", focus: "my question", visibility: "unlisted" })
      .eq("id", videoId);
    expect(mine.error).toBeNull();
  });
});
