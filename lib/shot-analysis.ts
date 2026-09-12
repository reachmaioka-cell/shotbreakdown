import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SHOT_MODEL } from "@/lib/constants";
import { formatKnowledgeBlock, retrieveKnowledge } from "@/lib/knowledge";
import { inferTagsFromText } from "@/lib/knowledge-query";
import { fetchAnalysisImage } from "@/lib/media";
import { formatAboutFilmmaker, type UserPreferences } from "@/lib/preferences";
import { SHOT_PROMPT_VERSION, shotSystemPrompt, type ShotSystemPrompt } from "@/lib/prompts/shot";
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
  /** What the uploader asked about the segment this shot belongs to. */
  focus?: string | null;
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

  const prompt = shotSystemPrompt({
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
    focus: input.focus ?? null,
  });

  const userText =
    input.images.length > 1
      ? `Analyse this shot from ${input.images.length} frames in order. Return the full shot record.`
      : "Analyse this shot. Return the full shot record.";

  // A one-shot segment makes one call, and a cache write costs 25% more than
  // plain input, so there is nothing to read it back. Only pay for the write
  // when there are later shots to spend it.
  const cacheShared = (input.shotCount ?? 1) > 1;

  try {
    return await callClaude(prompt, input.images, userText, cacheShared);
  } catch (first) {
    try {
      return await callClaude(
        prompt,
        input.images,
        `${userText}\n\nReturn valid JSON only, matching the schema exactly. No markdown.`,
        cacheShared
      );
    } catch {
      const message = first instanceof Error ? first.message : "Shot analysis failed";
      throw new ShotAnalysisError(message, !/api key|invalid_request/i.test(message));
    }
  }
}

/**
 * The request one shot call sends.
 *
 * A segment is N of these back to back, and the only thing that differs
 * between them is the per-shot line and the frames. So the shared half of the
 * system prompt carries the cache breakpoint: shot 1 writes the prefix at 125%
 * and shots 2..N read it at 10%. The output schema is the same on every call
 * and sits in the same prefix, which is why it is worth caching at all — the
 * schema is the single largest fixed block in the request.
 *
 * Exported so the breakpoint can be asserted without spending a call.
 */
export function shotRequestParams(
  prompt: ShotSystemPrompt,
  images: { buffer: Buffer; contentType: string }[],
  userText: string,
  cacheShared: boolean
): Anthropic.MessageCreateParamsNonStreaming {
  const blocks = images.map((i) => toImageBlock(i.buffer, i.contentType));
  return {
    model: SHOT_MODEL,
    max_tokens: 5000,
    system: [
      {
        type: "text",
        text: prompt.shared,
        ...(cacheShared ? { cache_control: { type: "ephemeral" as const } } : {}),
      },
      { type: "text", text: prompt.perShot },
    ],
    messages: [{ role: "user", content: [...blocks, { type: "text" as const, text: userText }] }],
    output_config: { format: zodOutputFormat(ShotRecordSchema) },
  };
}

async function callClaude(
  prompt: ShotSystemPrompt,
  images: { buffer: Buffer; contentType: string }[],
  userText: string,
  cacheShared: boolean
): Promise<StoredShotRecord> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await anthropic.messages.parse(
    shotRequestParams(prompt, images, userText, cacheShared)
  );

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
