import { createAdminClient } from "@/lib/supabase/admin";
import { embed, breakdownEmbeddingText, embedOptional } from "@/lib/embeddings";
import {
  distillVerifiedBreakdowns,
  ingestCurriculumArticle,
  ingestLearnArticles,
  ingestResearchContext,
  ingestWebResearch,
} from "@/lib/knowledge";
import { backfillKnowledgeChunks, syncKnowledgeChunksBySlug } from "@/lib/knowledge-chunks";
import { distillSnippetsToArticle } from "@/lib/learning/distill";
import { overlayBreakdown } from "@/lib/overlay";
import type { Breakdown, ShotMetadata } from "@/lib/validation";
import {
  FILM_CURRICULUM,
  filmLabel,
  filmSearchQueries,
  type FilmCurriculumItem,
} from "@/lib/learning/films";
import {
  MUSIC_VIDEO_CURRICULUM,
  musicVideoLabel,
  musicVideoSearchQueries,
  type MusicVideoCurriculumItem,
} from "@/lib/learning/music-videos";
import { TECHNIQUE_CURRICULUM, type TechniqueCurriculumItem } from "@/lib/learning/techniques";
import {
  AI_TOOL_CURRICULUM,
  aiToolLabel,
  aiToolSearchQueries,
  type AiToolCurriculumItem,
} from "@/lib/learning/ai-tools";
import { gatherClipResearch, searchTopic } from "@/lib/research";
import { writePromptInsights } from "@/lib/cron-jobs";
import type { LearningJob, LearningJobResult, LearningJobType } from "@/lib/learning/types";

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function learnFilm(item: FilmCurriculumItem): Promise<LearningJobResult> {
  const label = filmLabel(item);
  const parts: string[] = [
    `# ${label}`,
    item.director ? `Director: ${item.director}` : "",
    item.cinematographer ? `Cinematographer: ${item.cinematographer}` : "",
    `Source: ${item.youtubeUrl}`,
    "",
  ].filter(Boolean);

  const research = await gatherClipResearch({
    sourceUrl: item.youtubeUrl,
    sourceType: "youtube",
    title: label,
  });

  if (research.description) parts.push(`YouTube description: ${research.description.slice(0, 800)}`);
  if (research.creator) parts.push(`Channel: ${research.creator}`);
  if (research.gearMentions.length) {
    parts.push(`Gear mentioned: ${research.gearMentions.join("; ")}`);
  }
  if (research.snippets.length) {
    parts.push("", "## Clip research");
    for (const s of research.snippets.slice(0, 6)) {
      parts.push(`- [${s.source}] ${s.title}: ${s.excerpt.slice(0, 300)}`);
    }
  }

  const queries = filmSearchQueries(item).slice(0, 4);
  parts.push("", "## Web research");
  let webSnippets = 0;
  for (const query of queries) {
    const hits = await searchTopic(query);
    webSnippets += hits.length;
    for (const hit of hits.slice(0, 3)) {
      parts.push(`- ${hit.title}${hit.url ? ` (${hit.url})` : ""}: ${hit.excerpt.slice(0, 280)}`);
    }
  }

  const content = parts.join("\n");
  const slug = `film-${item.id}`;
  await ingestCurriculumArticle({
    slug,
    title: `${label} — film cinematography curriculum`,
    content,
    tags: ["film", "curriculum", ...item.tags],
    sourceUrl: item.youtubeUrl,
  });

  return {
    ok: true,
    detail: { slug, clipSnippets: research.snippets.length, webSnippets, queries: queries.length },
  };
}

async function learnTechnique(item: TechniqueCurriculumItem): Promise<LearningJobResult> {
  const result = await ingestWebResearch(item.query, ["technique", "curriculum", ...item.tags]);
  return { ok: true, detail: { slug: result.slug, snippets: result.snippets, query: item.query } };
}

