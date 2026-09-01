import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { embed, embedOptional } from "@/lib/embeddings";
import { extractQueryTags, tagOverlapScore } from "@/lib/knowledge-query";
import { syncKnowledgeChunks } from "@/lib/knowledge-chunks";
import { distillSnippetsToArticle } from "@/lib/learning/distill";
import { overlayBreakdown } from "@/lib/overlay";
import { LEARN_META, LEARN_TOPICS } from "@/lib/learn";
import type { ResearchContext } from "@/lib/research";
import type { Breakdown } from "@/lib/validation";

export type KnowledgeArticle = {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  source_type: string;
  source_url?: string | null;
  similarity?: number;
  heading?: string | null;
  chunk_index?: number | null;
};

const SOURCE_BOOST: Record<string, number> = {
  correction: 0.18,
  curriculum: 0.08,
  verified_distill: 0.06,
  learn: 0.04,
  web: 0,
};

function rankArticles(
  articles: KnowledgeArticle[],
  limit: number,
  queryTags: string[] = []
): KnowledgeArticle[] {
  const scored = [...articles]
    .map((a) => {
      const base = (a.similarity ?? 0) + (SOURCE_BOOST[a.source_type] ?? 0);
      const tagBoost = queryTags.length ? tagOverlapScore(a.tags, queryTags) * 0.12 : 0;
      return { article: a, score: base + tagBoost };
    })
    .sort((x, y) => y.score - x.score);

  const picked: KnowledgeArticle[] = [];
  const perSource = new Map<string, number>();
  const perSlug = new Map<string, number>();
  const maxPerSource: Record<string, number> = {
    correction: 3,
    curriculum: 2,
    verified_distill: 2,
    learn: 2,
    web: 2,
  };

  for (const { article } of scored) {
    const slugCount = perSlug.get(article.slug) ?? 0;
    // Allow up to 2 chunks from the same article when they are different sections.
    if (slugCount >= 2) continue;
    const cap = maxPerSource[article.source_type] ?? 2;
    const count = perSource.get(article.source_type) ?? 0;
    if (count >= cap && slugCount === 0) continue;
    if (count >= cap + 1) continue;

    picked.push(article);
    perSlug.set(article.slug, slugCount + 1);
    perSource.set(article.source_type, count + 1);
    if (picked.length >= limit) break;
  }

  if (picked.length < limit) {
    for (const { article } of scored) {
      if (picked.length >= limit) break;
      if (!picked.some((p) => p.slug === article.slug && p.chunk_index === article.chunk_index)) {
        if (!picked.some((p) => p.slug === article.slug)) picked.push(article);
      }
    }
  }

  return picked.slice(0, limit);
}

async function vectorSearchArticles(
  vector: number[],
  matchK: number,
  sourceFilter?: string | null
): Promise<KnowledgeArticle[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("match_knowledge_articles", {
    query_embedding: vector,
    match_k: matchK,
    source_filter: sourceFilter ?? null,
  });
  if (error || !data?.length) return [];
  return data as KnowledgeArticle[];
}

async function vectorSearchChunks(
  vector: number[],
  matchK: number,
  sourceFilter?: string | null
): Promise<KnowledgeArticle[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: vector,
    match_k: matchK,
    source_filter: sourceFilter ?? null,
  });
  if (error || !data?.length) return [];
  return (data as KnowledgeArticle[]).map((row) => ({
    ...row,
    heading: row.heading ?? null,
    chunk_index: row.chunk_index ?? null,
  }));
}

/** Prefer chunk hits; fall back to whole-article vectors for unchunked rows. */
export async function retrieveKnowledge(
  query: string,
  limit = 6,
  options?: { tags?: string[] }
): Promise<KnowledgeArticle[]> {
  const queryTags = extractQueryTags(query, options?.tags ?? []);
  const vector = await embed(query);
  if (vector) {
    try {
      const [chunkCorrections, chunkGeneral] = await Promise.all([
        vectorSearchChunks(vector, Math.min(5, limit + 2), "correction"),
        vectorSearchChunks(vector, limit + 8, null),
      ]);
      const fromChunks = rankArticles([...chunkCorrections, ...chunkGeneral], limit, queryTags);
      if (fromChunks.length) return fromChunks;

      const [articleCorrections, articleGeneral] = await Promise.all([
        vectorSearchArticles(vector, Math.min(4, limit), "correction"),
        vectorSearchArticles(vector, limit + 6, null),
      ]);
      const fromArticles = rankArticles(
        [...articleCorrections, ...articleGeneral],
        limit,
        queryTags
      );
      if (fromArticles.length) return fromArticles;
    } catch (err) {
      console.error("knowledge retrieval failed", err instanceof Error ? err.message : err);
    }
  }

  return fallbackLearnArticles(query, limit);
}

