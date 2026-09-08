/**
 * Measure motion for shots ingested before the profile existed. No AI — one
 * ffmpeg pass per stored segment, sliced to each shot.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-motion.ts [--force] [videoId ...]
 *
 * Shots that already carry a profile are left alone unless --force.
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { UPLOAD_BUCKET } from "../lib/constants";
import { createAdminClient } from "../lib/supabase/admin";
import { measureMotion, probeVideo, SCENE_SAMPLE_FPS } from "../lib/video/ffmpeg";
import { compactMotion, motionSampleRate, sliceMotion } from "../lib/video/motion";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const IDS = args.filter((a) => a !== "--force");
const MAX_SAMPLES = 240;

type Admin = ReturnType<typeof createAdminClient>;

async function downloadSegment(admin: Admin, filePath: string, dir: string): Promise<string> {
  const { data, error } = await admin.storage.from(UPLOAD_BUCKET).createSignedUrl(filePath, 600);
  if (error || !data) throw new Error(`sign ${filePath}: ${error?.message}`);
  const res = await fetch(data.signedUrl);
  if (!res.ok || !res.body) throw new Error(`download ${filePath}: ${res.status}`);
  const target = join(dir, "segment");
  await streamPipeline(Readable.fromWeb(res.body as never), createWriteStream(target));
  return target;
}

async function main() {
  const admin = createAdminClient();
  // Only an uploaded clip has a timeline; a still or a pasted link has one
  // frame and nothing to measure.
  let query = admin
    .from("videos")
    .select("id, file_path")
    .eq("source_type", "video_upload")
    .not("file_path", "is", null);
  if (IDS.length > 0) query = query.in("id", IDS);
  const { data: videos, error } = await query;
  if (error) throw new Error(error.message);
  console.log(`${videos?.length ?? 0} videos with a stored segment`);

  for (const video of videos ?? []) {
    let shotsQuery = admin
      .from("shots")
      .select("id, shot_index, start_seconds, end_seconds, motion_profile")
      .eq("video_id", video.id)
      .order("shot_index");
    if (!FORCE) shotsQuery = shotsQuery.is("motion_profile", null);
    const { data: shots, error: shotsError } = await shotsQuery;
    if (shotsError) {
      console.error(`  ${video.id}: ${shotsError.message}`);
      continue;
    }
    const { count: total } = await admin
      .from("shots")
      .select("id", { count: "exact", head: true })
      .eq("video_id", video.id);
    const skipped = (total ?? 0) - (shots?.length ?? 0);
    if (!shots || shots.length === 0) {
      console.log(`  ${video.id}: 0 shots written, ${skipped} skipped`);
      continue;
    }

    const dir = await mkdtemp(join(tmpdir(), "sb-motion-"));
    try {
      const local = await downloadSegment(admin, video.file_path as string, dir);
      // The same rate and boundary margin ingest uses, so a backfilled row is
      // indistinguishable from a freshly ingested one.
      const probe = await probeVideo(local);
      const series = await measureMotion(local, { fps: motionSampleRate(probe.fps) });
      const margin = Math.ceil(series.fps / SCENE_SAMPLE_FPS);
      let written = 0;
      for (const shot of shots) {
        const profile = compactMotion(
          sliceMotion(series, Number(shot.start_seconds), Number(shot.end_seconds), margin),
          MAX_SAMPLES
        );
        const { error: updateError } = await admin
          .from("shots")
          .update({ motion_profile: profile })
          .eq("id", shot.id);
        if (updateError) {
          console.error(`  shot update failed ${shot.id}: ${updateError.message}`);
          continue;
        }
        written += 1;
      }
      console.log(`  ${video.id}: ${written} shots written, ${skipped} skipped`);
    } catch (e) {
      console.error(`  ${video.id}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