async function learnAiTool(item: AiToolCurriculumItem): Promise<LearningJobResult> {
  const label = aiToolLabel(item);
  const parts: string[] = [
    `# ${item.name}`,
    `Category: ${item.category}`,
    `Primary use case: ${item.useCase}`,
    "",
    "## Capabilities & workflow",
  ];

  const queries = aiToolSearchQueries(item).slice(0, 5);
  let webSnippets = 0;
  for (const query of queries) {
    const hits = await searchTopic(query);
    webSnippets += hits.length;
    parts.push("", `### ${query}`);
    for (const hit of hits.slice(0, 4)) {
      parts.push(`- ${hit.title}${hit.url ? ` (${hit.url})` : ""}: ${hit.excerpt.slice(0, 320)}`);
    }
  }

  parts.push(
    "",
    "## Recreation guidance",
    `- When a shot looks AI-generated, check if ${item.name} could produce this look.`,
    `- Prompt patterns: include lens (35mm), lighting (soft key, rim), camera move, film grain, aspect ratio.`,
    `- Hybrid workflow: generate plate in ${item.name}, comp over practical, grade in DaVinci.`,
    `- Limitations: watch for morphing faces, inconsistent lighting, physics glitches, temporal flicker.`
  );

  const content = parts.join("\n");
  const slug = `ai-${item.id}`;
  await ingestCurriculumArticle({
    slug,
    title: `${label} — AI filmmaking curriculum`,
    content,
    tags: ["ai-tools", "curriculum", ...item.tags],
  });

  return { ok: true, detail: { slug, webSnippets, queries: queries.length } };
}

async function distillCorrections(limit = 30): Promise<LearningJobResult> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("breakdown_feedback")
    .select("field_key, original_value, corrected_value, submission_id")
    .not("field_key", "is", null)
    .not("corrected_value", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: true, detail: { upserted: 0 } };

  const submissionIds = [...new Set(data.map((r) => r.submission_id as string))];
  const { data: submissions } = await admin
    .from("submissions")
    .select("id, tags")
    .in("id", submissionIds);
  const tagsById = new Map(
    (submissions ?? []).map((s) => [s.id as string, (s.tags as string[]) ?? []])
  );

  const byBucket = new Map<string, { lines: string[]; tags: string[] }>();
  for (const row of data) {
    const fieldKey = row.field_key as string;
    const subTags = tagsById.get(row.submission_id as string) ?? [];
    const primaryTag = subTags[0] ?? "general";
    const bucketKey = `${fieldKey}::${primaryTag}`;
    const line = `${fieldKey}: ${JSON.stringify(row.original_value)} → ${JSON.stringify(row.corrected_value)}`;
    const bucket = byBucket.get(bucketKey) ?? { lines: [], tags: subTags };
    if (!bucket.lines.includes(line)) bucket.lines.push(line);
    byBucket.set(bucketKey, bucket);
  }

  let upserted = 0;
  for (const [bucketKey, { lines, tags }] of byBucket) {
    const fieldKey = bucketKey.split("::")[0] ?? bucketKey;
    const tagSuffix = tags[0] ? `-${slugify(tags[0])}` : "";
    const slug = `correction-${slugify(fieldKey)}${tagSuffix}`;
    const raw = [
      `User corrections for breakdown field "${fieldKey}"${tags.length ? ` (${tags.slice(0, 3).join(", ")})` : ""}:`,
      ...lines.slice(0, 15).map((l) => `- ${l}`),
    ].join("\n");
    const content = await distillSnippetsToArticle({
      title: `Corrections: ${fieldKey}${tags[0] ? ` — ${tags[0]}` : ""}`,
      rawContent: raw,
      tags: ["correction", fieldKey.split(".")[0] ?? fieldKey, ...tags.slice(0, 4)],
      kind: "correction",
    });
    const embedding = await embedOptional(content);
    const { error: upsertError } = await admin.from("knowledge_articles").upsert(
      {
        slug,
        title: `Corrections: ${fieldKey}`,
        content,
        source_type: "correction",
        tags: ["correction", fieldKey.split(".")[0] ?? fieldKey, ...tags.slice(0, 4)],
        embedding: embedding ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" }
    );
    if (!upsertError) {
      upserted += 1;
      try {
        await syncKnowledgeChunksBySlug(slug);
      } catch (err) {
        console.error("chunk correction", slug, err instanceof Error ? err.message : err);
      }
    }
  }

  return { ok: true, detail: { upserted, buckets: byBucket.size } };
}

