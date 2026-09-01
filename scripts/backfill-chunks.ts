/**
 * Backfill knowledge_chunks for existing articles.
 * Usage: npx tsx --env-file=.env.local scripts/backfill-chunks.ts [limit]
 */
import { backfillKnowledgeChunks } from "@/lib/knowledge-chunks";
import { createAdminClient } from "@/lib/supabase/admin";

async function main() {
  const limit = Number(process.argv[2] ?? 40);
  const admin = createAdminClient();

  const [{ count: articles }, { count: chunksBefore }] = await Promise.all([
    admin.from("knowledge_articles").select("id", { count: "exact", head: true }),
    admin.from("knowledge_chunks").select("id", { count: "exact", head: true }),
  ]);

  console.log(`Articles: ${articles ?? 0}, chunks before: ${chunksBefore ?? 0}`);
  console.log(`Backfilling up to ${limit} articles missing chunks…`);

  const result = await backfillKnowledgeChunks({ limit, force: false });
  console.log(`Done: ${result.articles} articles → ${result.chunks} chunks`);

  const { count: chunksAfter } = await admin
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true });
  console.log(`Chunks after: ${chunksAfter ?? 0}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