async function upsertArticleAndChunk(row: {
  slug: string;
  title: string;
  content: string;
  source_type: string;
  source_url?: string | null;
  tags: string[];
  embedding: number[] | null;
}): Promise<{ id: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("knowledge_articles")
    .upsert(
      {
        slug: row.slug,
        title: row.title,
        content: row.content,
        source_type: row.source_type,
        source_url: row.source_url ?? null,
        tags: row.tags,
        embedding: row.embedding,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" }
    )
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    console.error("upsertArticleAndChunk", row.slug, error?.message);
    return null;
  }

  try {
    await syncKnowledgeChunks({
      articleId: data.id as string,
      title: row.title,
      content: row.content,
    });
  } catch (err) {
    console.error("syncKnowledgeChunks", row.slug, err instanceof Error ? err.message : err);
  }

  return { id: data.id as string };
}

function fallbackLearnArticles(query: string, limit: number): KnowledgeArticle[] {
  const q = query.toLowerCase();
  const scored = LEARN_TOPICS.map((slug) => {
    const meta = LEARN_META[slug];
    const hay = [slug, meta.title, meta.description, ...meta.relatedTags].join(" ").toLowerCase();
    let score = 0;
    for (const word of q.split(/\s+/).filter((w) => w.length > 3)) {
      if (hay.includes(word)) score += 1;
    }
    for (const tag of meta.relatedTags) {
      if (q.includes(tag.replace(/-/g, " ")) || q.includes(tag)) score += 2;
    }
    return { slug, meta, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ slug, meta }) => ({
    slug,
    title: meta.title,
    content: meta.description,
    tags: [...meta.relatedTags],
    source_type: "learn",
  }));
}

export async function loadLearnMarkdown(slug: string): Promise<string | null> {
  try {
    return await readFile(join(process.cwd(), "content", "learn", `${slug}.md`), "utf8");
  } catch {
    return null;
  }
}

export async function ingestLearnArticles(): Promise<{ upserted: number }> {
  let upserted = 0;

  for (const slug of LEARN_TOPICS) {
    const meta = LEARN_META[slug];
    const body = await loadLearnMarkdown(slug);
    if (!body) continue;
    const content = body.slice(0, 12000);
    const embedding = await embedOptional([meta.title, meta.description, content.slice(0, 2000)].join("\n"));
    const ok = await upsertArticleAndChunk({
      slug,
      title: meta.title,
      content,
      source_type: "learn",
      source_url: `/learn/${slug}`,
      tags: [...meta.relatedTags],
      embedding: embedding ?? null,
    });
    if (ok) upserted += 1;
  }

  return { upserted };
}

