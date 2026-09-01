/**
 * Backfill facets on shots that were analysed before the facet schema existed.
 *
 * The 39 editorial library shots carry a BreakdownSchema record with no
 * composition/lighting/colour/mood facets, so they are invisible to filtered
 * search. This re-analyses each one from its stored frame with the current shot
 * analyser and re-embeds it. It is real analysis, not a data transform.
 *
 *   npx tsx --env-file=.env.local scripts/enrich-shots.ts [--limit=10] [--all]
 */
import { clipPosterCandidates } from "../lib/clip";
import { embed, shotEmbeddingText } from "../lib/embeddings";
import { resolveMediaUrl } from "../lib/media";
import { analyzeShotFrames, loadFramesFromUrls, SHOT_PROMPT_VERSION } from "../lib/shot-analysis";
import { createAdminClient } from "../lib/supabase/admin";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 100;
const all = args.includes("--all");
const retireUnreadable = args.includes("--retire-unreadable");

async function main() {
  const admin = createAdminClient();

  let query = admin
    .from("shots")
    .select("id, video_id, title, thumbnail_path, poster_path, metadata, shot_index, start_seconds, end_seconds")
    .eq("status", "complete")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (!all) query = query.is("metadata->composition", null);

  const { data: shots, error } = await query;
  if (error) throw new Error(error.message);
  if (!shots?.length) {
    console.log("nothing to enrich");
    return;
  }

  console.log(`enriching ${shots.length} shot(s)`);
  let done = 0;
  let failed = 0;

  for (const shot of shots) {
    try {
      const { data: video } = await admin
        .from("videos")
        .select("title, source_type, source_url")
        .eq("id", shot.video_id)
        .maybeSingle();

      const stored = (shot.poster_path as string | null) ?? (shot.thumbnail_path as string | null);
      const storedUrl = stored ? await resolveMediaUrl(stored) : null;
      const youtubeFallbacks = clipPosterCandidates({
        sourceUrl: (video?.source_url as string | null) ?? null,
        thumbnailUrl: storedUrl,
      });
      const candidates = [storedUrl, ...youtubeFallbacks].filter(
        (url, i, all): url is string => !!url && all.indexOf(url) === i
      );
      const images = await loadFramesFromUrls(candidates);
      if (images.length === 0) {
        console.warn(`  no readable frame among ${candidates.length} candidate(s) for ${shot.id}`);
        if (retireUnreadable) {
          await admin
            .from("shots")
            .update({ visibility: "unlisted" })
            .eq("id", shot.id);
          console.log(`  retired ${shot.id} — frame unreadable`);
        }
        throw new Error("frame unreadable");
      }

      const record = await analyzeShotFrames({
        images,
        videoTitle: (video?.title as string | null) ?? (shot.title as string | null),
        shotIndex: shot.shot_index as number,
        shotCount: 1,
        startSeconds: Number(shot.start_seconds),
        endSeconds: Number(shot.end_seconds),
      });

      // Keep the existing recreation guide; add the facets alongside it.
      const previous = (shot.metadata ?? {}) as Record<string, unknown>;
      const merged = { ...previous, ...record };

      const vector = await embed(
        shotEmbeddingText(merged as never, {
          title: (video?.title as string | null) ?? null,
          sourceType: (video?.source_type as string | null) ?? null,
        })
      );

      const { error: updateError } = await admin
        .from("shots")
        .update({
          metadata: merged,
          embedding: vector,
          tags: record.tags,
          prompt_version: SHOT_PROMPT_VERSION,
        })
        .eq("id", shot.id);
      if (updateError) throw new Error(updateError.message);

      done += 1;
      console.log(`  ✓ ${(shot.title as string | null)?.slice(0, 50) ?? shot.id} — ${record.composition.shot_size}, ${record.movement_facets.type}, ${record.lighting_facets.key_level}`);
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${shot.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\ndone: ${done}, failed: ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
