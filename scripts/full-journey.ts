/**
 * The whole product, once, for real.
 *
 * Uploads a segment of a longer file with a question attached, lets the real
 * pipeline trim it with ffmpeg and analyse it with Claude, then signs in as the
 * owner and reads the actual rendered pages. Nothing is seeded and nothing is
 * mocked: if this passes, the thing works.
 *
 *   npm run dev                                     # in another terminal
 *   npx tsx --env-file=.env.local scripts/full-journey.ts clip.mp4 [start] [end]
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createAdminClient } from "../lib/supabase/admin";
import { UPLOAD_BUCKET } from "../lib/constants";
import { drainQueue } from "../lib/pipeline/worker";
import { DEPARTMENTS, DEPARTMENT_LABELS, readSegmentBreakdown } from "../lib/validation";

const BASE = process.argv[2]?.startsWith("http")
  ? process.argv[2]
  : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3002");
const VIDEO = process.argv.find((a) => /\.(mp4|mov|m4v|webm|mkv)$/i.test(a));
const START = Number(process.env.SEGMENT_START ?? 4);
const END = Number(process.env.SEGMENT_END ?? 13);
const FOCUS =
  process.env.FOCUS ??
  "I'm the editor. Where does each cut land and what do I need shot long enough for?";

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
      `  \x1b[31m✗ ${name}\x1b[0m${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`
    );
  }
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
      const url = next.startsWith("http") ? new URL(next).pathname + new URL(next).search : next;
      res = await this.fetch(url);
      next = res.headers.get("location");
    }
    return res;
  }
}

async function main() {
  if (!VIDEO) {
    console.error("Pass a video path: npx tsx scripts/full-journey.ts clip.mp4");
    process.exit(1);
  }

  const admin = createAdminClient();
  const email = `full-journey+${Date.now()}@shotbreakdown.test`;
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (userError || !created.user) throw new Error(`createUser: ${userError?.message}`);
  const userId = created.user.id;

  try {
    step("1. Sign in the way a real user does");
    const { data: link } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${BASE}/auth/callback` },
    });
    const session = new Session();
    await session.follow(`/auth/callback?token_hash=${link!.properties!.hashed_token}&type=magiclink`);
    check("session established", session.authed);

    step("2. Upload the file and submit a trimmed segment with a question");
    const bytes = await readFile(VIDEO);
    const path = `${userId}/${Date.now()}-${basename(VIDEO)}`;
    const { error: uploadError } = await admin.storage
      .from(UPLOAD_BUCKET)
      .upload(path, bytes, { contentType: "video/mp4", upsert: true });
    check("source uploaded to private storage", !uploadError, uploadError?.message);

    const submit = await session.fetch("/api/videos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filePath: path,
        sourceType: "video_upload",
        title: basename(VIDEO).replace(/\.[^.]+$/, ""),
        sizeBytes: bytes.byteLength,
        segmentStart: START,
        segmentEnd: END,
        focus: FOCUS,
      }),
    });
    const submitted = (await submit.json()) as { videoId?: string; message?: string };
    check("the API accepted the segment", submit.ok && !!submitted.videoId, submitted);
    const videoId = submitted.videoId;
    if (!videoId) throw new Error("no videoId");

    step("3. Let the real pipeline run");
    const startedAt = Date.now();
    const drained = await drainQueue({ maxMs: 15 * 60_000, batchSize: 1 });
    console.log(
      `  worker: ${drained.done} jobs in ${Math.round((Date.now() - startedAt) / 1000)}s`
    );

    const { data: video } = await admin
      .from("videos")
      .select(
        "status, duration_seconds, source_duration_seconds, segment_start, segment_end, file_path, focus, shot_count, analyzed_shot_count, breakdown, breakdown_status, breakdown_error"
      )
      .eq("id", videoId)
      .single();

    check("the segment reached complete", video?.status === "complete", {
      status: video?.status,
    });
    check(
      `the analysed duration is the chosen range (${END - START}s)`,
      Math.abs(Number(video?.duration_seconds ?? 0) - (END - START)) <= 0.5,
      { got: video?.duration_seconds }
    );
    check(
      "the stored file is the trimmed segment",
      String(video?.file_path ?? "").endsWith("/segment.mp4"),
      { file_path: video?.file_path }
    );
    const { data: leftover } = await admin.storage.from(UPLOAD_BUCKET).list(userId, { limit: 100 });
    check(
      "the original upload was deleted",
      !(leftover ?? []).some((o) => o.name === basename(path)),
      (leftover ?? []).map((o) => o.name)
    );
    check("every shot was analysed", (video?.analyzed_shot_count ?? 0) === (video?.shot_count ?? 0), {
      analyzed: video?.analyzed_shot_count,
      total: video?.shot_count,
    });

    step("4. The breakdown");
    check("breakdown_status is ready", video?.breakdown_status === "ready", {
      status: video?.breakdown_status,
      error: video?.breakdown_error,
    });
    const breakdown = readSegmentBreakdown(video?.breakdown);
    check("it parses against the stored schema", !!breakdown);
    if (breakdown) {
      check(
        "all nine departments are present, in order",
        breakdown.departments.map((d) => d.role).join(",") === DEPARTMENTS.join(","),
        breakdown.departments.map((d) => d.role)
      );
      check(
        "one sequence entry per shot",
        breakdown.shot_sequence.length === (video?.shot_count ?? 0),
        { entries: breakdown.shot_sequence.length, shots: video?.shot_count }
      );
      check("it answers the question that was asked", breakdown.focus_answer.trim().length > 80, {
        length: breakdown.focus_answer.trim().length,
      });
      check(
        "the answer cites the shots",
        /shot\s*\d|0:\d\d/i.test(breakdown.focus_answer),
        breakdown.focus_answer.slice(0, 120)
      );
      console.log(`\n  title:   ${breakdown.title}`);
      console.log(`  crew:    ${breakdown.minimum_crew}`);
      console.log(`  asked:   ${FOCUS}`);
      console.log(`  answer:  ${breakdown.focus_answer.slice(0, 260)}…`);
    }

    step("5. The pages a user actually sees");
    const segmentPage = await session.fetch(`/videos/${videoId}`);
    const html = await segmentPage.text();
    check("the segment page renders", segmentPage.status === 200, { status: segmentPage.status });
    check("it shows the breakdown title", !!breakdown && html.includes(breakdown.title.slice(0, 30)));
    const shownDepartments = DEPARTMENTS.filter((d) => html.includes(DEPARTMENT_LABELS[d]));
    check(
      `it renders all nine department briefs (found ${shownDepartments.length})`,
      shownDepartments.length === DEPARTMENTS.length,
      DEPARTMENTS.filter((d) => !shownDepartments.includes(d))
    );
    check(
      "it states the segment was trimmed from a longer upload",
      /trimmed from/i.test(html),
      html.match(/trimmed from[^<]{0,60}/i)?.[0]
    );
    check("it shows the question that was asked", html.includes(FOCUS.slice(0, 40)));

    const listPage = await session.fetch("/videos");
    const listHtml = await listPage.text();
    check("the segments list renders", listPage.status === 200);
    check("the segment appears on it with a ready breakdown", /Breakdown ready/i.test(listHtml));

    const shotsPage = await session.fetch("/library");
    check("the shots browser renders", shotsPage.status === 200);

    step("6. Delete it");
    const del = await session.fetch(`/api/videos/${videoId}`, { method: "DELETE" });
    check("the segment deletes", del.ok, { status: del.status });
    const { data: objectsAfter } = await admin.storage.from(UPLOAD_BUCKET).list(
      `${userId}/videos/${videoId}`,
      { limit: 10 }
    );
    check("its storage is gone", (objectsAfter ?? []).length === 0, objectsAfter);
  } finally {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
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
