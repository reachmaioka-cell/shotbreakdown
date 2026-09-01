/**
 * Local smoke test for the retrieval stack: embeddings, RAG and shot search.
 * The full product path is covered by scripts/e2e-journey.ts.
 *
 *   npm run e2e:smoke
 */
import { embed } from "@/lib/embeddings";
import { retrieveKnowledge } from "@/lib/knowledge";
import { searchShots, shotFacetCounts } from "@/lib/shots";
import { instagramOembed } from "@/lib/source";
import { createAdminClient } from "@/lib/supabase/admin";

async function main() {
  const results: string[] = [];

  const vector = await embed("cinematography golden hour anamorphic lens");
  results.push(vector.length === 1536 ? "✓ OpenAI embeddings" : "✗ OpenAI embeddings failed");

  const articles = await retrieveKnowledge("Runway Gen-3 AI video cinematography", 3);
  results.push(articles.length > 0 ? `✓ RAG retrieval (${articles.length} articles)` : "✗ RAG empty");
  if (articles.some((a) => a.heading)) {
    results.push(`✓ Chunk-level RAG (heading: ${articles.find((a) => a.heading)?.heading})`);
  }

  const admin = createAdminClient();
  const { count: chunkCount } = await admin
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true });
  results.push(
    (chunkCount ?? 0) > 0
      ? `✓ Knowledge chunks (${chunkCount})`
      : "✗ Knowledge chunks empty — run npm run db:backfill-chunks"
  );

  const hits = await searchShots({ query: "anamorphic neon handheld", limit: 5 });
  results.push(
    hits.shots.length > 0
      ? `✓ Shot search (${hits.shots.length} hits, semantic=${hits.usedSemantic})`
      : "✗ Shot search empty"
  );

  const filtered = await searchShots({ filters: { lighting_key: ["low-key"] }, limit: 5 });
  results.push(
    filtered.total > 0
      ? `✓ Facet filtering (${filtered.total} low-key shots)`
      : "✗ Facet filtering returned nothing — run npm run db:enrich-shots"
  );

  const facets = await shotFacetCounts({ scope: "public" });
  const facetGroups = Object.keys(facets).length;
  results.push(
    facetGroups >= 8 ? `✓ Facet counts (${facetGroups} groups)` : `✗ Only ${facetGroups} facet groups`
  );

  const { count: embedded } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("visibility", "public")
    .not("embedding", "is", null);
  const { count: publicShots } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("visibility", "public");
  const { count: withFacets } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("visibility", "public")
    .not("metadata->composition", "is", null);
  results.push(
    embedded === publicShots
      ? `✓ Every public shot is indexed (${embedded})`
      : `✗ ${publicShots! - embedded!} public shots have no embedding`
  );
  results.push(
    withFacets === publicShots
      ? `✓ Every public shot has facets (${withFacets})`
      : `✗ ${publicShots! - withFacets!} public shots have no composition facets — run npm run db:enrich-shots`
  );

  const ig = await instagramOembed("https://www.instagram.com/reel/C0fake/");
  results.push(ig.thumbnail === null ? "✓ oEmbed handles a bad link" : "✗ oEmbed unexpected");

  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("✗"))) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
