/**
 * The segment surface, over real HTTP, with a real signed-in session.
 *
 * Proves the parts a unit test cannot: that the segment cap is enforced by the
 * SERVER regardless of the client, that a stranger cannot read or spend against
 * someone else's segment, and that the breakdown routes behave for the owner.
 *
 * Fast by design — it seeds an already-analysed segment straight into the
 * database rather than paying for a real analysis. scripts/pipeline-smoke.ts is
 * the one that exercises ffmpeg and Claude for real.
 *
 *   npm run dev                                   # in another terminal
 *   npx tsx --env-file=.env.local scripts/segment-journey.ts [baseUrl]
 */
import { createAdminClient } from "../lib/supabase/admin";
import { SEGMENT_PROMPT_VERSION } from "../lib/prompts/segment";
import {
  DEPARTMENTS,
  SEGMENT_BREAKDOWN_VERSION,
  readSegmentBreakdown,
  type StoredSegmentBreakdown,
} from "../lib/validation";
import { planLimits } from "../lib/plans";

const BASE = process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3002";

let passed = 0;
let failed = 0;

function step(name: string) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    console.log(
      `  \x1b[31m✗ ${name}\x1b[0m${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`
    );
  }
}

/** Minimal cookie jar so a session survives across requests like a browser. */
class Session {
  private cookies = new Map<string, string>();

  private absorb(res: Response) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      if (index === -1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
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
      // The app redirects to NEXT_PUBLIC_SITE_URL, whose host may differ from
      // the one under test (localhost vs 127.0.0.1). Keep only the path so the
      // session stays on the server we are actually exercising.
      const relative = next.startsWith("http")
        ? new URL(next).pathname + new URL(next).search
        : next;
      res = await this.fetch(relative);
      next = res.headers.get("location");
    }
    return res;
  }
}

