/**
 * Adversarial security audit against a running instance.
 *
 * Everything here is an attack, not an assertion about the code: two real users
 * are created, one of them owns a segment, and the other tries to read it,
 * change it, and spend against it. What it proves cannot be proven by reading
 * the source, because it exercises RLS, the column-protection triggers, storage
 * policies and route order all at once.
 *
 *   npm run dev                                  # in another terminal
 *   npx tsx --env-file=.env.local scripts/security-audit.ts [baseUrl]
 *
 * Exits non-zero on any failure, so it can gate a deploy.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { UPLOAD_BUCKET } from "@/lib/constants";

const BASE = process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3002";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Distinctive, so a concurrent test run's users are never swept by this one. */
const TAG = `secaudit-${Date.now()}`;

/**
 * Checks that leave rows behind. On by default only against a local Supabase;
 * `--destructive` is the deliberate opt-in for anything else.
 */
const DESTRUCTIVE =
  /^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(SUPABASE_URL) ||
  process.argv.includes("--destructive");

let passed = 0;
const failures: string[] = [];

function section(name: string) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failures.push(name);
    console.log(
      `  \x1b[31m✗ ${name}\x1b[0m${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 240)}` : ""}`
    );
  }
}
function skip(name: string, why: string) {
  console.log(`  \x1b[33m-\x1b[0m ${name}  (skipped: ${why})`);
}

class Session {
  private cookies = new Map<string, string>();
  private absorb(res: Response) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      if (i === -1) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === "" || /Max-Age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  get authed(): boolean {
    return [...this.cookies.keys()].some((k) => k.startsWith("sb-"));
  }
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.set("cookie", cookie);
    const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
    this.absorb(res);
    return res;
  }
  async follow(path: string, hops = 5): Promise<Response> {
    let res = await this.fetch(path);
    let next = res.headers.get("location");
    while (next && hops-- > 0) {
      const rel = next.startsWith("http")
        ? new URL(next).pathname + new URL(next).search
        : next;
      res = await this.fetch(rel);
      next = res.headers.get("location");
    }
    return res;
  }
}

type Admin = ReturnType<typeof createAdminClient>;

async function signIn(admin: Admin, email: string): Promise<Session> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${BASE}/auth/callback` },
  });
  if (error || !data.properties) throw new Error(`generateLink: ${error?.message}`);
  const s = new Session();
  await s.follow(`/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`);
  return s;
}

/** A genuine user JWT, so PostgREST applies RLS and the triggers as it would in a browser. */
async function userJwt(admin: Admin, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) throw new Error(`generateLink jwt: ${error?.message}`);
  const anon = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: verifyError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError || !session.session) throw new Error(`verifyOtp: ${verifyError?.message}`);
  return session.session.access_token;
}

/**
 * Columns the pipeline owns. A client writing any of these is a defect: the
 * storage paths in particular are signed with the service role, so a client that
 * can set one can read any file in the bucket.
 */
const PROTECTED_VIDEO_COLUMNS: Record<string, unknown> = {
  status: "failed",
  progress: 3,
  shot_count: 99,
  analyzed_shot_count: 99,
  file_path: "someone-else/evil.mp4",
  duration_seconds: 999,
  segment_start: 111,
  segment_end: 222,
  source_duration_seconds: 333,
  breakdown: { forged: true },
  breakdown_status: "failed",
  breakdown_error: "forged",
  breakdown_prompt_version: "forged",
  poster_path: "someone-else/private.jpg",
  content_hash: "forged",
  size_bytes: 4242,
  width: 4242,
  height: 4242,
  aspect_ratio: "1:1",
  // Present only after migration 0028; skipped automatically when absent.
  ai_recreation: { forged: true },
  ai_recreation_status: "failed",
  ai_recreation_error: "forged",
};

const PROTECTED_SHOT_COLUMNS: Record<string, unknown> = {
  status: "failed",
  user_id: "00000000-0000-0000-0000-000000000000",
  start_seconds: 999,
  end_seconds: 1999,
  poster_path: "someone-else/private.jpg",
  thumbnail_path: "someone-else/private.jpg",
  metadata: { forged: true },
  representative_timestamp: 42,
  // Present only after migration 0029; skipped automatically when absent.
  motion_profile: { fps: 1, scores: [1] },
};