async function reembedSubmission(submissionId: string): Promise<LearningJobResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select("breakdown, breakdown_user_edits, title, tags, source_type")
    .eq("id", submissionId)
    .maybeSingle();

  if (error || !data?.breakdown) {
    return { ok: false, error: "submission not found" };
  }

  const base = data.breakdown as Breakdown;
  const breakdown = overlayBreakdown(base, data.breakdown_user_edits as Record<string, unknown> | null);
  const vector = await embed(
    breakdownEmbeddingText(breakdown, {
      title: data.title,
      sourceType: data.source_type,
    })
  );

  if (!vector) return { ok: false, error: "embedding failed" };

  const { error: updateError } = await admin
    .from("submissions")
    .update({ embedding: vector })
    .eq("id", submissionId);

  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true, detail: { submissionId } };
}

async function reembedBatch(limit = 20): Promise<LearningJobResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select("id, breakdown, breakdown_user_edits, title, source_type")
    .not("breakdown", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, error: error.message };
  let embedded = 0;
  for (const row of data ?? []) {
    const base = row.breakdown as Breakdown;
    const breakdown = overlayBreakdown(base, row.breakdown_user_edits as Record<string, unknown> | null);
    const vector = await embed(
      breakdownEmbeddingText(breakdown, { title: row.title, sourceType: row.source_type })
    );
    if (!vector) continue;
    await admin.from("submissions").update({ embedding: vector }).eq("id", row.id);
    embedded += 1;
  }
  return { ok: true, detail: { embedded } };
}

async function learnMusicVideo(item: MusicVideoCurriculumItem): Promise<LearningJobResult> {
  const label = musicVideoLabel(item);
  const parts: string[] = [
    `# ${label}`,
    item.director ? `Director: ${item.director}` : "",
    item.cinematographer ? `Cinematographer: ${item.cinematographer}` : "",
    `Source: ${item.youtubeUrl}`,
    "",
  ].filter(Boolean);

  const research = await gatherClipResearch({
    sourceUrl: item.youtubeUrl,
    sourceType: "youtube",
    title: label,
  });

  if (research.description) parts.push(`YouTube description: ${research.description.slice(0, 800)}`);
  if (research.creator) parts.push(`Channel: ${research.creator}`);
  if (research.gearMentions.length) {
    parts.push(`Gear mentioned: ${research.gearMentions.join("; ")}`);
  }
  if (research.snippets.length) {
    parts.push("", "## Clip research");
    for (const s of research.snippets.slice(0, 6)) {
      parts.push(`- [${s.source}] ${s.title}: ${s.excerpt.slice(0, 300)}`);
    }
  }

  const queries = musicVideoSearchQueries(item).slice(0, 4);
  parts.push("", "## Web research");
  let webSnippets = 0;
  for (const query of queries) {
    const hits = await searchTopic(query);
    webSnippets += hits.length;
    for (const hit of hits.slice(0, 3)) {
      parts.push(`- ${hit.title}${hit.url ? ` (${hit.url})` : ""}: ${hit.excerpt.slice(0, 280)}`);
    }
  }

  const content = parts.join("\n");
  const slug = `mv-${item.id}`;
  await ingestCurriculumArticle({
    slug,
    title: `${label} — cinematography curriculum`,
    content,
    tags: ["music-video", "curriculum", ...item.tags],
    sourceUrl: item.youtubeUrl,
  });

  return {
    ok: true,
    detail: {
      slug,
      clipSnippets: research.snippets.length,
      webSnippets,
      queries: queries.length,
    },
  };
}

/**
 * Turn a published shot into a knowledge article, so the retrieval corpus that
 * sharpens future analyses grows from the shot library rather than only from
 * the legacy submissions corpus.
 */
