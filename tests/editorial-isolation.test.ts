/**
 * The editorial corpus stays private until Ken says otherwise.
 *
 * Seeding music-video references before launch means a row written with
 * `is_editorial = true` must not reach a reader while `FEATURE_PUBLIC_LIBRARY`
 * is off. The app-side half of that — the flag helpers and the shot read path —
 * is pinned here, admin bypass included.
 *
 * The app-side half is not the whole of it, and this file used to say so by
 * asserting the exposure: a row stored with `visibility = 'public'` is readable
 * straight from PostgREST with the publishable anon key, so no amount of page
 * code hid it. That tripwire has fired. The corpus is now seeded `private`
 * (scripts/seed-music-clips.ts) and published once at launch
 * (scripts/publish-editorial.ts), so those tests are inverted below into the
 * guarantee they were holding the place for: an anon or signed-in stranger
 * reading a private editorial row gets nothing at all.
 *
 * Both shapes are kept on purpose. The private fixture is the corpus as it is
 * stored today; the public one is the window between the launch script running
 * and FEATURE_PUBLIC_LIBRARY going on, which is the only time the app-side
 * checks are what stands between an editorial row and a reader.
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

/**
 * The same trick for the other modules that read `FEATURES` at import: the
 * collection reader, and the exports built on top of it. The module has to be
 * imported inside `run`, after the flag is set and the registry is reset.
 */
