import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODEL } from "@/lib/constants";
import { formatKnowledgeBlock, retrieveKnowledge } from "@/lib/knowledge";
import { fetchAnalysisImage } from "@/lib/media";
import {
  inferTagsFromText,
  knowledgeQueryFromContext,
  looksAiGenerated,
} from "@/lib/knowledge-query";
import { breakdownSystemPrompt, PROMPT_VERSION } from "@/lib/prompts/breakdown";
import { formatGoldExamples } from "@/lib/prompts/examples";
import { formatAboutFilmmaker, type UserPreferences } from "@/lib/preferences";
import { formatResearchBlock, gatherClipResearch, type ResearchContext } from "@/lib/research";
import {
  BreakdownSchema,
  normalizeBreakdown,
  type Breakdown,
} from "@/lib/validation";

export { PROMPT_VERSION };
export type { Breakdown, ResearchContext };

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function analyzeShot(options: {
  imageUrls: string[];
  similar?: Breakdown[];
  preferences?: UserPreferences | null;
  insights?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  title?: string | null;
}): Promise<{ breakdown: Breakdown; research: ResearchContext | null }> {
  const imageUrls = options.imageUrls.filter(Boolean);
  if (imageUrls.length === 0) {
    throw new Error("No frames to analyze");
  }

  const research = await gatherClipResearch({
    sourceUrl: options.sourceUrl,
    sourceType: options.sourceType,
    title: options.title,
  });

  const researchText = [
    research.description ?? "",
    ...research.snippets.map((s) => `${s.title} ${s.excerpt}`),
  ].join(" ");

  const hintTags = inferTagsFromText(
    [options.title, researchText, options.sourceType].filter(Boolean).join(" ")
  );

  const knowledgeQuery = knowledgeQueryFromContext({
    title: options.title,
    creator: research.creator,
    description: research.description,
    gearMentions: research.gearMentions,
    tags: hintTags,
  });

  const aiLikely =
    looksAiGenerated(researchText) || looksAiGenerated(options.title ?? "");

  const [knowledge, aiKnowledge] = await Promise.all([
    retrieveKnowledge(knowledgeQuery || "cinematography lighting lens movement", 6, {
      tags: hintTags,
    }),
    aiLikely
      ? retrieveKnowledge(
          `AI video image generation ${options.title ?? ""} Runway Pika Sora workflow prompt`,
          4,
          { tags: ["ai-generated", ...hintTags] }
        )
      : Promise.resolve([]),
  ]);

  const mergedKnowledge = [...knowledge];
  for (const article of aiKnowledge) {
    if (!mergedKnowledge.some((k) => k.slug === article.slug)) {
      mergedKnowledge.push(article);
    }
  }
  if (mergedKnowledge.length > 8) mergedKnowledge.length = 8;

  const similarBlock =
    options.similar && options.similar.length > 0
      ? options.similar.map((b, i) => `Example ${i + 1}:\n${JSON.stringify(b)}`).join("\n\n")
      : formatGoldExamples(hintTags);

  const system = breakdownSystemPrompt({
    similarBlock,
    aboutFilmmaker: formatAboutFilmmaker(options.preferences ?? null),
    failureModes: options.insights ?? undefined,
    researchBlock: formatResearchBlock(research),
    knowledgeBlock: formatKnowledgeBlock(mergedKnowledge),
    frameCount: imageUrls.length,
  });

  const userText =
    imageUrls.length > 1
      ? `Analyze this shot from ${imageUrls.length} frames in order. Return the cinematography breakdown.`
      : "Analyze this shot. Return the cinematography breakdown.";

  try {
    const breakdown = await callClaude(system, imageUrls, userText);
    return { breakdown, research };
  } catch (first) {
    const nudged = `${userText}\n\nReturn valid JSON only. Match the schema exactly. No markdown.`;
    try {
      const breakdown = await callClaude(system, imageUrls, nudged);
      return { breakdown, research };
    } catch {
      throw first instanceof Error ? first : new Error("Analysis failed");
    }
  }
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

async function imageBlock(url: string): Promise<{
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
}> {
  try {
    const { buffer: data, contentType } = await fetchAnalysisImage(url);
    const mime = contentType || "image/jpeg";
    const media_type = (IMAGE_TYPES.has(mime) ? mime : "image/jpeg") as
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp";
    if (data.byteLength < 8000) throw new Error("placeholder thumbnail");
    return {
      type: "image",
      source: { type: "base64", media_type, data: data.toString("base64") },
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error("Could not load frame");
  }
}

async function callClaude(system: string, imageUrls: string[], userText: string): Promise<Breakdown> {
  const anthropic = client();
  const images = await Promise.all(imageUrls.map(imageBlock));
  const message = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [
      {
        role: "user",
        content: [...images, { type: "text" as const, text: userText }],
      },
    ],
    output_config: {
      format: zodOutputFormat(BreakdownSchema),
    },
  });

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error("Claude returned no parsed breakdown");
  }
  return normalizeBreakdown(BreakdownSchema.parse(parsed));
}

export { extractYoutubeId } from "@/lib/source";
export { tiktokOembed as extractTiktokThumbnail } from "@/lib/source";