async function distillSingleShot(shotId: string): Promise<LearningJobResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shots")
    .select("id, slug, title, tags, metadata, metadata_edits, visibility, videos ( title )")
    .eq("id", shotId)
    .maybeSingle();

  if (error || !data?.metadata) return { ok: false, error: "shot not found or not analysed" };
  if (data.visibility !== "public") return { ok: false, error: "shot is not public" };

  const metadata = overlayBreakdown(
    data.metadata as Record<string, unknown>,
    data.metadata_edits as Record<string, unknown> | null
  ) as ShotMetadata;

  const summary = metadata.one_line_summary ?? metadata.description;
  if (!summary) return { ok: false, error: "no summary" };

  const video = Array.isArray(data.videos) ? data.videos[0] : data.videos;
  const title = (video?.title as string | undefined) ?? (data.title as string | null) ?? summary;

  const raw = [
    metadata.description,
    metadata.why_it_works ? `Why it works: ${metadata.why_it_works}` : "",
    metadata.composition ? `Composition: ${metadata.composition.shot_size}, ${metadata.composition.camera_angle}. ${metadata.composition.framing ?? ""} ${metadata.composition.depth ?? ""}` : "",
    metadata.optics ? `Lens (estimated): ${metadata.optics.lens_type}, ${metadata.optics.focal_length_range}, ${metadata.optics.depth_of_field} depth of field. ${metadata.optics.character ?? ""}` : "",
    metadata.lighting_notes ? `Lighting: ${metadata.lighting_notes}` : "",
    metadata.color_notes ? `Colour: ${metadata.color_notes}` : "",
    metadata.environment ? `Environment: ${metadata.environment.interior_exterior}, ${metadata.environment.location_type}, ${metadata.environment.time_of_day}` : "",
    metadata.movement_facets ? `Movement: ${metadata.movement_facets.type} at ${metadata.movement_facets.speed} speed` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const content = await distillSnippetsToArticle({
    title,
    rawContent: raw,
    tags: (data.tags as string[]) ?? metadata.tags ?? [],
    kind: "curriculum",
  });

  const embedding = await embedOptional(content);
  const { error: upsertError } = await admin.from("knowledge_articles").upsert(
    {
      slug: `shot-${data.slug ?? data.id}`,
      title,
      content,
      source_type: "verified_distill",
      source_url: `/shots/${data.slug ?? data.id}`,
      tags: (data.tags as string[]) ?? metadata.tags ?? [],
      embedding: embedding ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "slug" }
  );

  if (upsertError) return { ok: false, error: upsertError.message };

  void syncKnowledgeChunksBySlug(`shot-${data.slug ?? data.id}`).catch((err) =>
    console.error("chunk distill_shot", err instanceof Error ? err.message : err)
  );

  return { ok: true, detail: { shotId } };
}

async function distillSingleSubmission(submissionId: string): Promise<LearningJobResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select("id, slug, title, tags, breakdown, breakdown_user_edits, status")
    .eq("id", submissionId)
    .maybeSingle();

  if (error || !data?.breakdown) {
    return { ok: false, error: "submission not found or not distillable" };
  }

  const base = data.breakdown as Breakdown;
  const breakdown = overlayBreakdown(
    base,
    data.breakdown_user_edits as Record<string, unknown> | null
  );

  if (!breakdown.one_line_summary) {
    return { ok: false, error: "no summary" };
  }

  const articleSlug = data.slug ? `verified-${data.slug}` : `submission-${data.id}`;
  const raw = [
    breakdown.one_line_summary,
    breakdown.lens ? `Lens: ${breakdown.lens}` : "",
    breakdown.lighting?.key ? `Key light: ${breakdown.lighting.key}` : "",
    breakdown.movement?.type ? `Movement: ${breakdown.movement.type}` : "",
    breakdown.vfx?.length ? `VFX: ${breakdown.vfx.join(", ")}` : "",
    breakdown.post_production?.editing ? `Editing: ${breakdown.post_production.editing}` : "",
    breakdown.post_production?.vfx ? `VFX finish: ${breakdown.post_production.vfx}` : "",
    breakdown.post_production?.ai_tools ? `AI: ${breakdown.post_production.ai_tools}` : "",
    breakdown.recreation_steps?.slice(0, 5).join("\n") ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const content = await distillSnippetsToArticle({
    title: data.title ?? breakdown.one_line_summary,
    rawContent: raw,
    tags: (data.tags as string[]) ?? breakdown.tags,
    kind: "curriculum",
  });

  const embedding = await embedOptional(content);
  const { error: upsertError } = await admin.from("knowledge_articles").upsert(
    {
      slug: articleSlug,
      title: data.title ?? breakdown.one_line_summary,
      content,
      source_type: "verified_distill",
      source_url: data.slug && data.status === "verified" ? `/library/${data.slug}` : `/breakdown/${data.id}`,
      tags: (data.tags as string[]) ?? breakdown.tags,
      embedding: embedding ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "slug" }
  );

  if (upsertError) return { ok: false, error: upsertError.message };

  try {
    await syncKnowledgeChunksBySlug(articleSlug);
  } catch (err) {
    console.error("chunk distill_submission", err instanceof Error ? err.message : err);
  }

  return { ok: true, detail: { slug: articleSlug } };
}

