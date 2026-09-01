/**
 * Snapshot of the public shot corpus: counts, missing facets, missing guides.
 *   npx tsx --env-file=.env.local scripts/library-health.ts
 */
import { createAdminClient } from "../lib/supabase/admin";
import { hasRecreationGuide } from "../lib/validation";

async function main() {
  const admin = createAdminClient();

  const { count: publicCount } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("visibility", "public");
  const { count: complete } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("visibility", "public")
    .eq("status", "complete");
  const { count: embedded } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("visibility", "public")
    .not("embedding", "is", null);

  const { data: publicShots, error } = await admin
    .from("shots")
    .select("id, title, slug, thumbnail_path, poster_path, video_id, metadata, embedding")
    .eq("visibility", "public")
    .eq("status", "complete");
  if (error) throw new Error(error.message);

  const noComp = (publicShots ?? []).filter((s) => !(s.metadata as { composition?: unknown } | null)?.composition);
  const noGuide = (publicShots ?? []).filter((s) => !hasRecreationGuide(s.metadata as { recreation_steps?: string[] }));
  const noEmbed = (publicShots ?? []).filter((s) => !s.embedding);

  const { data: videos } = await admin.from("videos").select("source_url").not("source_url", "is", null);

  console.log(
    JSON.stringify(
      {
        publicCount,
        complete,
        embedded,
        noComposition: noComp.map((s) => ({
          id: s.id,
          title: s.title,
          slug: s.slug,
          thumb: s.thumbnail_path,
          video_id: s.video_id,
        })),
        noGuideCount: noGuide.length,
        noEmbedCount: noEmbed.length,
        sourceUrls: (videos ?? []).map((v) => v.source_url).filter(Boolean).length,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