export async function distillVerifiedBreakdowns(limit = 10): Promise<{ upserted: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select("slug, title, tags, breakdown, breakdown_user_edits")
    .eq("status", "verified")
    .not("slug", "is", null)
    .order("rating_avg", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  let upserted = 0;

  for (const row of data ?? []) {
    const base = row.breakdown as Breakdown | null;
    if (!base?.one_line_summary || !row.slug) continue;

    const breakdown = overlayBreakdown(
      base,
      row.breakdown_user_edits as Record<string, unknown> | null
    );

    const raw = [
      breakdown.one_line_summary,
      breakdown.lens ? `Lens: ${breakdown.lens}` : "",
      breakdown.lighting?.key ? `Key light: ${breakdown.lighting.key}` : "",
      breakdown.movement?.type ? `Movement: ${breakdown.movement.type}` : "",
      breakdown.vfx?.length ? `VFX: ${breakdown.vfx.join(", ")}` : "",
      breakdown.post_production?.ai_tools ? `AI: ${breakdown.post_production.ai_tools}` : "",
      breakdown.recreation_steps?.slice(0, 5).join("\n") ?? "",
    ]
      .filter(Boolean)
      .join("\n");

    const content = await distillSnippetsToArticle({
      title: row.title ?? breakdown.one_line_summary,
      rawContent: raw,
      tags: (row.tags as string[]) ?? breakdown.tags,
      kind: "curriculum",
    });

    const slug = `verified-${row.slug}`;
    const embedding = await embedOptional(content);
    const ok = await upsertArticleAndChunk({
      slug,
      title: row.title ?? breakdown.one_line_summary,
      content,
      source_type: "verified_distill",
      source_url: `/library/${row.slug}`,
      tags: (row.tags as string[]) ?? breakdown.tags,
      embedding: embedding ?? null,
    });
    if (ok) upserted += 1;
  }

  return { upserted };
}

export function formatKnowledgeBlock(articles: KnowledgeArticle[]): string | undefined {
  if (!articles.length) return undefined;
  return articles
    .map((a, i) => {
      const label = a.heading ? `${a.title} — ${a.heading}` : a.title;
      return `${i + 1}. ${label} (${a.source_type})\n${a.content.slice(0, 900)}${a.content.length > 900 ? "…" : ""}`;
    })
    .join("\n\n");
}

function slugFromQuery(query: string) {
  const base = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `web-${base}`;
}

function slugFromUrl(url: string) {
  const base = url
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `research-${base}`;
}

export async function ingestWebResearch(
  query: string,
  tags: string[] = [],
  options?: { distill?: boolean }
): Promise<{ slug: string; snippets: number }> {
  const { searchTopic } = await import("@/lib/research");
  const snippets = await searchTopic(query);
  if (!snippets.length) return { slug: "", snippets: 0 };

  const slug = slugFromQuery(query);
  const raw = snippets
    .map((s, i) => `${i + 1}. ${s.title}${s.url ? ` (${s.url})` : ""}\n${s.excerpt}`)
    .join("\n\n")
    .slice(0, 14000);

  const content =
    options?.distill !== false
      ? await distillSnippetsToArticle({ title: query, rawContent: raw, tags, kind: "web" })
      : raw.slice(0, 12000);

  const embedding = await embedOptional([query, content.slice(0, 2000)].join("\n"));
  const ok = await upsertArticleAndChunk({
    slug,
    title: query,
    content,
    source_type: "web",
    source_url: snippets[0]?.url ?? null,
    tags,
    embedding: embedding ?? null,
  });
  if (!ok) throw new Error("Failed to ingest web research");
  return { slug, snippets: snippets.length };
}

export async function ingestCurriculumArticle(options: {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  sourceUrl?: string | null;
  distill?: boolean;
}): Promise<{ slug: string }> {
  const content =
    options.distill !== false
      ? await distillSnippetsToArticle({
          title: options.title,
          rawContent: options.content,
          tags: options.tags,
          kind: "curriculum",
        })
      : options.content.slice(0, 12000);

  const embedding = await embedOptional([options.title, content.slice(0, 2000)].join("\n"));
  const ok = await upsertArticleAndChunk({
    slug: options.slug,
    title: options.title,
    content,
    source_type: "curriculum",
    source_url: options.sourceUrl ?? null,
    tags: options.tags,
    embedding: embedding ?? null,
  });
  if (!ok) throw new Error(`Failed to ingest curriculum ${options.slug}`);
  return { slug: options.slug };
}

/** Distill clip research into RAG after warm_research or submission analyze. */
export async function ingestResearchContext(
  ctx: ResearchContext,
  options?: { title?: string | null }
): Promise<{ slug: string } | null> {
  if (!ctx.snippets.length && !ctx.description) return null;

  const title = options?.title ?? ctx.title ?? "Clip research";
  const slug = ctx.sourceUrl ? slugFromUrl(ctx.sourceUrl) : slugFromQuery(title);

  const raw = [
    ctx.title ? `Title: ${ctx.title}` : "",
    ctx.creator ? `Creator: ${ctx.creator}` : "",
    ctx.description ? `Description: ${ctx.description}` : "",
    ctx.gearMentions.length ? `Gear: ${ctx.gearMentions.join("; ")}` : "",
    ...ctx.snippets.map(
      (s, i) => `${i + 1}. [${s.source}] ${s.title}${s.url ? ` (${s.url})` : ""}\n${s.excerpt}`
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  if (raw.length < 80) return null;

  const content = await distillSnippetsToArticle({
    title,
    rawContent: raw,
    tags: ["clip-research", ...(ctx.gearMentions.length ? ["gear"] : [])],
    kind: "clip_research",
  });

  const embedding = await embedOptional([title, content.slice(0, 2000)].join("\n"));
  const ok = await upsertArticleAndChunk({
    slug,
    title: `${title} — clip research`,
    content,
    source_type: "web",
    source_url: ctx.sourceUrl,
    tags: ["clip-research"],
    embedding: embedding ?? null,
  });
  if (!ok) {
    console.error("ingestResearchContext failed", slug);
    return null;
  }
  return { slug };
}
