import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODEL } from "@/lib/constants";
import { formatKnowledgeBlock, retrieveKnowledge } from "@/lib/knowledge";
import { inferTagsFromText } from "@/lib/knowledge-query";
import { fetchAnalysisImage } from "@/lib/media";
import { formatAboutFilmmaker, type UserPreferences } from "@/lib/preferences";
import { SHOT_PROMPT_VERSION, shotSystemPrompt } from "@/lib/prompts/shot";
import {
  ShotRecordSchema,
  normalizeShotRecord,
  type StoredShotRecord,
} from "@/lib/validation";

export { SHOT_PROMPT_VERSION };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export class ShotAnalysisError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = "ShotAnalysisError";
    this.retryable = retryable;
  }
}

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

export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const frac = Math.floor((seconds - total) * 100);
  const base = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
  return `${base}.${String(frac).padStart(2, "0")}`;
}

export type ShotAnalysisInput = {
  /** Frames of this shot, chronological. Either buffers or URLs we can read. */
  images: { buffer: Buffer; contentType: string }[];
  videoTitle?: string | null;
  shotIndex?: number;
  shotCount?: number;
  startSeconds?: number;
  endSeconds?: number;
  neighbours?: string | null;
  preferences?: UserPreferences | null;
  insights?: string | null;
  similarBlock?: string | null;
};

export async function analyzeShotFrames(input: ShotAnalysisInput): Promise<StoredShotRecord> {
  if (input.images.length === 0) {
    throw new ShotAnalysisError("No frames to analyze", false);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ShotAnalysisError("ANTHROPIC_API_KEY is not configured", false);
  }

  const hintTags = inferTagsFromText(input.videoTitle ?? "");
  const knowledge = await retrieveKnowledge(
    [input.videoTitle, "cinematography lighting lens composition movement"].filter(Boolean).join(" "),
    5,
    { tags: hintTags }
  ).catch(() => []);

  const timecode =
    input.startSeconds != null && input.endSeconds != null
      ? `${formatTimecode(input.startSeconds)} – ${formatTimecode(input.endSeconds)}`
      : null;

  const system = shotSystemPrompt({
    frameCount: input.images.length,
    videoTitle: input.videoTitle,
    shotPosition:
      input.shotIndex != null && input.shotCount != null
        ? { index: input.shotIndex, total: input.shotCount }
        : null,
    timecode,
    neighbours: input.neighbours ?? undefined,
    aboutFilmmaker: formatAboutFilmmaker(input.preferences ?? null),
    failureModes: input.insights ?? undefined,
    knowledgeBlock: formatKnowledgeBlock(knowledge),
    similarBlock: input.similarBlock ?? undefined,
  });

  const userText =
    input.images.length > 1
      ? `Analyse this shot from ${input.images.length} frames in order. Return the full shot record.`
      : "Analyse this shot. Return the full shot record.";

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
      const message = first instanceof Error ? first.message : "Shot analysis failed";
      throw new ShotAnalysisError(message, !/api key|invalid_request/i.test(message));
    }
  }
}

async function callClaude(
  system: string,
  images: { buffer: Buffer; contentType: string }[],
  userText: string
): Promise<StoredShotRecord> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const blocks = images.map((i) => toImageBlock(i.buffer, i.contentType));

  const message = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 5000,
    system,
    messages: [{ role: "user", content: [...blocks, { type: "text" as const, text: userText }] }],
    output_config: { format: zodOutputFormat(ShotRecordSchema) },
  });

  const parsed = message.parsed_output;
  if (!parsed) throw new ShotAnalysisError("Claude returned no parsed shot record");
  return normalizeShotRecord(ShotRecordSchema.parse(parsed));
}

/** Load frames from URLs (signed storage URLs or public thumbnails). */
export async function loadFramesFromUrls(
  urls: string[]
): Promise<{ buffer: Buffer; contentType: string; url: string }[]> {
  const loaded = await Promise.all(
    urls.map(async (url) => {
      try {
        const { buffer, contentType } = await fetchAnalysisImage(url);
        if (buffer.byteLength < 4000) return null;
        return { buffer, contentType, url };
      } catch {
        return null;
      }
    })
  );
  return loaded.filter((f): f is { buffer: Buffer; contentType: string; url: string } => !!f);
}