async function embedMissingArticles(limit = 10): Promise<LearningJobResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("knowledge_articles")
    .select("id, slug, title, content")
    .is("embedding", null)
    .limit(limit);

  if (error) return { ok: false, error: error.message };
  let embedded = 0;
  let chunked = 0;
  for (const row of data ?? []) {
    const vector = await embedOptional(`${row.title}\n${row.content}`.slice(0, 4000));
    if (!vector) continue;
    await admin.from("knowledge_articles").update({ embedding: vector }).eq("slug", row.slug);
    embedded += 1;
    try {
      const result = await syncKnowledgeChunksBySlug(row.slug as string);
      if (result) chunked += result.chunks;
    } catch (err) {
      console.error("chunk embed_missing", row.slug, err instanceof Error ? err.message : err);
    }
  }
  return { ok: true, detail: { embedded, chunked } };
}

async function rechunkArticles(limit = 20): Promise<LearningJobResult> {
  try {
    const result = await backfillKnowledgeChunks({ limit, force: false });
    return { ok: true, detail: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "rechunk failed" };
  }
}

async function discoverLibrary(): Promise<LearningJobResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select("id, slug, source_url, source_type, title, status")
    .in("status", ["verified", "draft"])
    .not("breakdown", "is", null)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) return { ok: false, error: error.message };

  const { enqueueLearningJob } = await import("@/lib/learning/queue");
  let enqueued = 0;

  for (const row of data ?? []) {
    const id = await enqueueLearningJob(
      "distill_submission",
      { submissionId: row.id },
      { dedupeKey: `distill:${row.id}`, priority: row.status === "verified" ? 5 : 2 }
    );
    if (id) enqueued += 1;

    if (row.source_url) {
      const warmId = await enqueueLearningJob(
        "warm_research",
        {
          sourceUrl: row.source_url,
          sourceType: row.source_type,
          title: row.title,
        },
        { dedupeKey: `warm:${row.source_url}`, priority: 3 }
      );
      if (warmId) enqueued += 1;
    }
  }

  return { ok: true, detail: { enqueued } };
}

