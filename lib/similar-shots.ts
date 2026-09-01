import { createAdminClient } from "@/lib/supabase/admin";
import { embed, embeddingQueryText } from "@/lib/embeddings";
import { overlayBreakdown } from "@/lib/overlay";
import type { Breakdown } from "@/lib/validation";

/** Vector-retrieve similar verified breakdowns for prompt examples or ask context. */
export async function loadSimilarBreakdowns(options: {
  title?: string | null;
  sourceType?: string | null;
  tags?: string[] | null;
  breakdown?: Breakdown | null;
  excludeId?: string;
  limit?: number;
}): Promise<Breakdown[]> {
  const admin = createAdminClient();
  const query = options.breakdown
    ? [
        options.breakdown.one_line_summary,
        options.breakdown.tags.join(" "),
        options.breakdown.shot_type,
        options.breakdown.lens,
        options.breakdown.lighting.key,
        options.breakdown.movement.type,
      ]
        .filter(Boolean)
        .join(" ")
    : embeddingQueryText({
        title: options.title,
        sourceType: options.sourceType,
        tags: options.tags,
      });

  // Retrieval for prompt examples is best-effort: a provider blip must not fail
  // the whole analysis, and the caller degrades to curated gold examples.
  let vector: number[];
  try {
    vector = await embed(query);
  } catch (e) {
    console.error("loadSimilarBreakdowns embed", e instanceof Error ? e.message : e);
    return [];
  }

  const { data, error } = await admin.rpc("match_verified_breakdowns", {
    query_embedding: vector,
    match_k: (options.limit ?? 3) + 1,
  });
  if (error || !data?.length) return [];

  return (data as { id: string; breakdown: Breakdown; breakdown_user_edits?: Record<string, unknown> | null }[])
    .filter((row) => row.id !== options.excludeId)
    .slice(0, options.limit ?? 3)
    .map((row) => {
      if (!row.breakdown) return null;
      return overlayBreakdown(row.breakdown, row.breakdown_user_edits ?? null);
    })
    .filter(Boolean) as Breakdown[];
}

export function formatSimilarBlock(breakdowns: Breakdown[]): string | undefined {
  if (!breakdowns.length) return undefined;
  return breakdowns.map((b, i) => `Similar verified shot ${i + 1}:\n${JSON.stringify(b)}`).join("\n\n");
}
