/**
 * The editorial corpus stays private until Ken says otherwise.
 *
 * Seeding music-video references before launch means a row written with
 * `is_editorial = true` must not reach a reader while `FEATURE_PUBLIC_LIBRARY`
 * is off. The app-side half of that — the flag helpers and the shot read path —
 * is pinned here, admin bypass included.
 *
 * The app-side half is not the whole of it, and the last two tests say so out
 * loud: a row stored with `visibility = 'public'` is readable straight from
 * PostgREST with the publishable anon key, so no amount of page code hides it.
 * Those tests assert the exposure rather than the absence of it, so that
 * seeding the corpus non-public turns them red and they are rewritten
 * deliberately instead of a real guarantee being assumed.
 *
 * The database half runs against the local Supabase stack, because a mocked
 * client would only prove that the mock agrees with the test.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ready = Boolean(url && anonKey && process.env.SUPABASE_SERVICE_ROLE_KEY);
const suite = ready ? describe : describe.skip;

/**
 * `FEATURES` is evaluated once at import, so a test that wants the other side
 * of a flag has to re-import every module that reads it. Returns the freshly
 * loaded shot module so the assertions run against that evaluation.
 */
async function loadShotsWithFlag(value: string | undefined) {
  const previous = process.env.FEATURE_PUBLIC_LIBRARY;
  if (value === undefined) delete process.env.FEATURE_PUBLIC_LIBRARY;
  else process.env.FEATURE_PUBLIC_LIBRARY = value;
  vi.resetModules();
  const mod = await import("@/lib/shots");
  return {
    mod,
    restore() {
      if (previous === undefined) delete process.env.FEATURE_PUBLIC_LIBRARY;
      else process.env.FEATURE_PUBLIC_LIBRARY = previous;
      vi.resetModules();
    },
  };
}

describe("feature flags", () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("FEATURE_") && saved[key] === undefined) delete process.env[key];
    }
    vi.resetModules();
  });

  it("defaults every flag to off, so an unset environment is a closed one", async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("FEATURE_")) delete process.env[key];
    }
    vi.resetModules();
    const { FEATURES } = await import("@/lib/features");
    expect(Object.values(FEATURES).every((on) => on === false)).toBe(true);
  });

  it("only `1` turns a flag on — a truthy-looking value does not", async () => {
    process.env.FEATURE_PUBLIC_LIBRARY = "true";
    vi.resetModules();
    const { FEATURES } = await import("@/lib/features");
    expect(FEATURES.publicLibrary).toBe(false);
  });

  it("turning the public library on does not turn the SEO surfaces on with it", async () => {
    process.env.FEATURE_PUBLIC_LIBRARY = "1";
    vi.resetModules();
    const { FEATURES } = await import("@/lib/features");
    expect(FEATURES.publicLibrary).toBe(true);
    expect(FEATURES.taxonomyPages).toBe(false);
    expect(FEATURES.tagPages).toBe(false);
    expect(FEATURES.learnPages).toBe(false);
    expect(FEATURES.similarShots).toBe(false);
  });
});

describe("crawl surfaces while the public library is off", () => {
  it("the sitemap lists marketing pages only, and never a shot or the library", async () => {
    delete process.env.FEATURE_PUBLIC_LIBRARY;
    vi.resetModules();
    const sitemap = (await import("@/app/sitemap")).default;
    const entries = await sitemap();
    const paths = entries.map((entry) => new URL(entry.url).pathname);
    expect(paths).toEqual(["/", "/upgrade", "/terms", "/privacy"]);
  });

  it("robots disallows /shots and /library", async () => {
    delete process.env.FEATURE_PUBLIC_LIBRARY;
    vi.resetModules();
    const robots = (await import("@/app/robots")).default;
    const disallow = robots().rules;
    const paths = Array.isArray(disallow) ? [] : ((disallow.disallow as string[]) ?? []);
    expect(paths).toContain("/shots");
    expect(paths).toContain("/library");
  });
});

