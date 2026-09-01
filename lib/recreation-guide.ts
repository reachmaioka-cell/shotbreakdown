import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODEL } from "@/lib/constants";
import { formatKnowledgeBlock, retrieveKnowledge } from "@/lib/knowledge";
import { inferTagsFromText } from "@/lib/knowledge-query";
import { formatAboutFilmmaker, type UserPreferences } from "@/lib/preferences";
import { RECREATION_PROMPT_VERSION, recreationGuideSystemPrompt } from "@/lib/prompts/recreation";
import {
  RecreationGuideSchema,
  normalizeRecreationGuide,
  type RecreationGuide,
  type ShotMetadata,
} from "@/lib/validation";

export { RECREATION_PROMPT_VERSION };
export type { RecreationGuide };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

type ImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
};

function toImageBlock(buffer: Buffer, contentType: string): ImageBlock {
  const mime = IMAGE_TYPES.has(contentType) ? contentType : "image/jpeg";
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mime as ImageBlock["source"]["media_type"],
      data: buffer.toString("base64"),
    },
  };
}

export async function generateRecreationGuide(input: {
  images: { buffer: Buffer; contentType: string }[];
  metadata: ShotMetadata;
  videoTitle?: string | null;
  preferences?: UserPreferences | null;
  insights?: string | null;
}): Promise<RecreationGuide> {
  if (input.images.length === 0) {
    throw new Error("No frames to generate a recreation guide from");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const hintTags = inferTagsFromText(
    [input.videoTitle, input.metadata.one_line_summary, ...(input.metadata.tags ?? [])]
      .filter(Boolean)
      .join(" ")
  );
  const knowledge = await retrieveKnowledge(
    [
      input.videoTitle,
      input.metadata.description,
      input.metadata.one_line_summary,
      "cinematography recreation lighting lens",
    ]
      .filter(Boolean)
      .join(" "),
    5,
    { tags: hintTags }
  ).catch(() => []);

  const system = recreationGuideSystemPrompt({
    frameCount: input.images.length,
    aboutFilmmaker: formatAboutFilmmaker(input.preferences ?? null),
    failureModes: input.insights ?? undefined,
    knowledgeBlock: formatKnowledgeBlock(knowledge),
  });

  const recordJson = JSON.stringify(input.metadata);
  const userText = `Here is the existing library record for this shot. Write the recreation guide only.\n\n${recordJson}`;

  try {
    return await callClaude(system, input.images, userText);
  } catch (first) {
    try {
      return await callClaude(
        system,
        input.images,
        `${userText}\n\nReturn valid JSON only, matching the schema exactly. No markdown.`
      );
    } catch {
      throw first instanceof Error ? first : new Error("Recreation guide failed");
    }
  }
}

async function callClaude(
  system: string,
  images: { buffer: Buffer; contentType: string }[],
  userText: string
): Promise<RecreationGuide> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const blocks = images.map((i) => toImageBlock(i.buffer, i.contentType));

  const message = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 2500,
    system,
    messages: [{ role: "user", content: [...blocks, { type: "text" as const, text: userText }] }],
    output_config: { format: zodOutputFormat(RecreationGuideSchema) },
  });

  const parsed = message.parsed_output;
  if (!parsed) throw new Error("Claude returned no parsed recreation guide");
  return normalizeRecreationGuide(RecreationGuideSchema.parse(parsed));
}