/** Fields the owner must keep control of. Blocking these would be a bug. */
const OWNER_WRITABLE_VIDEO: Record<string, unknown> = {
  title: "renamed by owner",
  focus: "my own question",
  visibility: "unlisted",
};

async function patchAs(jwt: string, table: string, id: string, patch: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
}

async function main() {
  const admin = createAdminClient();
  const ownerEmail = `${TAG}-owner@shotbreakdown.test`;
  const strangerEmail = `${TAG}-stranger@shotbreakdown.test`;

  const { data: o } = await admin.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
  });
  const { data: st } = await admin.auth.admin.createUser({
    email: strangerEmail,
    email_confirm: true,
  });
  const ownerId = o!.user!.id;
  const strangerId = st!.user!.id;

  try {
    section("1. Sessions");
    const owner = await signIn(admin, ownerEmail);
    const stranger = await signIn(admin, strangerEmail);
    const anon = new Session();
    check("owner signed in", owner.authed);
    check("stranger signed in", stranger.authed);

    section("2. Seed a private segment owned by one of them");
    const { data: video, error: videoError } = await admin
      .from("videos")
      .insert({
        user_id: ownerId,
        source_type: "video_upload",
        file_path: `${ownerId}/videos/seed/segment.mp4`,
        title: "OWNER PRIVATE SEGMENT",
        status: "complete",
        visibility: "private",
        duration_seconds: 10,
        shot_count: 1,
        analyzed_shot_count: 1,
        content_hash: `${TAG}`,
        focus: "OWNER ORIGINAL QUESTION",
        breakdown: { title: "OWNER SECRET BREAKDOWN" },
        breakdown_status: "ready",
        breakdown_error: "OWNER SECRET INTERNAL ERROR",
      })
      .select("id")
      .single();
    if (videoError || !video) throw new Error(`seed video: ${videoError?.message}`);
    const videoId = video.id as string;

    const { data: shot, error: shotError } = await admin
      .from("shots")
      .insert({
        video_id: videoId,
        user_id: ownerId,
        shot_index: 0,
        start_seconds: 0,
        end_seconds: 5,
        status: "complete",
        visibility: "private",
        title: "OWNER PRIVATE SHOT",
        poster_path: `${ownerId}/videos/seed/shots/0/frame.jpg`,
        thumbnail_path: `${ownerId}/videos/seed/shots/0/thumb.jpg`,
        metadata: { one_line_summary: "OWNER SECRET SUMMARY" },
      })
      .select("id")
      .single();
    if (shotError || !shot) throw new Error(`seed shot: ${shotError?.message}`);
    const shotId = shot.id as string;
    check("segment and shot seeded", true);

    section("3. A stranger, and an anonymous caller, against every route");
    const probes: { name: string; path: string; init?: RequestInit }[] = [
      { name: "GET video status", path: `/api/videos/${videoId}` },
      {
        name: "PATCH video",
        path: `/api/videos/${videoId}`,
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "HIJACKED", focus: "HIJACKED" }),
        },
      },
      { name: "DELETE video", path: `/api/videos/${videoId}`, init: { method: "DELETE" } },
      { name: "GET breakdown", path: `/api/videos/${videoId}/breakdown` },
      {
        name: "POST breakdown (spends money)",
        path: `/api/videos/${videoId}/breakdown`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ focus: "HIJACKED" }),
        },
      },
      {
        name: "POST ask (spends money)",
        path: `/api/videos/${videoId}/ask`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: "what is this" }),
        },
      },
      { name: "POST retry (spends money)", path: `/api/videos/${videoId}/retry`, init: { method: "POST" } },
      {
        name: "PATCH shot metadata",
        path: `/api/shots/${shotId}/metadata`,
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "HIJACKED", visibility: "public" }),
        },
      },
      { name: "GET export", path: `/api/exports?resourceType=video&resourceId=${videoId}&format=json` },
      { name: "GET segment page", path: `/videos/${videoId}` },
      { name: "GET shot page", path: `/shots/${shotId}` },
    ];

    const SECRETS = /OWNER SECRET|OWNER PRIVATE|OWNER ORIGINAL/;
    for (const label of ["stranger", "anonymous"] as const) {
      const who = label === "stranger" ? stranger : anon;
      for (const p of probes) {
        const res = await who.fetch(p.path, p.init);
        const body = await res.text();
        check(`${label} cannot read owner data via ${p.name}`, !SECRETS.test(body), {
          status: res.status,
          leaked: body.match(SECRETS)?.[0],
        });
      }
    }

    section("4. Nothing the attackers did actually changed anything");
    const { data: after } = await admin
      .from("videos")
      .select("title, focus, visibility, breakdown_status")
      .eq("id", videoId)
      .maybeSingle();
    check("the segment still exists", after !== null);
    check("title unchanged", after?.title === "OWNER PRIVATE SEGMENT", after?.title);
    check("focus unchanged", after?.focus === "OWNER ORIGINAL QUESTION", after?.focus);
    check("visibility still private", after?.visibility === "private", after?.visibility);

    const { data: shotAfter } = await admin
      .from("shots")
      .select("title, visibility")
      .eq("id", shotId)
      .maybeSingle();
    check("shot title unchanged", shotAfter?.title === "OWNER PRIVATE SHOT", shotAfter?.title);
    check("shot still private", shotAfter?.visibility === "private", shotAfter?.visibility);

    section("5. Pipeline-owned columns reject the OWNER's own client");
    const ownerJwt = await userJwt(admin, ownerEmail);
    for (const [column, value] of Object.entries(PROTECTED_VIDEO_COLUMNS)) {
      const res = await patchAs(ownerJwt, "videos", videoId, { [column]: value });
      const body = await res.text();
      if (res.status === 400 && /does not exist|schema cache|column/i.test(body) && !/pipeline-owned/i.test(body)) {
        skip(`videos.${column}`, "column not present in this schema yet");
        continue;
      }
      check(`videos.${column} is refused`, res.status !== 200, { status: res.status });
      if (res.status === 200) {
        // Put it back so later checks are not reasoning about corrupted state.
        await admin.from("videos").update({ [column]: null }).eq("id", videoId);
      }
    }
    for (const [column, value] of Object.entries(PROTECTED_SHOT_COLUMNS)) {
      const res = await patchAs(ownerJwt, "shots", shotId, { [column]: value });
      const body = await res.text();
      if (res.status === 400 && /does not exist|schema cache/i.test(body) && !/pipeline-owned/i.test(body)) {
        skip(`shots.${column}`, "column not present in this schema yet");
        continue;
      }
      check(`shots.${column} is refused`, res.status !== 200, { status: res.status });
    }

    section("6. But the owner keeps what is theirs");
    for (const [column, value] of Object.entries(OWNER_WRITABLE_VIDEO)) {
      const res = await patchAs(ownerJwt, "videos", videoId, { [column]: value });
      check(`videos.${column} is still writable by its owner`, res.status === 200, {
        status: res.status,
        body: (await res.text()).slice(0, 120),
      });
    }
    // metadata_edits is where a correction belongs; it must stay open.
    const corr = await patchAs(ownerJwt, "shots", shotId, {
      metadata_edits: { "composition.shot_size": "wide" },
    });
    check("shots.metadata_edits is still writable (corrections)", corr.status === 200, {
      status: corr.status,
    });

    section("7. Row level security, straight through PostgREST");
    const strangerJwt = await userJwt(admin, strangerEmail);
    for (const table of ["videos", "shots", "conversations", "collections", "saved_shots"]) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
        headers: { apikey: ANON_KEY, authorization: `Bearer ${strangerJwt}` },
      });
      const body = await res.text();
      check(`a stranger reads no owner rows from ${table}`, !SECRETS.test(body), {
        status: res.status,
        sample: body.slice(0, 120),
      });
    }

    /*
     * The editorial corpus must be unreadable with nothing but the key the
     * browser bundle ships. `visibility = 'public'` is what the `shots public
     * select` policy keys on and that policy is granted to `anon`, so this is
     * the only check that actually says whether the corpus is exposed — the
     * feature flag and the page code never run for this request. Expect zero
     * rows until scripts/publish-editorial.ts has been run at launch.
     */
    for (const table of ["shots", "videos"]) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?is_editorial=eq.true&select=id&limit=5`,
        { headers: { apikey: ANON_KEY } }
      );
      const rows = (await res.json().catch(() => [])) as unknown[];
      check(`the editorial corpus is unreadable anonymously in ${table}`, rows.length === 0, {
        status: res.status,
        rows: rows.length,
      });
    }

    section("8. Storage is private and per-user");
    const ownerObject = `${ownerId}/${TAG}-secret.txt`;
    await admin.storage
      .from(UPLOAD_BUCKET)
      .upload(ownerObject, new Blob(["OWNER SECRET FILE"], { type: "text/plain" }), {
        upsert: true,
        contentType: "text/plain",
      });
    const strangerStorage = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { authorization: `Bearer ${strangerJwt}` } },
    });

    const dl = await strangerStorage.storage.from(UPLOAD_BUCKET).download(ownerObject);
    const dlText = dl.data ? await dl.data.text() : "";
    check("a stranger cannot download another user's object", !dlText.includes("OWNER SECRET"), {
      error: dl.error?.message,
    });

    const up = await strangerStorage.storage
      .from(UPLOAD_BUCKET)
      .upload(`${ownerId}/${TAG}-planted.txt`, new Blob(["x"]), { contentType: "text/plain" });
    check("a stranger cannot write into another user's folder", up.error !== null, {
      path: up.data?.path,
    });

    const signed = await strangerStorage.storage
      .from(UPLOAD_BUCKET)
      .createSignedUrl(ownerObject, 60);
    check("a stranger cannot mint a signed URL for it", signed.error !== null, {
      url: signed.data?.signedUrl,
    });

    const pub = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${UPLOAD_BUCKET}/${ownerObject}`);
    check("the bucket is not public", pub.status >= 400, { status: pub.status });

    section("9. Redirects cannot be pointed off-site");
    /*
     * A bogus token short-circuits to the expired-link page before `next` is
     * ever read, so it proves nothing. Each probe needs its own REAL magic link,
     * because a token is single use.
     *
     * "Off-site" is judged by origin host, not by string prefix: the app
     * redirects to NEXT_PUBLIC_SITE_URL, whose host (localhost) legitimately
     * differs from the one under test (127.0.0.1).
     */
    const ownHosts = new Set(
      [BASE, process.env.NEXT_PUBLIC_SITE_URL ?? ""]
        .filter(Boolean)
        .map((u) => new URL(u).hostname)
        .concat(["localhost", "127.0.0.1"])
    );
    for (const evil of [
      "//evil.example.com",
      "https://evil.example.com",
      "/\\evil.example.com",
      "////evil.example.com",
      "/%2fevil.example.com",
      "https://evil.example.com/%2e%2e",
    ]) {
      const { data: fresh } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: ownerEmail,
        options: { redirectTo: `${BASE}/auth/callback` },
      });
      const token = fresh!.properties!.hashed_token;
      const res = await fetch(
        `${BASE}/auth/callback?next=${encodeURIComponent(evil)}&token_hash=${token}&type=magiclink`,
        { redirect: "manual" }
      );
      const loc = res.headers.get("location") ?? "";
      let offsite = false;
      if (/^https?:\/\//i.test(loc)) {
        try {
          offsite = !ownHosts.has(new URL(loc).hostname);
        } catch {
          offsite = true;
        }
      }
      const landedOnEvil = /evil\.example\.com/i.test(loc);
      check(`next=${evil} stays on this site`, !offsite && !landedOnEvil, { location: loc });
    }

    section("10. Hardening headers are actually served");
    const headerRes = await fetch(`${BASE}/`);
    const required: [string, RegExp][] = [
      ["x-frame-options", /DENY|SAMEORIGIN/i],
      ["x-content-type-options", /nosniff/i],
      ["referrer-policy", /strict-origin|no-referrer|same-origin/i],
      ["permissions-policy", /camera=\(\)/i],
    ];
    for (const [header, shape] of required) {
      const value = headerRes.headers.get(header) ?? "";
      check(`${header} is set`, shape.test(value), { value });
    }
    // The server must never advertise itself.
    check(
      "x-powered-by is not sent",
      !headerRes.headers.get("x-powered-by"),
      headerRes.headers.get("x-powered-by")
    );

    section("11. Unauthenticated callers cannot spend money");
    for (const [name, path, init] of [
      ["shot search", "/api/shots/search?q=test", undefined],
      [
        "shot ask",
        `/api/shots/${shotId}/ask`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: "hi" }),
        },
      ],
    ] as const) {
      const res = await fetch(`${BASE}${path}`, init as RequestInit);
      check(`anonymous ${name} is refused`, res.status === 401 || res.status === 404, {
        status: res.status,
      });
    }

    section("12. A signed-up stranger cannot spend without an inbox we reached");
    /*
     * The probe body is deliberately unusable: `filePath` does not start with
     * the caller's id, so POST /api/videos refuses it with 400 *after* the
     * verify-email guard, the two rate limits, the plan check and the daily
     * ceiling have all run. Nothing is inserted and no job is enqueued, so this
     * section is safe to point at production.
     */
    const probeSubmit = (session: Session, headers: Record<string, string> = {}) =>
      session.fetch("/api/videos", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ filePath: "not-your-folder/probe.mp4", sourceType: "video_upload" }),
      });

    /*
     * The hole this whole phase exists to close. With Supabase's "Confirm
     * email" off, `POST /auth/v1/signup` stamps `email_confirmed_at` itself and
     * returns a session in the same response, so the app-side guard sees a
     * confirmed user and lets it through — an address that does not exist gets
     * a model budget. The guard cannot detect that; only the dashboard toggle
     * stops the session being minted, which is why this check reads the auth
     * endpoint rather than a route.
     */
    const throwawayEmail = `${TAG}-throwaway@shotbreakdown.test`;
    const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: throwawayEmail, password: `${TAG}-Aa1!pass` }),
    });
    const signup = (await signupRes.json().catch(() => ({}))) as {
      access_token?: string;
      user?: { id?: string; email_confirmed_at?: string | null };
    };
    check(
      "a password sign-up for an address we never emailed gets no session",
      !signup.access_token,
      {
        hint: "Supabase → Auth → Providers → Email → Confirm email must be ON",
        email_confirmed_at: signup.user?.email_confirmed_at ?? null,
      }
    );
    if (signup.user?.id) await admin.auth.admin.deleteUser(signup.user.id).catch(() => {});

    const confirmed = await probeSubmit(owner);
    check("a confirmed session is not refused by the verify-email guard", confirmed.status !== 403, {
      status: confirmed.status,
    });

    /*
     * `ipKey` hashes the first hop of `x-forwarded-for` verbatim, so a value
     * unique to this run gives the check its own 24h bucket and the first
     * submit is meaningful. Two accounts alternate, both well under the
     * per-user 10/hour, so a refusal here can only be the address budget.
     */
    if (DESTRUCTIVE) {
      const address = `203.0.113.99-${TAG}`;
      const statuses: number[] = [];
      for (let i = 0; i < 13; i += 1) {
        const res = await probeSubmit(i % 2 === 0 ? owner : stranger, {
          "x-forwarded-for": address,
        });
        statuses.push(res.status);
      }
      check("the first submit from a fresh address is not rate limited", statuses[0] !== 429, {
        statuses,
      });
      check("the 13th submit from one address in a day is refused", statuses[12] === 429, {
        statuses,
      });
    } else {
      skip(
        "the 13th submit from one address in a day is refused",
        "spends a day's address budget and writes rate_limits rows; pass --destructive"
      );
    }
  } finally {
    await admin.auth.admin.deleteUser(ownerId).catch(() => {});
    await admin.auth.admin.deleteUser(strangerId).catch(() => {});
    await admin.storage.from(UPLOAD_BUCKET).remove([`${ownerId}/${TAG}-secret.txt`]).catch(() => {});
  }

  console.log(
    `\n${failures.length === 0 ? "\x1b[32m✓" : "\x1b[31m✗"} ${passed} passed, ${failures.length} failed\x1b[0m`
  );
  if (failures.length > 0) {
    console.log("\nfailed:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
