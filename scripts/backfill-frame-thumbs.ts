/**
 * Replace YouTube custom-upload posters (hqdefault / maxresdefault artwork)
 * with auto-generated clip stills (sd1, hq1, 0.jpg). No AI — URL rewrite only.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-frame-thumbs.ts
 */
import { extractYoutubeId, isYoutubeBrandedPoster, youtubeFrameStillCandidates } from "../lib/clip";
import { usableYoutubeThumb } from "../lib/source";
import { createAdminClient } from "../lib/supabase/admin";

async function pickFrameStill(sourceUrl: string | null, stored: string | null): Promise<string | null> {
  const id = extractYoutubeId(sourceUrl ?? "") ?? extractYoutubeId(stored ?? "");
  if (!id) return null;
  for (const candidate of youtubeFrameStillCandidates(id)) {
    if (await usableYoutubeThumb(candidate)) return candidate;
  }
  return null;
}

async function main() {
  const admin = createAdminClient();
  const { data: shots, error } = await admin
    .from("shots")
    .select("id, video_id, thumbnail_path, poster_path")
    .eq("status", "complete")
    .eq("visibility", "public");
  if (error) throw new Error(error.message);

  const branded = (shots ?? []).filter(
    (s) =>
      isYoutubeBrandedPoster((s.thumbnail_path as string | null) ?? "") ||
      isYoutubeBrandedPoster((s.poster_path as string | null) ?? "")
  );
  console.log(`${shots?.length ?? 0} public shots, ${branded.length} with branded YouTube posters`);

  let updated = 0;
  let skipped = 0;
  for (const shot of branded) {
    const { data: video } = await admin
      .from("videos")
      .select("id, source_url, poster_path")
      .eq("id", shot.video_id)
      .maybeSingle();
    const frame = await pickFrameStill(
      (video?.source_url as string | null) ?? null,
      (shot.thumbnail_path as string | null) ?? (shot.poster_path as string | null)
    );
    if (!frame) {
      skipped += 1;
      console.warn(`  no frame still for ${shot.id}`);
      continue;
    }
    const { error: shotErr } = await admin
      .from("shots")
      .update({ thumbnail_path: frame, poster_path: frame })
      .eq("id", shot.id);
    if (shotErr) {
      console.error(`  shot update failed ${shot.id}: ${shotErr.message}`);
      skipped += 1;
      continue;
    }
    if (video && isYoutubeBrandedPoster((video.poster_path as string | null) ?? "")) {
      await admin.from("videos").update({ poster_path: frame }).eq("id", video.id);
    }
    updated += 1;
    console.log(`  ✓ ${shot.id} → ${frame}`);
  }

  console.log(`\nupdated ${updated}, skipped ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