export async function runLearningJob(job: LearningJob): Promise<LearningJobResult> {
  switch (job.job_type) {
    case "ingest_learn": {
      const result = await ingestLearnArticles();
      return { ok: true, detail: { upserted: result.upserted } };
    }
    case "distill_verified_batch": {
      const limit = typeof job.payload.limit === "number" ? job.payload.limit : 10;
      const result = await distillVerifiedBreakdowns(limit);
      return { ok: true, detail: { upserted: result.upserted } };
    }
    case "distill_shot": {
      const shotId = job.payload.shotId as string | undefined;
      if (!shotId) return { ok: false, error: "missing shotId" };
      return distillSingleShot(shotId);
    }
    case "distill_submission": {
      const submissionId = job.payload.submissionId as string;
      if (!submissionId) return { ok: false, error: "missing submissionId" };
      return distillSingleSubmission(submissionId);
    }
    case "research_topic": {
      const query = job.payload.query as string;
      const tags = (job.payload.tags as string[]) ?? [];
      if (!query) return { ok: false, error: "missing query" };
      const result = await ingestWebResearch(query, tags);
      return { ok: true, detail: result };
    }
    case "warm_research": {
      const ctx = await gatherClipResearch({
        sourceUrl: job.payload.sourceUrl as string,
        sourceType: job.payload.sourceType as string,
        title: job.payload.title as string,
      });
      const ingested = await ingestResearchContext(ctx, {
        title: (job.payload.title as string) ?? ctx.title,
      });
      return {
        ok: true,
        detail: {
          snippets: ctx.snippets.length,
          gear: ctx.gearMentions.length,
          ingested: ingested?.slug ?? null,
        },
      };
    }
    case "learn_music_video": {
      const curriculumId = job.payload.curriculumId as string;
      const item = MUSIC_VIDEO_CURRICULUM.find((mv) => mv.id === curriculumId);
      if (!item) return { ok: false, error: "unknown curriculum id" };
      return learnMusicVideo(item);
    }
    case "learn_film": {
      const curriculumId = job.payload.curriculumId as string;
      const item = FILM_CURRICULUM.find((f) => f.id === curriculumId);
      if (!item) return { ok: false, error: "unknown film curriculum id" };
      return learnFilm(item);
    }
    case "learn_technique": {
      const curriculumId = job.payload.curriculumId as string;
      const item = TECHNIQUE_CURRICULUM.find((t) => t.id === curriculumId);
      if (!item) return { ok: false, error: "unknown technique id" };
      return learnTechnique(item);
    }
    case "learn_ai_tool": {
      const curriculumId = job.payload.curriculumId as string;
      const item = AI_TOOL_CURRICULUM.find((t) => t.id === curriculumId);
      if (!item) return { ok: false, error: "unknown ai tool id" };
      return learnAiTool(item);
    }
    case "distill_corrections": {
      const limit = typeof job.payload.limit === "number" ? job.payload.limit : 30;
      return distillCorrections(limit);
    }
    case "reembed_submission": {
      const submissionId = job.payload.submissionId as string;
      if (!submissionId) return { ok: false, error: "missing submissionId" };
      return reembedSubmission(submissionId);
    }
    case "reembed_batch": {
      const limit = typeof job.payload.limit === "number" ? job.payload.limit : 20;
      return reembedBatch(limit);
    }
    case "prompt_insights": {
      const result = await writePromptInsights();
      return { ok: true, detail: result };
    }
    case "embed_missing": {
      return embedMissingArticles(typeof job.payload.limit === "number" ? job.payload.limit : 10);
    }
    case "rechunk_knowledge": {
      return rechunkArticles(typeof job.payload.limit === "number" ? job.payload.limit : 20);
    }
    case "discover_library": {
      return discoverLibrary();
    }
    default:
      return { ok: false, error: `unknown job type: ${job.job_type}` };
  }
}

/** Seed curriculum jobs that haven't run recently. */
async function seedCurriculumTrack<T extends { id: string }>(
  jobType: LearningJobType,
  items: T[],
  keyPrefix: string,
  batchSize: number,
  priority: number
): Promise<number> {
  const admin = createAdminClient();
  const { enqueueLearningJob } = await import("@/lib/learning/queue");
  let seeded = 0;

  const { data: recentJobs } = await admin
    .from("learning_jobs")
    .select("payload, completed_at")
    .eq("job_type", jobType)
    .eq("status", "done")
    .order("completed_at", { ascending: false })
    .limit(60);

  const recentlyDone = new Set(
    (recentJobs ?? [])
      .filter((j) => {
        if (!j.completed_at) return false;
        const hours = (Date.now() - new Date(j.completed_at as string).getTime()) / 3_600_000;
        return hours < 24;
      })
      .map((j) => (j.payload as { curriculumId?: string })?.curriculumId)
      .filter(Boolean)
  );

  const queue = items.filter((item) => !recentlyDone.has(item.id));

  for (const item of queue.slice(0, batchSize)) {
    const id = await enqueueLearningJob(
      jobType,
      { curriculumId: item.id },
      { dedupeKey: `${keyPrefix}:${item.id}`, priority }
    );
    if (id) seeded += 1;
  }

  return seeded;
}

/** Proactive curriculum: music videos independent of user submissions. */
export async function seedMusicVideoCurriculum(batchSize = 3): Promise<number> {
  return seedCurriculumTrack("learn_music_video", MUSIC_VIDEO_CURRICULUM, "curriculum:mv", batchSize, 12);
}