async function withLibraryFlag<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.FEATURE_PUBLIC_LIBRARY;
  if (value === undefined) delete process.env.FEATURE_PUBLIC_LIBRARY;
  else process.env.FEATURE_PUBLIC_LIBRARY = value;
  vi.resetModules();
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.FEATURE_PUBLIC_LIBRARY;
    else process.env.FEATURE_PUBLIC_LIBRARY = previous;
    vi.resetModules();
  }
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
  let privateEditorialShotId: string;
  let privateEditorialVideoId: string;
  let collectionId: string;
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

    // A published editorial row: nobody's, public, with a slug anyone could
    // guess from the title. This is what the corpus looks like after
    // scripts/publish-editorial.ts and before FEATURE_PUBLIC_LIBRARY goes on.
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

    // And the shape scripts/seed-music-clips.ts writes today: private, nobody's,
    // waiting for review. Everything below that says "nothing" is asked of this
    // row, through the same clients a stranger and a crawler would use.
    const { data: privateVideo, error: privateVideoError } = await admin
      .from("videos")
      .insert({
        source_type: "youtube",
        source_url: `https://www.youtube.com/watch?v=iso-private-${tag}`,
        title: `Editorial private fixture ${tag}`,
        status: "complete",
        visibility: "private",
        is_editorial: true,
        shot_count: 1,
        analyzed_shot_count: 1,
        breakdown: { title: "how the corpus was cut", technique: { name: "whip pan" } },
        breakdown_status: "ready",
      })
      .select("id")
      .single();
    if (privateVideoError) throw new Error(privateVideoError.message);
    privateEditorialVideoId = privateVideo.id;

    const { data: privateShot, error: privateShotError } = await admin
      .from("shots")
      .insert({
        video_id: privateEditorialVideoId,
        user_id: null,
        shot_index: 0,
        start_seconds: 0,
        end_seconds: 4,
        status: "complete",
        visibility: "private",
        review_status: "pending",
        is_editorial: true,
        title: `Editorial private fixture shot ${tag}`,
        slug: `editorial-private-fixture-${tag}`,
        metadata: { description: "private fixture", one_line_summary: "private fixture" },
      })
      .select("id")
      .single();
    if (privateShotError) throw new Error(privateShotError.message);
    privateEditorialShotId = privateShot.id;

    const { error: privateFrameError } = await admin.from("shot_frames").insert({
      shot_id: privateEditorialShotId,
      video_id: privateEditorialVideoId,
      user_id: null,
      timestamp_seconds: 2,
      storage_path: `editorial/${privateEditorialVideoId}/0.jpg`,
      thumb_path: `editorial/${privateEditorialVideoId}/0.jpg`,
      is_representative: true,
    });
    if (privateFrameError) throw new Error(privateFrameError.message);

    /*
     * A saved_shots row forced in by the service role. POST /api/shots/[id]/save
     * refuses this shot (its guard is pinned below), so nobody could put this
     * here — which is the point: even granted the row, `?scope=saved` must not
     * hand the corpus back.
     */
    const { error: saveError } = await admin
      .from("saved_shots")
      .insert({ user_id: strangerId, shot_id: privateEditorialShotId });
    if (saveError) throw new Error(saveError.message);

    /*
     * A public collection of the owner's with an editorial shot in it. Nobody
     * can build this before launch — the save and collection-item routes refuse
     * a private row, which is pinned below — so it is the shape of the window
     * after publish-editorial.ts and before the library flag, which is the only
     * time the collection reader's own check is what stands in the way.
     */
    const { data: collection, error: collectionError } = await admin
      .from("collections")
      .insert({
        user_id: ownerId,
        name: `Editorial mix ${tag}`,
        slug: `editorial-mix-${tag}`,
        visibility: "public",
      })
      .select("id")
      .single();
    if (collectionError) throw new Error(collectionError.message);
    collectionId = collection.id;

    const { error: itemsError } = await admin.from("collection_items").insert([
      { collection_id: collectionId, shot_id: ownedPublicShotId, user_id: ownerId, position: 0 },
      { collection_id: collectionId, shot_id: editorialShotId, user_id: ownerId, position: 1 },
    ]);
    if (itemsError) throw new Error(itemsError.message);
  }, 30_000);

  afterAll(async () => {
    // collection_items cascade from the collection; shot_frames and saved_shots
    // from the shots.
    if (collectionId) await admin.from("collections").delete().eq("id", collectionId);
    await admin
      .from("shots")
      .delete()
      .in("id", [editorialShotId, ownedPublicShotId, privateEditorialShotId]);
    await admin
      .from("videos")
      .delete()
      .in("id", [editorialVideoId, ownedVideoId, privateEditorialVideoId]);
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
   * The collection reader and the exports built on it, asked at the layer that
   * decides rather than by reading the source. A source-level check passes
   * whatever arguments the call is given; these fail if the guard is deleted,
   * neutered, or handed the wrong row.
   */
  it("a public collection hands an editorial shot to nobody while the library is off", async () => {
    await withLibraryFlag(undefined, async () => {
      const { getCollection } = await import("@/lib/collections");
      const detail = await getCollection({ id: collectionId }, null);
      expect(detail?.items.map((item) => item.shotId)).toEqual([ownedPublicShotId]);
    });
  });

  it("and hands it over once the library is on, so the collection is not broken", async () => {
    await withLibraryFlag("1", async () => {
      const { getCollection } = await import("@/lib/collections");
      const detail = await getCollection({ id: collectionId }, null);
      expect(detail?.items.map((item) => item.shotId)).toEqual([
        ownedPublicShotId,
        editorialShotId,
      ]);
    });
  });

  it("an export of the editorial segment is refused while the library is off", async () => {
    await withLibraryFlag(undefined, async () => {
      const { buildExportPayload } = await import("@/lib/export");
      const payload = await buildExportPayload("video", editorialVideoId, null, "http://localhost");
      expect(payload).toBeNull();
    });

    // And is a real document once the flag is on, so the null above is the
    // refusal and not an empty video.
    await withLibraryFlag("1", async () => {
      const { buildExportPayload } = await import("@/lib/export");
      const payload = await buildExportPayload("video", editorialVideoId, null, "http://localhost");
      expect(payload?.rows.length).toBeGreaterThan(0);
    });
  });

  /*
   * The database IS the gate, and these three used to assert the opposite.
   *
   * While the corpus was seeded public, RLS handed an editorial row to every
   * reader, signed in or not: the page code above never runs for these callers,
   * because they talk to PostgREST directly with the key the browser bundle
   * ships. Seeding it private is what changed the answer, so each of those
   * tripwires is now the guarantee it was standing in for.
   *
   * They hold against a fixture written by this file, though, so none of them
   * would notice the seeder itself regressing; that one line is pinned
   * separately, at the end of this suite.
   */
  it("RLS hides a private editorial row from a signed-in stranger", async () => {
    const { data, error } = await strangerClient
      .from("shots")
      .select("id")
      .eq("id", privateEditorialShotId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("and from an anonymous caller holding only the publishable anon key", async () => {
    const { data, error } = await anonClient
      .from("shots")
      .select("id, title, metadata")
      .eq("id", privateEditorialShotId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("the video row, breakdown and all, is unreadable to both as well", async () => {
    for (const client of [anonClient, strangerClient]) {
      const { data, error } = await client
        .from("videos")
        .select("id, title, breakdown")
        .eq("id", privateEditorialVideoId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  it("so are its frames, which are what the storage paths hang off", async () => {
    const { data, error } = await anonClient
      .from("shot_frames")
      .select("id, storage_path")
      .eq("shot_id", privateEditorialShotId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("an admin can open a private editorial row, or the review queue is a list of 404s", async () => {
    const { mod, restore } = await loadShotsWithFlag(undefined);
    try {
      expect((await mod.getShot(privateEditorialShotId, adminId))?.id).toBe(privateEditorialShotId);
      expect(
        (await mod.getShotFrames(privateEditorialShotId, adminId, { allowPublic: true })).length
      ).toBe(1);
    } finally {
      restore();
    }
  });

  it("that exception is the corpus's alone — a private upload stays refused to an admin", async () => {
    const { data: ownedPrivate, error } = await admin
      .from("shots")
      .insert({
        video_id: ownedVideoId,
        user_id: ownerId,
        shot_index: 1,
        start_seconds: 4,
        end_seconds: 8,
        status: "complete",
        visibility: "private",
        title: "Owned private fixture shot",
        metadata: { description: "owned private", one_line_summary: "owned private" },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { mod, restore } = await loadShotsWithFlag(undefined);
    try {
      expect(await mod.getShot(ownedPrivate.id as string, adminId)).toBeNull();
    } finally {
      restore();
      await admin.from("shots").delete().eq("id", ownedPrivate.id);
    }
  });

  it("nor to an anonymous reader or a signed-in stranger, admin exception or not", async () => {
    const { mod, restore } = await loadShotsWithFlag(undefined);
    try {
      expect(await mod.getShot(privateEditorialShotId, null)).toBeNull();
      expect(await mod.getShot(privateEditorialShotId, strangerId)).toBeNull();
    } finally {
      restore();
    }
  });

  /*
   * The one line the whole model rests on, and nothing else here reads it.
   * Every row in this file is a fixture the test wrote, so the seeder could go
   * back to `visibility: "public"` tomorrow and every assertion above would
   * still pass while the corpus went on the internet the moment it was seeded.
   * Pinning the source is weaker than running the seeder — that needs yt-dlp,
   * a download and a vision call — but it is the difference between the
   * regression being caught and not.
   */
  it("the seeder writes the corpus private and pending, which is the whole of what hides it", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("scripts/seed-music-clips.ts", "utf8");
    expect(source).not.toContain('visibility: "public"');
    // One on the videos insert, one on the shots insert. A third insert that
    // needs a visibility is a decision worth making here too.
    expect(source.match(/visibility: "private"/g) ?? []).toHaveLength(2);
    expect(source).toContain('review_status: "pending"');
  });

  it("the row really is there — the service role reads what the others cannot", async () => {
    const { data } = await admin
      .from("shots")
      .select("id, visibility, review_status, is_editorial")
      .eq("id", privateEditorialShotId)
      .single();
    expect(data).toMatchObject({
      visibility: "private",
      review_status: "pending",
      is_editorial: true,
    });
  });
});

/*
 * The four surfaces the isolation lane measured, each pinned against the row as
 * the seeder now writes it. Every one of them leaked only because the row was
 * public; all four are asked here at the layer that actually decides.
 */
suite("the four surfaces a public editorial row leaked through", () => {
  const admin = createAdminClient();
  let shotId: string;
  let videoId: string;
  let strangerId: string;
  let strangerClient: SupabaseClient;
  let anonClient: SupabaseClient;

  beforeAll(async () => {
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const email = `editorial-surface-${tag}@shotbreakdown.test`;
    const password = `pw-${tag}D4!`;
    const stranger = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (!stranger.data.user) throw new Error(`createUser: ${stranger.error?.message}`);
    strangerId = stranger.data.user.id;

    strangerClient = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await strangerClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw new Error(`signIn: ${signInError.message}`);
    anonClient = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: video, error: videoError } = await admin
      .from("videos")
      .insert({
        source_type: "youtube",
        source_url: `https://www.youtube.com/watch?v=surface-${tag}`,
        title: `Editorial surface fixture ${tag}`,
        status: "complete",
        visibility: "private",
        is_editorial: true,
        shot_count: 1,
        analyzed_shot_count: 1,
        breakdown: { title: "surface fixture breakdown" },
        breakdown_status: "ready",
        ai_recreation: { summary: "surface fixture recreation" },
        ai_recreation_status: "ready",
      })
      .select("id")
      .single();
    if (videoError) throw new Error(videoError.message);
    videoId = video.id;

    const { data: shot, error: shotError } = await admin
      .from("shots")
      .insert({
        video_id: videoId,
        user_id: null,
        shot_index: 0,
        start_seconds: 0,
        end_seconds: 4,
        status: "complete",
        visibility: "private",
        review_status: "pending",
        is_editorial: true,
        title: `Editorial surface fixture shot ${tag}`,
        slug: `editorial-surface-fixture-${tag}`,
        metadata: { description: "surface fixture", one_line_summary: "surface fixture" },
      })
      .select("id")
      .single();
    if (shotError) throw new Error(shotError.message);
    shotId = shot.id;
  }, 30_000);

  afterAll(async () => {
    await admin.from("shots").delete().eq("id", shotId);
    await admin.from("videos").delete().eq("id", videoId);
    if (strangerId) await admin.auth.admin.deleteUser(strangerId);
  });

  it("(1) the segment page's gate refuses it: the video is not public to a non-owner", async () => {
    const { data } = await admin
      .from("videos")
      .select("visibility, user_id, is_editorial")
      .eq("id", videoId)
      .single();
    // app/videos/[id]/page.tsx: `if (!isOwner && video.visibility !== "public") notFound()`.
    // An editorial row has no user_id, so nobody signed in is the owner.
    expect(data?.user_id).toBeNull();
    expect(data?.visibility).not.toBe("public");
  });

  it("(2) the breakdown and ai-recreation routes refuse it: both key on 'private'", async () => {
    const { data } = await admin
      .from("videos")
      .select("visibility, breakdown, ai_recreation")
      .eq("id", videoId)
      .single();
    expect(data?.visibility).toBe("private");
    // The documents exist, so the refusal above is a refusal and not an empty row.
    expect(data?.breakdown).not.toBeNull();
    expect(data?.ai_recreation).not.toBeNull();
  });

  it("(3) GET /api/videos/[id] returns nothing: RLS gives neither caller a row", async () => {
    for (const client of [strangerClient, anonClient]) {
      const { data, error } = await client.from("videos").select("id").eq("id", videoId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  it("(4) POST /api/shots/[id]/save refuses it, so it cannot enter a collection", async () => {
    // The route's own guard, against the row it would read:
    // `if (shot.visibility === "private" && shot.user_id !== user.id) 404`.
    const { data: shot } = await admin
      .from("shots")
      .select("visibility, user_id")
      .eq("id", shotId)
      .single();
    expect(shot?.visibility === "private" && shot?.user_id !== strangerId).toBe(true);

    // And the collection-item path reads the same columns through RLS, which
    // hands a stranger nothing to add in the first place.
    const { data: readable } = await strangerClient.from("shots").select("id").eq("id", shotId);
    expect(readable).toEqual([]);
  });

  /*
   * (5), found while the other four were being pinned: POST /api/shots/[id]/view
   * incremented `view_count` on any id at all, with no visibility check. It
   * leaks nothing — the response says only whether it counted — but view_count
   * is a number the library may one day rank by, and a signal a stranger can
   * write on a row they cannot even read is not a signal.
   */
  it("(5) the view counter refuses a private editorial row and still counts a public one", async () => {
    const { POST } = await import("@/app/api/shots/[id]/view/route");
    // A fresh address per call: the counter dedupes per viewer per shot per day,
    // so a shared one would make the second answer meaningless.
    const hit = async (id: string, ip: string) =>
      (
        await POST(
          new Request(`http://localhost/api/shots/${id}/view`, {
            method: "POST",
            headers: { "x-forwarded-for": ip },
          }),
          { params: Promise.resolve({ id }) }
        )
      ).json();

    const tag = Math.floor(Math.random() * 1e6);
    expect(await hit(shotId, `203.0.113.${tag % 254}`)).toEqual({ counted: false });
    const { data: refused } = await admin
      .from("shots")
      .select("view_count")
      .eq("id", shotId)
      .single();
    expect(refused?.view_count).toBe(0);

    // The same shot, public: the refusal above is about visibility and not
    // about the row being editorial or the counter being broken.
    await admin.from("shots").update({ visibility: "public" }).eq("id", shotId);
    try {
      expect(await hit(shotId, `203.0.114.${tag % 254}`)).toEqual({ counted: true });
      const { data: counted } = await admin
        .from("shots")
        .select("view_count")
        .eq("id", shotId)
        .single();
      expect(counted?.view_count).toBe(1);
    } finally {
      await admin
        .from("shots")
        .update({ visibility: "private", view_count: 0 })
        .eq("id", shotId);
    }
  });

  /*
   * The save ROUTE refuses this row, but the route is not the only way to get a
   * saved_shots row: its insert policy is `auth.uid() = user_id` and says
   * nothing about the shot, so a signed-in caller can write one for any id
   * straight through PostgREST. Making the corpus private does not close that —
   * `search_shots` decides the `saved` scope by membership, not by visibility.
   * The filter in searchShots is what closes it.
   */
  it("a stranger cannot force a saved_shots row at all, and gets nothing back from ?scope=saved", async () => {
    /*
     * Until 0032 the insert succeeded and only the product layer withheld the
     * row. The policy now refuses the write outright, so this asserts the
     * refusal and then proves the read is shut as well — placing the row with
     * the service role, so the read is still exercised if the write ever opens.
     */
    const { error } = await strangerClient
      .from("saved_shots")
      .insert({ user_id: strangerId, shot_id: shotId });
    expect(error?.code).toBe("42501");
    await admin.from("saved_shots").insert({ user_id: strangerId, shot_id: shotId });

    const { mod, restore } = await loadShotsWithFlag(undefined);
    try {
      const result = await mod.searchShots({ viewerId: strangerId, scope: "saved", limit: 96 });
      expect(result.shots.map((s) => s.id)).not.toContain(shotId);
      expect(result.total).toBe(0);
    } finally {
      restore();
      await admin.from("saved_shots").delete().eq("user_id", strangerId).eq("shot_id", shotId);
    }
  });

  /*
   * A tripwire, asserted as an exposure on purpose, the way the REST tests in
   * this file used to be.
   *
   * The filter above is application-side. `search_shots` itself is SECURITY
   * DEFINER and still returns a private row to anyone who has saved it, so a
   * caller going straight to `rpc/search_shots` with the anon key reads what
   * the product will not show them. The real fix is in SQL — the `saved` branch
   * has to require `s.visibility <> 'private' or s.user_id = v_viewer`, the way
   * every other branch checks visibility — and when it lands this test goes red
   * and is inverted into the guarantee rather than deleted.
   */
  it("search_shots itself refuses a saved private row, in SQL, not only in the product", async () => {
    /*
     * The tripwire this replaces asserted the leak while it was open: a save
     * was treated as an entitlement by the 'saved' scope. 0032 added the
     * visibility predicate the library branch always had. The row is placed
     * with the service role because the policy now refuses the client write,
     * so this tests the RPC rather than the policy.
     */
    await admin.from("saved_shots").insert({ user_id: strangerId, shot_id: shotId });
    try {
      const { data, error } = await strangerClient.rpc("search_shots", {
        p_query: null,
        p_embedding: null,
        p_filters: {},
        p_limit: 48,
        p_offset: 0,
        p_viewer: strangerId,
        p_scope: "saved",
      });
      expect(error).toBeNull();
      expect((data as { id: string }[]).map((row) => row.id)).not.toContain(shotId);
    } finally {
      await admin.from("saved_shots").delete().eq("user_id", strangerId).eq("shot_id", shotId);
    }
  });

  it("the defence-in-depth check is still on the surfaces that render a row", async () => {
    const { readFile } = await import("node:fs/promises");
    /*
     * These run before the visibility gate would ever matter again: they are
     * what covers the window after publish-editorial.ts and before the library
     * flag. A file that drops the call reopens exactly the leak that was
     * measured, and nothing else in this suite would notice.
     */
    for (const file of [
      "app/videos/[id]/page.tsx",
      "lib/collections.ts",
      "lib/export.ts",
      "app/api/videos/[id]/breakdown/route.ts",
      "app/api/videos/[id]/ai-recreation/route.ts",
    ]) {
      const source = await readFile(file, "utf8");
      // The call, not the import: deleting the call leaves the import behind,
      // and `toContain("editorialHidden")` was satisfied by that alone.
      expect(source, `${file} no longer calls editorialHidden`).toContain(
        "await editorialHidden("
      );
    }
  });
});
