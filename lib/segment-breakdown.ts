import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODEL } from "@/lib/constants";
import { formatKnowledgeBlock, retrieveKnowledge } from "@/lib/knowledge";
import { inferTagsFromText } from "@/lib/knowledge-query";
import { formatAboutFilmmaker, type UserPreferences } from "@/lib/preferences";
import { SEGMENT_PROMPT_VERSION, segmentSystemPrompt } from "@/lib/prompts/segment";
import { formatTimecode } from "@/lib/shot-format";
import {
  SegmentBreakdownSchema,
  normalizeSegmentBreakdown,
  type SegmentBreakdown,
  type ShotMetadata,
} from "@/lib/validation";

export { SEGMENT_PROMPT_VERSION };

/**
 * Frames sent to the model.
 *
 * Each 1280px frame is roughly 1.2k tokens, so twelve frames plus the facet
 * records and the prompt lands around 25k input tokens. Beyond that the cost
 * climbs faster than the answer improves: the facet records already carry what
 * each shot looks like, and the frames are there so the model can read the
 * things a record cannot hold — continuity, eyelines, how two shots cut.
 */
export const MAX_BREAKDOWN_FRAMES = 12;

export class SegmentBreakdownError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = "SegmentBreakdownError";
    this.retryable = retryable;
  }
}

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

export type SegmentShotInput = {
  shotIndex: number;
  startSeconds: number;
  endSeconds: number;
  metadata: ShotMetadata | null;
  /** Representative frame, when one could be read. */
  image?: { buffer: Buffer; contentType: string } | null;
};

/**
 * Which shots get a frame in the prompt.
 *
 * First and last always, because the segment's entry and exit are what the
 * edit hangs on, then an even spread across the middle. Under the cap every
 * shot gets one.
 */
export function selectFrameIndices(shotCount: number, max = MAX_BREAKDOWN_FRAMES): number[] {
  if (shotCount <= 0) return [];
  if (shotCount <= max) return Array.from({ length: shotCount }, (_, i) => i);

  const picked = new Set<number>([0, shotCount - 1]);
  // Distribute the remaining slots across the interior, ends already taken.
  const remaining = max - picked.size;
  for (let i = 1; i <= remaining; i += 1) {
    picked.add(Math.round((i * (shotCount - 1)) / (remaining + 1)));
  }
  // Rounding can collide; walk forward to fill back up to the cap.
  for (let i = 1; picked.size < max && i < shotCount - 1; i += 1) picked.add(i);

  return [...picked].sort((a, b) => a - b).slice(0, max);
}

export function shotTimecode(startSeconds: number, endSeconds: number): string {
  return `${formatTimecode(startSeconds)}-${formatTimecode(endSeconds)}`;
}

/**
 * The facet record, compressed to what a department head would actually use.
 *
 * Sending the whole record for thirty shots wastes thousands of tokens on
 * fields nobody reads at this altitude (hex colours, embeddings, tag lists).
 */
function compactRecord(shot: SegmentShotInput): string {
  const m = shot.metadata;
  const parts: Record<string, unknown> = {
    shot: shot.shotIndex,
    tc: shotTimecode(shot.startSeconds, shot.endSeconds),
    dur: Number((shot.endSeconds - shot.startSeconds).toFixed(2)),
  };
  if (m) {
    if (m.one_line_summary) parts.summary = m.one_line_summary;
    if (m.description) parts.description = m.description;
    if (m.composition) {
      parts.framing = [
        m.composition.shot_size,
        m.composition.camera_angle,
        m.composition.camera_height ? `${m.composition.camera_height} height` : null,
      ]
        .filter(Boolean)
        .join(" / ");
      if (m.composition.framing) parts.composition = m.composition.framing;
      if (m.composition.depth) parts.depth = m.composition.depth;
    }
    if (m.movement_facets) {
      parts.movement = [
        m.movement_facets.type,
        m.movement_facets.direction !== "none" ? m.movement_facets.direction : null,
        m.movement_facets.speed !== "none" ? m.movement_facets.speed : null,
      ]
        .filter(Boolean)
        .join(" ");
    }
    if (m.rig_guess) parts.rig = m.rig_guess;
    if (m.optics) {
      parts.lens = [m.optics.lens_type, m.optics.focal_length_range, `${m.optics.depth_of_field} DOF`]
        .filter(Boolean)
        .join(" / ");
    }
    if (m.lighting_facets) {
      const l = m.lighting_facets;
      parts.light = [
        l.quality,
        l.key_level,
        l.key_direction ? `key from ${l.key_direction}` : null,
        l.source,
        l.contrast ? `${l.contrast} contrast` : null,
        l.color_temperature,
        l.backlight ? "backlight" : null,
        l.rim_light ? "rim" : null,
        l.silhouette ? "silhouette" : null,
        l.practicals_visible ? "practicals in frame" : null,
      ]
        .filter(Boolean)
        .join(", ");
    }
    if (m.lighting_notes) parts.light_notes = m.lighting_notes;
    if (m.color_facets?.palette) parts.palette = m.color_facets.palette;
    if (m.color_notes) parts.color_notes = m.color_notes;
    if (m.environment) {
      parts.where = [
        m.environment.interior_exterior,
        m.environment.location_type,
        m.environment.time_of_day,
        m.environment.weather && m.environment.weather !== "none" ? m.environment.weather : null,
      ]
        .filter(Boolean)
        .join(", ");
    }
    if (m.subject?.description) parts.subject = m.subject.description;
    if (m.mood?.length) parts.mood = m.mood.join(", ");
    if (m.ai_tools && !/^none/i.test(m.ai_tools)) parts.ai = m.ai_tools;
  }
  return JSON.stringify(parts);
}

