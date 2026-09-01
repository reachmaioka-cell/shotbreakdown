/**
 * End-to-end pipeline proof against a real Supabase instance.
 *
 * Creates a real user, uploads a real video to real storage, runs the real
 * worker, and asserts that real shots with real metadata and real embeddings
 * come out the other end. Nothing here is mocked.
 *
 *   npx tsx --env-file=.env.local scripts/pipeline-smoke.ts [path/to/video.mp4]
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createAdminClient } from "../lib/supabase/admin";
import { enqueueJob } from "../lib/pipeline/queue";
import { drainQueue } from "../lib/pipeline/worker";
import { UPLOAD_BUCKET } from "../lib/constants";

const VIDEO = process.argv[2];

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
        content_hash: `file:${path}`,
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
      .select("status, shot_count, analyzed_shot_count, duration_seconds, width, height, aspect_ratio, error_message")
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
      console.log(`\n\x1b[32m✓ pipeline healthy — ${shots?.length} shots analysed and indexed\x1b[0m`);
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
