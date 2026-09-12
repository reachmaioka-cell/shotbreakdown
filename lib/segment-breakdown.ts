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
import { describeMotion, type MotionProfile } from "@/lib/video/motion";

export { SEGMENT_PROMPT_VERSION };

/**
 * Frames sent to the model.
 *
 * The pipeline scales each frame to 768px before it goes in the request, about
 * 450 tokens, so eight of them plus the facet records and the prompt lands
 * around 12k input tokens. Eight rather than twelve because a segment is
 * capped at fifteen seconds: that is five to ten shots, and the twelfth frame
 * of a segment that short is a third sample of a shot whose facet record
 * already says what it looks like. The frames are here for what a record
 * cannot hold — continuity, eyelines, how two shots cut.
 *
 * What the budget still has to protect is the other end: planFrameBudget hands
 * a one- or two-shot segment every candidate frame it has, because comparing
 * frames inside a shot is the only way a held, ramped or reversed move can be
 * read at all.
 */
export const MAX_BREAKDOWN_FRAMES = 8;

export class SegmentBreakdownError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = "SegmentBreakdownError";
    this.retryable = retryable;
  }
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export type ImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
};

/** Exported so the AI-recreation generator sends frames the same way. */
export function toImageBlock(buffer: Buffer, contentType: string): ImageBlock {
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

export type SegmentFrame = {
  buffer: Buffer;
  contentType: string;
  /** Position in the segment's timeline, so the model can read change over time. */
  timestampSeconds: number;
};

export type SegmentShotInput = {
  shotIndex: number;
  startSeconds: number;
  endSeconds: number;
  metadata: ShotMetadata | null;
  /**
   * Frames of this shot in time order. One frame cannot show motion, and a
   * single-shot segment used to get exactly one: a 24fps clip full of
   * frame-blended traffic was read as a still photograph held on the timeline,
   * because from one frame that is indistinguishable from a time remap.
   */
  images?: SegmentFrame[];
  /** The representative frame alone. Kept for callers that still send one. */
  image?: { buffer: Buffer; contentType: string } | null;
  /**
   * Frame-to-frame change across the shot. A dozen stills can show that
   * traffic smeared; they cannot show that it ramped, held and ran backwards
   * between them, and that post half is what an editor came here for. Null on
   * rows ingested before the profile was measured.
   */
  motion?: MotionProfile | null;
};

/**
 * How many frames each shot gets out of a fixed budget.
 *
 * Few shots means more frames each, so temporal effects inside a shot are
 * visible; many shots means one representative frame each, chosen by
 * selectFrameIndices so the segment's ends are always covered.
 */
export function planFrameBudget(candidatesPerShot: number[], max = MAX_BREAKDOWN_FRAMES): number[] {
  const n = candidatesPerShot.length;
  if (n === 0 || max <= 0) return [];
  if (n > max) {
    const chosen = new Set(selectFrameIndices(n, max));
    return candidatesPerShot.map((c, i) => (chosen.has(i) && c > 0 ? 1 : 0));
  }
  const base = Math.max(1, Math.floor(max / n));
  const alloc = candidatesPerShot.map((c) => Math.min(c, base));
  let used = alloc.reduce((a, b) => a + b, 0);
  for (let pass = 0; used < max && pass < max; pass += 1) {
    let grew = false;
    for (let i = 0; i < n && used < max; i += 1) {
      if (alloc[i] < candidatesPerShot[i]) {
        alloc[i] += 1;
        used += 1;
        grew = true;
      }
    }
    if (!grew) break;
  }
  return alloc;
}

/**
 * Pick `count` frames spread across a shot's time-ordered candidates. The
 * first and last are always kept when two or more are taken, because the
 * change between them is what a temporal effect looks like.
 */
export function spreadFrames<T>(ordered: T[], count: number, representative?: T): T[] {
  if (count <= 0 || ordered.length === 0) return [];
  if (count >= ordered.length) return ordered;
  if (count === 1) return [representative && ordered.includes(representative) ? representative : ordered[0]];
  const out: T[] = [];
  for (let j = 0; j < count; j += 1) {
    out.push(ordered[Math.round((j * (ordered.length - 1)) / (count - 1))]);
  }
  return [...new Set(out)];
}

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
 *
 * Exported because the AI-recreation pass reads the same records. A second copy
 * would drift the moment either prompt learned something about what a
 * department actually needs.
 */
/**
 * The motion lines as their own block, or null when nothing was measured.
 *
 * Its own block rather than a field of the record: the frames dominate the
 * model's reading, and a ramp through zero buried in a line of JSON was read
 * past. One sample is a single frame pair, with no series to read a ramp or a
 * hold from, so a shot with one is left out.
 *
 * Exported because the AI-recreation pass answers the same segment and has to
 * imitate the same ramps, holds and reverses.
 */
export function motionBlock(shots: SegmentShotInput[]): string | null {
  const lines = shots
    .filter((shot): shot is SegmentShotInput & { motion: MotionProfile } =>
      Boolean(shot.motion && shot.motion.scores.length >= 2)
    )
    .map((shot) => `Shot ${shot.shotIndex}: ${describeMotion(shot.motion)}`);
  if (lines.length === 0) return null;
  return `Motion profile of each shot, measured frame to frame across the whole shot (the frames above are samples; this is what happened between them):\n${lines.join("\n")}`;
}

export function compactRecord(shot: SegmentShotInput): string {
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
  /** Frames per second of the analysed file. Bounds what a shutter can have done. */
  fps?: number | null;
  preferences?: UserPreferences | null;
  insights?: string | null;
  /**
   * Which model writes it. Defaults to MODEL, so production is unchanged; a
   * comparison passes a candidate here rather than standing up a second
   * generator that would answer a different prompt than the product does.
   */
  model?: string;
  /**
   * Called with the usage of every call this makes, the retry included.
   *
   * Without it the only way to price a breakdown is to rebuild its request
   * outside this function and count that instead, which is how a measurement
   * stops measuring the thing it names. Ignored by production.
   */
  onUsage?: (usage: Anthropic.Usage, model: string) => void;
}): Promise<SegmentBreakdown> {
  if (input.shots.length === 0) {
    throw new SegmentBreakdownError("This segment has no analysed shots", false);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new SegmentBreakdownError("ANTHROPIC_API_KEY is not configured", false);
  }

  const framesOf = (shot: SegmentShotInput): SegmentFrame[] =>
    shot.images && shot.images.length > 0
      ? shot.images
      : shot.image
        ? [{ ...shot.image, timestampSeconds: shot.startSeconds }]
        : [];
  const withImages = input.shots.filter((s) => framesOf(s).length > 0);
  const frameCount = withImages.reduce((n, s) => n + framesOf(s).length, 0);

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
    frameCount,
    segmentSeconds: input.segmentSeconds,
    fps: input.fps ?? null,
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
    const frames = framesOf(shot);
    frames.forEach((frame, i) => {
      content.push({
        type: "text",
        text: `Shot ${shot.shotIndex} · ${shotTimecode(shot.startSeconds, shot.endSeconds)} · frame ${i + 1} of ${frames.length} at ${formatTimecode(frame.timestampSeconds)}`,
      });
      content.push(toImageBlock(frame.buffer, frame.contentType) as Anthropic.ImageBlockParam);
    });
  }

  const motion = motionBlock(input.shots);
  if (motion) content.push({ type: "text", text: motion });

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

  const model = input.model ?? MODEL;

  try {
    return await callClaude(system, content, input.shots, model, input.onUsage);
  } catch (first) {
    const retryContent: Anthropic.ContentBlockParam[] = [
      ...content,
      {
        type: "text",
        text: "Return valid JSON only, matching the schema exactly. No markdown. Include all nine departments.",
      },
    ];
    try {
      return await callClaude(system, retryContent, input.shots, model, input.onUsage);
    } catch {
      const message = first instanceof Error ? first.message : "Segment breakdown failed";
      throw new SegmentBreakdownError(message, !/api key|invalid_request/i.test(message));
    }
  }
}