export async function generateSegmentBreakdown(input: {
  shots: SegmentShotInput[];
  focus?: string | null;
  videoTitle?: string | null;
  segmentSeconds: number;
  preferences?: UserPreferences | null;
  insights?: string | null;
}): Promise<SegmentBreakdown> {
  if (input.shots.length === 0) {
    throw new SegmentBreakdownError("This segment has no analysed shots", false);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new SegmentBreakdownError("ANTHROPIC_API_KEY is not configured", false);
  }

  const withImages = input.shots.filter((s) => s.image);

  const hintText = [
    input.videoTitle,
    input.focus,
    ...input.shots.map((s) => s.metadata?.one_line_summary ?? ""),
  ]
    .filter(Boolean)
    .join(" ");
  const knowledge = await retrieveKnowledge(
    [input.focus, input.videoTitle, "cinematography lighting lens editing colour production"]
      .filter(Boolean)
      .join(" "),
    6,
    { tags: inferTagsFromText(hintText) }
  ).catch(() => []);

  const system = segmentSystemPrompt({
    shotCount: input.shots.length,
    frameCount: withImages.length,
    segmentSeconds: input.segmentSeconds,
    focus: input.focus ?? null,
    videoTitle: input.videoTitle ?? null,
    aboutFilmmaker: formatAboutFilmmaker(input.preferences ?? null),
    failureModes: input.insights ?? undefined,
    knowledgeBlock: formatKnowledgeBlock(knowledge),
  });

  // Each frame is announced before it is shown, so the model can attribute a
  // frame to a shot number instead of guessing from order.
  const content: Anthropic.ContentBlockParam[] = [];
  for (const shot of withImages) {
    content.push({
      type: "text",
      text: `Shot ${shot.shotIndex} · ${shotTimecode(shot.startSeconds, shot.endSeconds)} · representative frame`,
    });
    content.push(toImageBlock(shot.image!.buffer, shot.image!.contentType) as Anthropic.ImageBlockParam);
  }

  content.push({
    type: "text",
    text: `Facet records for every shot in this segment, one per line:\n${input.shots
      .map(compactRecord)
      .join("\n")}`,
  });

  content.push({
    type: "text",
    text: input.focus
      ? `The uploader asked: "${input.focus}"\n\nWrite the segment breakdown. Answer their question in focus_answer first, then fill every other field.`
      : "The uploader asked nothing specific. Write the segment breakdown, leaving focus_answer empty.",
  });

  try {
    return await callClaude(system, content, input.shots);
  } catch (first) {
    const retryContent: Anthropic.ContentBlockParam[] = [
      ...content,
      {
        type: "text",
        text: "Return valid JSON only, matching the schema exactly. No markdown. Include all nine departments.",
      },
    ];
    try {
      return await callClaude(system, retryContent, input.shots);
    } catch {
      const message = first instanceof Error ? first.message : "Segment breakdown failed";
      throw new SegmentBreakdownError(message, !/api key|invalid_request/i.test(message));
    }
  }
}

async function callClaude(
  system: string,
  content: Anthropic.ContentBlockParam[],
  shots: SegmentShotInput[]
): Promise<SegmentBreakdown> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(SegmentBreakdownSchema) },
  });

  const parsed = message.parsed_output;
  if (!parsed) throw new SegmentBreakdownError("Claude returned no parsed segment breakdown");

  return normalizeSegmentBreakdown(
    SegmentBreakdownSchema.parse(parsed),
    shots.map((s) => ({
      shotIndex: s.shotIndex,
      timecode: shotTimecode(s.startSeconds, s.endSeconds),
      summary: s.metadata?.one_line_summary ?? null,
    }))
  );
}