suite("editorial rows are invisible while the public library is off", () => {
  const admin = createAdminClient();
  let editorialShotId: string;
  let ownedPublicShotId: string;
  let ownerId: string;
  let strangerId: string;
  let editorialVideoId: string;
  let ownedVideoId: string;
  let adminId: string;
  let strangerClient: SupabaseClient;
  let anonClient: SupabaseClient;

  beforeAll(async () => {
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const owner = await admin.auth.admin.createUser({
      email: `editorial-owner-${tag}@shotbreakdown.test`,
      password: `pw-${tag}A1!`,
      email_confirm: true,
    });
    if (!owner.data.user) throw new Error(`createUser owner: ${owner.error?.message}`);
    ownerId = owner.data.user.id;

    const strangerEmail = `editorial-stranger-${tag}@shotbreakdown.test`;
    const strangerPassword = `pw-${tag}B2!`;
    const stranger = await admin.auth.admin.createUser({
      email: strangerEmail,
      password: strangerPassword,
      email_confirm: true,
    });
    if (!stranger.data.user) throw new Error(`createUser stranger: ${stranger.error?.message}`);
    strangerId = stranger.data.user.id;
    strangerClient = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await strangerClient.auth.signInWithPassword({
      email: strangerEmail,
      password: strangerPassword,
    });
    if (signInError) throw new Error(`signIn stranger: ${signInError.message}`);

    // Nobody signed in at all, holding only the key the browser bundle ships.
    anonClient = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // `is_admin` is service-role-only (protect_admin_flag), so the fixture has
    // to be promoted the same way a real admin is.
    const adminUser = await admin.auth.admin.createUser({
      email: `editorial-admin-${tag}@shotbreakdown.test`,
      password: `pw-${tag}C3!`,
      email_confirm: true,
    });
    if (!adminUser.data.user) throw new Error(`createUser admin: ${adminUser.error?.message}`);
    adminId = adminUser.data.user.id;
    const { error: promoteError } = await admin
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", adminId);
    if (promoteError) throw new Error(`promote admin: ${promoteError.message}`);

    // The exact shape scripts/seed-music-clips.ts writes: nobody's row, public,
    // editorial, with a slug anyone could guess from the title.
    const { data: editorialVideo, error: editorialVideoError } = await admin
      .from("videos")
      .insert({
        source_type: "youtube",
        source_url: `https://www.youtube.com/watch?v=iso-${tag}`,
        title: `Editorial isolation fixture ${tag}`,
        status: "complete",
        visibility: "public",
        is_editorial: true,
        shot_count: 1,
        analyzed_shot_count: 1,
      })
      .select("id")
      .single();
    if (editorialVideoError) throw new Error(editorialVideoError.message);
    editorialVideoId = editorialVideo.id;

    const { data: editorialShot, error: editorialShotError } = await admin
      .from("shots")
      .insert({
        video_id: editorialVideoId,
        user_id: null,
        shot_index: 0,
        start_seconds: 0,
        end_seconds: 4,
        status: "complete",
        visibility: "public",
        is_editorial: true,
        title: `Editorial isolation fixture shot ${tag}`,
        slug: `editorial-isolation-fixture-${tag}`,
        metadata: { description: "editorial fixture", one_line_summary: "editorial fixture" },
      })
      .select("id")
      .single();
    if (editorialShotError) throw new Error(editorialShotError.message);
    editorialShotId = editorialShot.id;

    // A frame row, so the frame assertion below distinguishes "refused" from
    // "there was nothing to hand over".
    const { error: frameError } = await admin.from("shot_frames").insert({
      shot_id: editorialShotId,
      video_id: editorialVideoId,
      user_id: null,
      timestamp_seconds: 1,
      storage_path: `editorial/${editorialVideoId}/0.jpg`,
      thumb_path: `editorial/${editorialVideoId}/0.jpg`,
    });
    if (frameError) throw new Error(frameError.message);

    // A user's own public shot, to prove the gate keys on `is_editorial` and
    // does not quietly break sharing your own work.
    const { data: ownedVideo, error: ownedVideoError } = await admin
      .from("videos")
      .insert({
        user_id: ownerId,
        source_type: "video_upload",
        file_path: `${ownerId}/iso.mp4`,
        title: `Owned fixture ${tag}`,
        status: "complete",
        visibility: "public",
      })
      .select("id")
      .single();
    if (ownedVideoError) throw new Error(ownedVideoError.message);
    ownedVideoId = ownedVideo.id;

    const { data: ownedShot, error: ownedShotError } = await admin
      .from("shots")
      .insert({
        video_id: ownedVideoId,
        user_id: ownerId,
        shot_index: 0,
        start_seconds: 0,
        end_seconds: 4,
        status: "complete",
        visibility: "public",
        title: `Owned fixture shot ${tag}`,
        slug: `owned-fixture-${tag}`,
        metadata: { description: "owned fixture", one_line_summary: "owned fixture" },
      })
      .select("id")
      .single();
    if (ownedShotError) throw new Error(ownedShotError.message);
    ownedPublicShotId = ownedShot.id;
  }, 30_000);

  afterAll(async () => {
    // shot_frames cascades from shots.
    await admin.from("shots").delete().in("id", [editorialShotId, ownedPublicShotId]);
    await admin.from("videos").delete().in("id", [editorialVideoId, ownedVideoId]);
    for (const id of [ownerId, strangerId, adminId]) {
      if (id) await admin.auth.admin.deleteUser(id);
    }
  });

  it("getShot refuses an editorial row to an anonymous reader and to a signed-in stranger", async () => {
    const { mod, restore } = await loadShotsWithFlag(undefined);
    try {
      expect(await mod.getShot(editorialShotId, null)).toBeNull();
      expect(await mod.getShot(editorialShotId, strangerId)).toBeNull();
    } finally {
      restore();
    }
  });

  it("getShot refuses an editorial row looked up by its slug, the URL a crawler would guess", async () => {
    const { mod, restore } = await loadShotsWithFlag(undefined);
    try {
      const { data } = await admin.from("shots").select("slug").eq("id", editorialShotId).single();
      expect(await mod.getShot(data!.slug as string, null, { bySlug: true })).toBeNull();
    } finally {
      restore();
    }
  });

  it("still serves a user's own public shot, so the gate is about the corpus and not about visibility", async () => {
    const { mod, restore } = await loadShotsWithFlag(undefined);
    try {
      const shot = await mod.getShot(ownedPublicShotId, null);
      expect(shot?.id).toBe(ownedPublicShotId);
    } finally {
      restore();
    }
  });

  it("still serves the corpus to an admin, who is the one person meant to curate it", async () => {
    const { mod, restore } = await loadShotsWithFlag(undefined);
    try {
      expect((await mod.getShot(editorialShotId, adminId))?.id).toBe(editorialShotId);
      expect(
        (await mod.getShotFrames(editorialShotId, adminId, { allowPublic: true })).length
      ).toBe(1);
    } finally {
      restore();
    }
  });

  it("getShotFrames hands out no frames for an editorial row even when the caller allows public", async () => {
    const off = await loadShotsWithFlag(undefined);
    try {
      expect(await off.mod.getShotFrames(editorialShotId, null, { allowPublic: true })).toEqual([]);
    } finally {
      off.restore();
    }

    // The fixture does have a frame, so the empty result above is a refusal.
    const on = await loadShotsWithFlag("1");
    try {
      expect(
        (await on.mod.getShotFrames(editorialShotId, null, { allowPublic: true })).length
      ).toBe(1);
    } finally {
      on.restore();
    }
  });

  it("is a flag and not a wall: turning the public library on serves the same row", async () => {
    const { mod, restore } = await loadShotsWithFlag("1");
    try {
      const shot = await mod.getShot(editorialShotId, null);
      expect(shot?.id).toBe(editorialShotId);
    } finally {
      restore();
    }
  });

  it("the 'mine' scope the library collapses to never returns an editorial row", async () => {
    const { mod, restore } = await loadShotsWithFlag(undefined);
    try {
      const result = await mod.searchShots({ viewerId: strangerId, scope: "mine", limit: 96 });
      expect(result.shots.map((shot) => shot.id)).not.toContain(editorialShotId);
    } finally {
      restore();
    }
  });

  /*
   * The database is not the gate, and pretending otherwise is how this would be
   * lost later: RLS exposes a public row to every reader, signed in or not,
   * editorial or not. The page code above never runs for these callers — they
   * talk to PostgREST directly with the key the browser bundle ships.
   *
   * Both are asserted as exposures. The day the corpus is seeded non-public
   * these go red, which is the point: the fix is a change to what is stored,
   * and it should have to be acknowledged here rather than quietly assumed.
   */
  it("RLS alone does not hide an editorial row from a signed-in stranger", async () => {
    const { data, error } = await strangerClient
      .from("shots")
      .select("id")
      .eq("id", editorialShotId);
    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([editorialShotId]);
  });

  it("nor from an anonymous caller holding only the publishable anon key", async () => {
    const { data, error } = await anonClient
      .from("shots")
      .select("id, title, metadata")
      .eq("id", editorialShotId);
    expect(error).toBeNull();
    expect(data?.[0]?.id).toBe(editorialShotId);
    // The whole analysis, not just the existence of a row.
    expect(data?.[0]?.title).toContain("Editorial isolation fixture shot");
    expect(data?.[0]?.metadata).not.toBeNull();
  });

  it("and the editorial video row, breakdown included, is anonymous to read too", async () => {
    const { data, error } = await anonClient
      .from("videos")
      .select("id, title")
      .eq("id", editorialVideoId);
    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([editorialVideoId]);
  });
});
