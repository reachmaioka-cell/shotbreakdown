/**
 * End-to-end pipeline proof against a real Supabase instance.
 *
 * Creates a real user, uploads a real video to real storage, TRIMS it to a
 * segment the way a real upload does, runs the real worker, and asserts that
 * real shots and a real nine-department segment breakdown come out the other
 * end. Nothing here is mocked.
 *
 *   npx tsx --env-file=.env.local scripts/pipeline-smoke.ts clip.mp4
 *   SEGMENT_START=3 SEGMENT_END=9 FOCUS="how was this lit?" npx tsx ... clip.mp4
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createAdminClient } from "../lib/supabase/admin";
import { enqueueJob } from "../lib/pipeline/queue";
import { drainQueue } from "../lib/pipeline/worker";
import { UPLOAD_BUCKET } from "../lib/constants";

const VIDEO = process.argv[2];
/** Set both to prove the server-side trim; leave unset to analyse the whole file. */
const SEGMENT_START = process.env.SEGMENT_START ? Number(process.env.SEGMENT_START) : null;
const SEGMENT_END = process.env.SEGMENT_END ? Number(process.env.SEGMENT_END) : null;
const FOCUS = process.env.FOCUS ?? null;

function log(step: string, detail?: unknown) {
  console.log(`\x1b[36m▸\x1b[0m ${step}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ""}`);
}

function fail(message: string): never {
  console.error(`\x1b[31m✗ ${message}\x1b[0m`);
  process.exit(1);
}