/*
 * No cache_control on this call, deliberately.
 *
 * A segment gets exactly one breakdown, so a cached prefix would be written at
 * 125% and never read: caching here is a pure loss. The per-shot call is the
 * opposite shape — N calls with the same prefix — and that is where the
 * breakpoint lives (lib/shot-analysis.ts).
 */
async function callClaude(
  system: string,
  content: Anthropic.ContentBlockParam[],
  shots: SegmentShotInput[],
  model: string = MODEL,
  onUsage?: (usage: Anthropic.Usage, model: string) => void
): Promise<SegmentBreakdown> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  /*
   * create() rather than parse(), so the tokens are counted even when the
   * document does not arrive. parse() validates before it returns, so a model
   * that overran max_tokens and truncated its JSON throws with the usage still
   * inside the response we never got to read — and the call that failed is
   * exactly the one worth costing, because choosing a model is a money
   * decision here. A truncated reply is billed in full either way.
   */
  const message = await anthropic.messages.create({
    model,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(SegmentBreakdownSchema) },
  });
  onUsage?.(message.usage, model);

  const raw = message.content.find((block) => block.type === "text");
  let parsed: unknown = null;
  if (raw && raw.type === "text") {
    try {
      parsed = JSON.parse(raw.text);
    } catch {
      parsed = null;
    }
  }
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