export async function seedFilmCurriculum(batchSize = 2): Promise<number> {
  return seedCurriculumTrack("learn_film", FILM_CURRICULUM, "curriculum:film", batchSize, 11);
}

export async function seedTechniqueCurriculum(batchSize = 2): Promise<number> {
  return seedCurriculumTrack("learn_technique", TECHNIQUE_CURRICULUM, "curriculum:technique", batchSize, 10);
}

export async function seedAiToolCurriculum(batchSize = 3): Promise<number> {
  return seedCurriculumTrack("learn_ai_tool", AI_TOOL_CURRICULUM, "curriculum:ai", batchSize, 14);
}

export async function seedAllCurriculum(batchSize = 2): Promise<number> {
  let seeded = 0;
  seeded += await seedAiToolCurriculum(Math.max(batchSize, 2));
  seeded += await seedMusicVideoCurriculum(batchSize);
  seeded += await seedFilmCurriculum(batchSize);
  seeded += await seedTechniqueCurriculum(batchSize);
  return seeded;
}

export async function seedRecurringLearningJobs(): Promise<number> {
  const admin = createAdminClient();
  const { enqueueLearningJob } = await import("@/lib/learning/queue");
  let seeded = await seedAllCurriculum(2);

  const recurring: { type: LearningJob["job_type"]; key: string; priority: number; payload?: Record<string, unknown> }[] = [
    { type: "discover_library", key: "recurring:discover", priority: 8 },
    { type: "ingest_learn", key: "recurring:learn", priority: 4 },
    { type: "distill_verified_batch", key: "recurring:distill", priority: 6, payload: { limit: 5 } },
    { type: "distill_corrections", key: "recurring:corrections", priority: 5, payload: { limit: 40 } },
    { type: "reembed_batch", key: "recurring:reembed", priority: 4, payload: { limit: 15 } },
    { type: "embed_missing", key: "recurring:embed", priority: 3, payload: { limit: 10 } },
    { type: "rechunk_knowledge", key: "recurring:rechunk", priority: 3, payload: { limit: 25 } },
    { type: "prompt_insights", key: "recurring:insights", priority: 2 },
  ];

  for (const job of recurring) {
    const { count } = await admin
      .from("learning_jobs")
      .select("id", { count: "exact", head: true })
      .eq("dedupe_key", job.key)
      .in("status", ["pending", "running"]);

    if ((count ?? 0) > 0) continue;

    const { data: lastDone } = await admin
      .from("learning_jobs")
      .select("completed_at")
      .eq("job_type", job.type)
      .eq("status", "done")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hoursSinceDone = lastDone?.completed_at
      ? (Date.now() - new Date(lastDone.completed_at as string).getTime()) / 3_600_000
      : 999;

    const minHours =
      job.type === "prompt_insights"
        ? 12
        : job.type === "discover_library"
          ? 1
          : job.type === "rechunk_knowledge"
            ? 24
            : 6;
    if (hoursSinceDone < minHours) continue;

    const id = await enqueueLearningJob(job.type, job.payload ?? {}, {
      dedupeKey: job.key,
      priority: job.priority,
    });
    if (id) seeded += 1;
  }

  const { data: sources } = await admin
    .from("learning_sources")
    .select("*")
    .eq("active", true)
    .order("priority", { ascending: false })
    .limit(5);

  for (const source of sources ?? []) {
    const hoursSince = source.last_run_at
      ? (Date.now() - new Date(source.last_run_at as string).getTime()) / 3_600_000
      : 999;
    if (hoursSince < (source.interval_hours as number)) continue;

    const dedupeKey = `source:${source.kind}:${slugify(source.value as string)}`;
    const id = await enqueueLearningJob(
      "research_topic",
      { query: source.value, tags: source.tags ?? [] },
      { dedupeKey, priority: source.priority as number }
    );
    if (id) {
      await admin.from("learning_sources").update({ last_run_at: new Date().toISOString() }).eq("id", source.id);
      seeded += 1;
    }
  }

  return seeded;
}