async function main() {
  if (!VIDEO) fail("Pass a video path: npx tsx scripts/pipeline-smoke.ts clip.mp4");

  const admin = createAdminClient();
  const email = `pipeline-smoke+${Date.now()}@shotbreakdown.test`;

  log("creating test user", { email });
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (userError || !created.user) fail(`could not create user: ${userError?.message}`);
  const userId = created.user.id;

  try {
    const bytes = await readFile(VIDEO);
    const path = `${userId}/${Date.now()}-${basename(VIDEO)}`;
    log("uploading source", { path, mb: (bytes.byteLength / 1024 / 1024).toFixed(1) });

    const { error: uploadError } = await admin.storage
      .from(UPLOAD_BUCKET)
      .upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (uploadError) fail(`upload failed: ${uploadError.message}`);

    const { data: video, error: videoError } = await admin
      .from("videos")
      .insert({
        user_id: userId,
        source_type: "video_upload",
        file_path: path,
        title: basename(VIDEO),
        status: "queued",
        size_bytes: bytes.byteLength,
        content_hash: `file:${path}:${SEGMENT_START ?? 0}-${SEGMENT_END ?? "end"}`,
        segment_start: SEGMENT_START,
        segment_end: SEGMENT_END,
        focus: FOCUS,
      })
      .select("id")
      .single();
    if (videoError || !video) fail(`video insert failed: ${videoError?.message}`);

    log("queued", { videoId: video.id });
    await enqueueJob("ingest_video", { videoId: video.id }, {
      videoId: video.id,
      userId,
      dedupeKey: `ingest:${video.id}`,
    });

    const startedAt = Date.now();
    const result = await drainQueue({ maxMs: 15 * 60_000, batchSize: 1 });
    log("worker finished", { ...result, seconds: Math.round((Date.now() - startedAt) / 1000) });

    const { data: finalVideo } = await admin
      .from("videos")
      .select(
        "status, shot_count, analyzed_shot_count, duration_seconds, width, height, aspect_ratio, error_message, file_path, focus, segment_start, segment_end, source_duration_seconds, breakdown, breakdown_status, breakdown_error"
      )
      .eq("id", video.id)
      .single();
    log("video", finalVideo);

    const { data: shots } = await admin
      .from("shots")
      .select(
        "shot_index, start_seconds, end_seconds, duration_seconds, status, shot_size, movement_type, lighting_key, time_of_day, moods, dominant_colors, thumbnail_path, summary, error_message"
      )
      .eq("video_id", video.id)
      .order("shot_index");

    const { count: frameCount } = await admin
      .from("shot_frames")
      .select("id", { count: "exact", head: true })
      .eq("video_id", video.id);

    const { count: embedded } = await admin
      .from("shots")
      .select("id", { count: "exact", head: true })
      .eq("video_id", video.id)
      .not("embedding", "is", null);

    console.log("\nSHOTS");
    console.table(
      (shots ?? []).map((s) => ({
        i: s.shot_index,
        range: `${Number(s.start_seconds).toFixed(1)}–${Number(s.end_seconds).toFixed(1)}`,
        status: s.status,
        size: s.shot_size,
        move: s.movement_type,
        key: s.lighting_key,
        tod: s.time_of_day,
        thumb: s.thumbnail_path ? "yes" : "NO",
        summary: (s.summary ?? s.error_message ?? "").slice(0, 46),
      }))
    );

    const complete = (shots ?? []).filter((s) => s.status === "complete").length;
    console.log(`\nframes stored: ${frameCount}  embedded shots: ${embedded}/${shots?.length ?? 0}`);

    const problems: string[] = [];
    if (finalVideo?.status !== "complete") problems.push(`video status is ${finalVideo?.status}`);
    if (!shots || shots.length === 0) problems.push("no shots were created");
    if (complete !== (shots?.length ?? 0)) problems.push(`${complete}/${shots?.length} shots complete`);
    if ((embedded ?? 0) !== (shots?.length ?? 0)) problems.push("not every shot has an embedding");
    if ((frameCount ?? 0) < (shots?.length ?? 0)) problems.push("fewer frames than shots");
    if ((shots ?? []).some((s) => !s.thumbnail_path)) problems.push("a shot has no thumbnail");
    if ((shots ?? []).some((s) => s.status === "complete" && !s.shot_size)) {
      problems.push("a completed shot has no facets");
    }

    // The trim: the stored object must BE the segment, the original must be gone,
    // and the analysed duration must match what was asked for.
    if (SEGMENT_START !== null && SEGMENT_END !== null) {
      const expected = SEGMENT_END - SEGMENT_START;
      const actual = Number(finalVideo?.duration_seconds ?? 0);
      if (Math.abs(actual - expected) > 0.5) {
        problems.push(`segment is ${actual.toFixed(2)}s, asked for ${expected}s`);
      }
      if (!String(finalVideo?.file_path ?? "").endsWith("/segment.mp4")) {
        problems.push(`file_path is ${finalVideo?.file_path}, expected a trimmed segment.mp4`);
      }
      const { data: leftover } = await admin.storage
        .from(UPLOAD_BUCKET)
        .list(`${userId}`, { limit: 100 });
      if ((leftover ?? []).some((o) => o.name === basename(path))) {
        problems.push("the original upload was not deleted after trimming");
      }
      const sourceDuration = Number(finalVideo?.source_duration_seconds ?? 0);
      if (!(sourceDuration > expected)) {
        problems.push(`source_duration_seconds is ${sourceDuration}, expected the full file`);
      }
      log("trim verified", {
        segment: `${SEGMENT_START}-${SEGMENT_END}`,
        analysed: actual.toFixed(2),
        sourceWas: sourceDuration.toFixed(2),
      });
    }

    // The breakdown is the product. It must exist, cover all nine departments,
    // and carry one sequence entry per shot.
    const { readSegmentBreakdown, DEPARTMENTS } = await import("../lib/validation");
    if (finalVideo?.breakdown_status !== "ready") {
      problems.push(
        `breakdown_status is ${finalVideo?.breakdown_status}${finalVideo?.breakdown_error ? `: ${finalVideo.breakdown_error}` : ""}`
      );
    }
    const breakdown = readSegmentBreakdown(finalVideo?.breakdown);
    if (!breakdown) {
      problems.push("videos.breakdown is missing or does not match the stored schema");
    } else {
      const roles = breakdown.departments.map((d) => d.role);
      const missing = DEPARTMENTS.filter((d) => !roles.includes(d));
      if (missing.length > 0) problems.push(`breakdown missing departments: ${missing.join(", ")}`);
      if (roles.length !== DEPARTMENTS.length) {
        problems.push(`breakdown has ${roles.length} departments, expected ${DEPARTMENTS.length}`);
      }
      if (breakdown.shot_sequence.length !== (shots?.length ?? 0)) {
        problems.push(
          `shot_sequence has ${breakdown.shot_sequence.length} entries for ${shots?.length} shots`
        );
      }
      const outOfOrder = breakdown.shot_sequence.some(
        (s, i, arr) => i > 0 && s.shot_index <= arr[i - 1].shot_index
      );
      if (outOfOrder) problems.push("shot_sequence is not in ascending shot order");
      if (!breakdown.what_happens.trim()) problems.push("breakdown has no what_happens");
      if (!breakdown.title.trim()) problems.push("breakdown has no title");
      if (FOCUS && !breakdown.focus_answer.trim()) {
        problems.push("a focus was given but focus_answer is empty");
      }
      if (!FOCUS && breakdown.focus_answer.trim()) {
        problems.push("no focus was given but focus_answer is populated");
      }

      console.log("\nBREAKDOWN");
      console.log(`  title:      ${breakdown.title}`);
      console.log(`  difficulty: ${breakdown.difficulty}   crew: ${breakdown.minimum_crew}`);
      console.log(`  happens:    ${breakdown.what_happens.slice(0, 160)}`);
      if (FOCUS) {
        console.log(`  asked:      ${FOCUS}`);
        console.log(`  answered:   ${breakdown.focus_answer.slice(0, 300)}`);
      }
      console.table(
        breakdown.departments.map((d) => ({
          role: d.role,
          steps: d.steps.length,
          gear: d.gear.length,
          pitfalls: d.pitfalls.length,
          headline: d.headline.slice(0, 62),
        }))
      );
      console.log("\nSHOT SEQUENCE");
      console.table(
        breakdown.shot_sequence.map((s) => ({
          i: s.shot_index,
          tc: s.timecode,
          happens: s.what_happens.slice(0, 46),
          made: s.how_it_was_made.slice(0, 40),
          cut: s.cut_note.slice(0, 34),
        }))
      );
    }

    // Semantic search over what we just indexed.
    const { embed } = await import("../lib/embeddings");
    const vector = await embed("wide daylight exterior landscape");
    const { data: matches, error: matchError } = await admin.rpc("match_shots", {
      query_embedding: vector,
      match_k: 3,
      p_user_id: userId,
    });
    if (matchError) problems.push(`match_shots failed: ${matchError.message}`);
    log("semantic search hits", (matches ?? []).length);

    if (problems.length > 0) {
      console.error(`\n\x1b[31m✗ ${problems.length} problem(s):\x1b[0m`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exitCode = 1;
    } else {
      console.log(
        `\n\x1b[32m✓ pipeline healthy — ${shots?.length} shots analysed and indexed, breakdown written across ${breakdown?.departments.length} departments\x1b[0m`
      );
    }
  } finally {
    if (!process.env.KEEP_SMOKE_DATA) {
      log("cleaning up");
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    } else {
      log("keeping data", { userId });
    }
  }
}

main().catch((e) => fail(e instanceof Error ? e.stack ?? e.message : String(e)));