async function signIn(admin: ReturnType<typeof createAdminClient>, email: string) {
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${BASE}/auth/callback` },
  });
  if (error || !link.properties) throw new Error(`generateLink: ${error?.message}`);
  const session = new Session();
  await session.follow(
    `/auth/callback?token_hash=${link.properties.hashed_token}&type=magiclink`
  );
  return session;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

async function main() {
  const admin = createAdminClient();
  const stamp = Date.now();
  const ownerEmail = `segment-journey+${stamp}@shotbreakdown.test`;
  const strangerEmail = `segment-stranger+${stamp}@shotbreakdown.test`;

  const { data: ownerUser } = await admin.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
  });
  const { data: strangerUser } = await admin.auth.admin.createUser({
    email: strangerEmail,
    email_confirm: true,
  });
  const ownerId = ownerUser?.user?.id;
  const strangerId = strangerUser?.user?.id;
  if (!ownerId || !strangerId) throw new Error("could not create test users");

  const free = planLimits("free");

  try {
    step("1. Sign in");
    const owner = await signIn(admin, ownerEmail);
    check("owner session established", owner.authed);
    const stranger = await signIn(admin, strangerEmail);
    check("stranger session established", stranger.authed);

    step("2. The server enforces the segment cap, whatever the client sends");
    const overCap = await owner.fetch("/api/videos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filePath: `${ownerId}/fake-over-cap.mp4`,
        sourceType: "video_upload",
        title: "over cap",
        segmentStart: 0,
        segmentEnd: free.maxVideoSeconds + 30,
      }),
    });
    check(
      `a ${free.maxVideoSeconds + 30}s range is rejected on a ${free.maxVideoSeconds}s plan`,
      overCap.status === 400,
      { status: overCap.status, body: await overCap.clone().text() }
    );

    const inverted = await owner.fetch("/api/videos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filePath: `${ownerId}/fake-inverted.mp4`,
        sourceType: "video_upload",
        title: "inverted",
        segmentStart: 20,
        segmentEnd: 5,
      }),
    });
    check("an end-before-start range is rejected", inverted.status === 400, {
      status: inverted.status,
    });

    step("3. Flagged-off ingest paths are refused");
    const link = await owner.fetch("/api/videos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    });
    check("a pasted link is rejected while FEATURE_LINK_SOURCES is off", link.status === 400, {
      status: link.status,
    });

    const still = await owner.fetch("/api/videos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filePath: `${ownerId}/fake.jpg`,
        sourceType: "frame_upload",
        title: "still",
      }),
    });
    check("a still upload is rejected while FEATURE_STILL_UPLOADS is off", still.status === 400, {
      status: still.status,
    });

    step("4. Seed an analysed segment with a breakdown");
    const { data: video, error: videoError } = await admin
      .from("videos")
      .insert({
        user_id: ownerId,
        source_type: "video_upload",
        file_path: `${ownerId}/videos/seeded/segment.mp4`,
        title: "Kitchen argument",
        status: "complete",
        duration_seconds: 12,
        source_duration_seconds: 95,
        segment_start: 40,
        segment_end: 52,
        focus: "How was the key light done?",
        shot_count: 2,
        analyzed_shot_count: 2,
        content_hash: `file:seeded:${stamp}`,
      })
      .select("id")
      .single();
    if (videoError || !video) throw new Error(`seed video: ${videoError?.message}`);
    const videoId = video.id as string;

    for (const i of [0, 1]) {
      const { error } = await admin.from("shots").insert({
        video_id: videoId,
        user_id: ownerId,
        shot_index: i,
        start_seconds: i * 6,
        end_seconds: (i + 1) * 6,
        status: "complete",
        title: `Shot ${i + 1}`,
        metadata: { one_line_summary: `Seeded shot ${i + 1}`, description: "Seeded." },
      });
      if (error) throw new Error(`seed shot ${i}: ${error.message}`);
    }
    check("segment seeded with two complete shots", true);

    step("5. The breakdown route, before a breakdown exists");
    const missing = await json<{ status?: string; breakdown?: unknown }>(
      await owner.fetch(`/api/videos/${videoId}/breakdown`)
    );
    check("owner sees status 'missing'", missing.status === "missing", missing);
    check("no breakdown is returned", missing.breakdown === null, missing);

    const strangerGet = await stranger.fetch(`/api/videos/${videoId}/breakdown`);
    check("a stranger cannot read a private segment's breakdown", strangerGet.status === 404, {
      status: strangerGet.status,
    });

    const strangerPost = await stranger.fetch(`/api/videos/${videoId}/breakdown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ focus: "steal the owner's budget" }),
    });
    check("a stranger cannot spend the owner's generation budget", strangerPost.status === 404, {
      status: strangerPost.status,
    });

    const { data: afterStranger } = await admin
      .from("videos")
      .select("focus")
      .eq("id", videoId)
      .single();
    check(
      "the stranger's POST did not rewrite the owner's question",
      afterStranger?.focus === "How was the key light done?",
      afterStranger
    );

    step("6. Write a breakdown and read it back");
    // Typed as the stored document on purpose: if the shape moves again, this
    // seed stops compiling instead of quietly seeding a row the page cannot read.
    const breakdown: StoredSegmentBreakdown = {
      version: SEGMENT_BREAKDOWN_VERSION,
      prompt_version: SEGMENT_PROMPT_VERSION,
      focus: "How was the key light done?",
      generated_at: new Date().toISOString(),
      title: "Kitchen argument, two-shot coverage",
      what_happens: "Two people argue across the counter of a small domestic kitchen at night.",
      focus_answer: "A single soft source camera-left, bounced off the ceiling.",
      technique: {
        name: "Shot-reverse coverage under one bounced source; no trick.",
        evidence:
          "The key wraps the same way and the shadows fall to the same side in both shots, so one source served both setups.",
        routes: [
          {
            name: "In camera: one bounced source, two setups",
            when: "You have one light and a white ceiling.",
            steps: [
              "Rig one 1K tungsten [or a 100W LED panel] camera-left, aimed at the ceiling above the counter.",
              "Shoot shot 1 on the MCU, then turn around for shot 2 without moving the light.",
              "Cut on the turn so the eyelines cross the counter.",
            ],
            gives_up: "",
          },
        ],
      },
      shot_sequence: [0, 1].map((i) => ({
        shot_index: i,
        timecode: `0:0${i * 6}-0:${(i + 1) * 6}`,
        what_happens: `Beat ${i + 1}.`,
        how_it_was_made: "MCU, eye level, static.",
        cut_note: i === 0 ? "Cuts out on the look." : "Cuts in on the reply.",
      })),
      departments: DEPARTMENTS.map((role) => ({
        role,
        headline: `${role} headline.`,
        steps: role === "camera" ? ["Lock off on sticks."] : [],
        pitfalls: [],
      })),
      difficulty: "moderate",
      crew: "4: operator, gaffer, two performers.",
      kit: {
        minimum: "A phone on a tripod and a bounce board; loses the soft wrap.",
        full: "Mirrorless body, 35mm and 50mm primes, one 1K with a bounce.",
      },
    };
    const { error: writeError } = await admin
      .from("videos")
      .update({
        breakdown,
        breakdown_status: "ready",
        breakdown_prompt_version: SEGMENT_PROMPT_VERSION,
        breakdown_generated_at: breakdown.generated_at,
      })
      .eq("id", videoId);
    if (writeError) throw new Error(`write breakdown: ${writeError.message}`);

    const ready = await json<{ status?: string; breakdown?: unknown }>(
      await owner.fetch(`/api/videos/${videoId}/breakdown`)
    );
    check("owner sees status 'ready'", ready.status === "ready", { status: ready.status });
    const readBack = readSegmentBreakdown(ready.breakdown);
    check("the breakdown parses against the stored schema", !!readBack);
    check(
      "all nine departments come back, in canonical order",
      readBack?.departments.map((d) => d.role).join(",") === DEPARTMENTS.join(","),
      { got: readBack?.departments.map((d) => d.role) }
    );
    check("the focus answer survives the round trip", !!readBack?.focus_answer);
    const technique = readBack?.technique;
    check("the technique is named", !!technique?.name.trim(), { name: technique?.name });
    check("it carries at least one route", (technique?.routes.length ?? 0) >= 1, {
      routes: technique?.routes.map((r) => r.name),
    });
    check(
      "the first route is a complete recipe (three or more steps)",
      (technique?.routes[0]?.steps.length ?? 0) >= 3,
      { steps: technique?.routes[0]?.steps.length ?? 0 }
    );

    step("7. The status endpoint carries the segment fields");
    const status = await json<{
      video?: Record<string, unknown>;
      breakdown?: unknown;
    }>(await owner.fetch(`/api/videos/${videoId}`));
    check("focus is exposed", status.video?.focus === "How was the key light done?", status.video);
    check("segment range is exposed", Number(status.video?.segment_start) === 40, status.video);
    check(
      "the original duration is exposed",
      Number(status.video?.source_duration_seconds) === 95,
      status.video
    );
    check("breakdown_status is exposed", status.video?.breakdown_status === "ready");

    step("8. The owner can rewrite their own question; the trigger allows it");
    const patch = await owner.fetch(`/api/videos/${videoId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ focus: "Actually, focus on the cut." }),
    });
    check("PATCH succeeds for the owner", patch.ok, { status: patch.status });
    const { data: patched } = await admin
      .from("videos")
      .select("focus")
      .eq("id", videoId)
      .single();
    check("the new question is stored", patched?.focus === "Actually, focus on the cut.", patched);

    const strangerPatch = await stranger.fetch(`/api/videos/${videoId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ focus: "hijacked" }),
    });
    check("a stranger cannot PATCH someone else's segment", strangerPatch.status === 404, {
      status: strangerPatch.status,
    });

    step("9. A client cannot forge a breakdown");
    // The column-protection trigger is the real guard here, so exercise it the
    // way an attacker would: a genuine authenticated session writing directly
    // to PostgREST, not the service role.
    const { createClient: createUserClient } = await import("@supabase/supabase-js");
    const { data: otpLink } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: ownerEmail,
    });
    const userClient = createUserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: verified, error: verifyError } = await userClient.auth.verifyOtp({
      token_hash: otpLink!.properties!.hashed_token,
      type: "magiclink",
    });
    check("owner obtained a real authenticated session", !!verified?.session && !verifyError, {
      error: verifyError?.message,
    });

    const forgedBreakdown = await userClient
      .from("videos")
      .update({ breakdown: { title: "forged" } })
      .eq("id", videoId);
    check(
      "an authenticated client cannot write videos.breakdown",
      forgedBreakdown.error !== null,
      { error: forgedBreakdown.error?.message ?? "WRITE WAS ALLOWED" }
    );

    // The trigger fires on a CHANGE, so the probe must write a different value
    // than the row already holds ('ready', set in step 6). Writing 'ready' over
    // 'ready' raises nothing and would look like a pass.
    const forgedStatus = await userClient
      .from("videos")
      .update({ breakdown_status: "failed" })
      .eq("id", videoId);
    check(
      "an authenticated client cannot write videos.breakdown_status",
      forgedStatus.error !== null,
      { error: forgedStatus.error?.message ?? "WRITE WAS ALLOWED" }
    );

    const forgedRange = await userClient
      .from("videos")
      .update({ segment_start: 0, segment_end: 9999 })
      .eq("id", videoId);
    check("an authenticated client cannot widen its own segment range", forgedRange.error !== null, {
      error: forgedRange.error?.message ?? "WRITE WAS ALLOWED",
    });

    const ownFocus = await userClient
      .from("videos")
      .update({ focus: "my own question, written directly" })
      .eq("id", videoId);
    check("but the owner CAN still write their own question", ownFocus.error === null, {
      error: ownFocus.error?.message,
    });

    step("10. Ask about the segment is owner-only");
    const strangerAsk = await stranger.fetch(`/api/videos/${videoId}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What lens?" }),
    });
    check("a stranger cannot ask about someone else's segment", strangerAsk.status === 404, {
      status: strangerAsk.status,
    });

    step("11. Export carries the breakdown");
    const freeExport = await owner.fetch(
      `/api/exports?resourceType=video&resourceId=${videoId}&format=json`
    );
    check("export is refused on the free plan", freeExport.status === 402, {
      status: freeExport.status,
    });

    await admin.from("profiles").update({ plan: "pro" }).eq("id", ownerId);
    const exported = await owner.fetch(
      `/api/exports?resourceType=video&resourceId=${videoId}&format=json`
    );
    if (exported.ok) {
      const text = await exported.text();
      const parsed = JSON.parse(text) as {
        breakdown?: { departments?: unknown[]; technique?: { name?: string } };
      };
      check(
        "the JSON export includes the breakdown",
        (parsed.breakdown?.departments?.length ?? 0) === DEPARTMENTS.length,
        { got: parsed.breakdown?.departments?.length }
      );
      check("the export carries the technique", !!parsed.breakdown?.technique?.name, {
        technique: parsed.breakdown?.technique,
      });
    } else {
      check("the JSON export includes the breakdown", false, { status: exported.status });
    }

    step("12. Deleting the segment removes it");
    const del = await owner.fetch(`/api/videos/${videoId}`, { method: "DELETE" });
    check("owner can delete their segment", del.ok, { status: del.status });
    const { data: gone } = await admin
      .from("videos")
      .select("id")
      .eq("id", videoId)
      .maybeSingle();
    check("the segment row is gone", gone === null);
  } finally {
    await admin.auth.admin.deleteUser(ownerId).catch(() => {});
    await admin.auth.admin.deleteUser(strangerId).catch(() => {});
  }

  console.log(
    `\n${failed === 0 ? "\x1b[32m✓" : "\x1b[31m✗"} ${passed} passed, ${failed} failed\x1b[0m\n`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
