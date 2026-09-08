import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODEL } from "@/lib/constants";
import { formatKnowledgeBlock, retrieveKnowledge } from "@/lib/knowledge";
import { inferTagsFromText } from "@/lib/knowledge-query";
import { formatAboutFilmmaker, type UserPreferences } from "@/lib/preferences";
import { AI_RECREATION_PROMPT_VERSION, aiRecreationSystemPrompt } from "@/lib/prompts/ai-recreation";
import {
  compactRecord,
  MAX_BREAKDOWN_FRAMES,
  shotTimecode,
  toImageBlock,
  type SegmentShotInput,
} from "@/lib/segment-breakdown";
import {
  AiRecreationSchema,
  type AiRecreation,
  type StoredSegmentBreakdown,
} from "@/lib/validation";

export { AI_RECREATION_PROMPT_VERSION };

/**
 * Frames sent to the model.
 *
 * The same budget as the breakdown, and deliberately the same number: this pass
 * is answering the same segment from the other side, so a frame worth showing a
 * gaffer is a frame worth showing whoever writes the prompts.
 */
export const MAX_AI_FRAMES = MAX_BREAKDOWN_FRAMES;

export class AiRecreationError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = "AiRecreationError";
    this.retryable = retryable;
  }
}

/**
 * The camera-route answer, reduced to what the generative route can use.
 *
 * The prompts, the shot order, the look and what post already had to do are all
 * evidence here. Budget tiers, prep checklists and gear lists are not: nobody
 * generating this segment is renting a 10-stop ND, and paying to send those
 * fields buys a worse answer, not a better one.
 */
function compactBreakdown(breakdown: StoredSegmentBreakdown): string {
  return JSON.stringify({
    title: breakdown.title,
    what_happens: breakdown.what_happens,
    setting: breakdown.setting,
    approach: breakdown.approach,
    difficulty: breakdown.difficulty,
    focus_answer: breakdown.focus_answer || undefined,
    shot_sequence: breakdown.shot_sequence,
    post_production: breakdown.post_production,
    departments: breakdown.departments.map((d) => ({
      role: d.role,
      headline: d.headline,
      steps: d.steps,
    })),
  });
}

export async function generateAiRecreation(input: {
  shots: SegmentShotInput[];
  breakdown: StoredSegmentBreakdown;
  focus?: string | null;
  videoTitle?: string | null;
  segmentSeconds: number;
  preferences?: UserPreferences | null;
  insights?: string | null;
}): Promise<AiRecreation> {
  if (input.shots.length === 0) {
    throw new AiRecreationError("This segment has no analysed shots", false);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiRecreationError("ANTHROPIC_API_KEY is not configured", false);
  }

  const withImages = input.shots.filter((s) => s.image);

  const hintText = [
    input.videoTitle,
    input.focus,
    input.breakdown.what_happens,
    ...input.shots.map((s) => s.metadata?.one_line_summary ?? ""),
  ]
    .filter(Boolean)
    .join(" ");
  const knowledge = await retrieveKnowledge(
    [
      input.focus,
      input.videoTitle,
      "generative video AI prompting image-to-video model settings consistency",
    ]
      .filter(Boolean)
      .join(" "),
    6,
    { tags: inferTagsFromText(hintText) }
  ).catch(() => []);

  const system = aiRecreationSystemPrompt({
    shotCount: input.shots.length,
    frameCount: withImages.length,
    segmentSeconds: input.segmentSeconds,
    focus: input.focus ?? null,
    videoTitle: input.videoTitle ?? null,
    failureModes: input.insights ?? undefined,
    aboutFilmmaker: formatAboutFilmmaker(input.preferences ?? null),
    knowledgeBlock: formatKnowledgeBlock(knowledge),
  });

  // Each frame is announced before it is shown, so the model can attribute a
  // frame to a shot number instead of guessing from order. The prompts it
  // writes are targeted by shot, so that attribution has to be right.
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
    text: `The breakdown already written for the camera route:\n${compactBreakdown(input.breakdown)}`,
  });

  content.push({
    type: "text",
    text: input.focus
      ? `The uploader asked: "${input.focus}"\n\nWrite the generative recreation for this exact segment. Be honest about what current tools will not do.`
      : "Write the generative recreation for this exact segment. Be honest about what current tools will not do.",
  });

  try {
    return await callClaude(system, content);
  } catch (first) {
    const retryContent: Anthropic.ContentBlockParam[] = [
      ...content,
      {
        type: "text",
        text: "Return valid JSON only, matching the schema exactly. No markdown. Write the prompts out in full.",
      },
    ];
    try {
      return await callClaude(system, retryContent);
    } catch {
      const message = first instanceof Error ? first.message : "AI recreation failed";
      throw new AiRecreationError(message, !/api key|invalid_request/i.test(message));
    }
  }
}

async function callClaude(
  system: string,
  content: Anthropic.ContentBlockParam[]
): Promise<AiRecreation> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 6000,
    system,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(AiRecreationSchema) },
  });

  const parsed = message.parsed_output;
  if (!parsed) throw new AiRecreationError("Claude returned no parsed AI recreation");

  return normalizeAiRecreation(AiRecreationSchema.parse(parsed));
}

/**
 * Trim, drop empties, dedupe, cap.
 *
 * Local rather than in lib/validation.ts: that file is owned by another pass
 * right now, and this normalizer is not shared with anything else yet. If a
 * second caller appears it belongs beside normalizeSegmentPost.
 */
function cleanList(values: string[] | undefined, max: number, maxLen = 400): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = String(raw)
      // Strip a real list marker — "1.", "2)", "Step 3:" — and nothing else.
      // The lookahead is load-bearing: `settings` is the one field whose whole
      // job is carrying values, so without it "3.5 CFG scale" is stored as
      // "5 CFG scale" and "16:9 aspect" as "9 aspect". A reader pastes the
      // mangled number into a model and gets a different picture, with nothing
      // on the page to say why.
      .replace(/^\s*(?:step\s*)?\d+[.):](?!\d)\s*/i, "")
      .trim()
      .slice(0, maxLen);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeAiRecreation(raw: AiRecreation): AiRecreation {
  const seenTools = new Set<string>();
  const tools = (raw.tools ?? [])
    .map((tool) => ({
      name: (tool?.name ?? "").trim().slice(0, 80),
      role: (tool?.role ?? "").trim().slice(0, 300),
    }))
    // A tool with no stated role in THIS pipeline is the padding the prompt
    // forbids, so it is dropped rather than rendered as a bare brand name.
    .filter((tool) => {
      if (!tool.name || !tool.role) return false;
      const key = tool.name.toLowerCase();
      if (seenTools.has(key)) return false;
      seenTools.add(key);
      return true;
    })
    .slice(0, 10);

  const seenPrompts = new Set<string>();
  const prompts = (raw.prompts ?? [])
    .map((prompt) => ({
      target: (prompt?.target ?? "").trim().slice(0, 120),
      // Generous: a usable generative prompt is a paragraph, and truncating one
      // mid-clause hands the reader something that will not paste.
      text: (prompt?.text ?? "").trim().slice(0, 2000),
    }))
    .filter((prompt) => {
      if (!prompt.text) return false;
      const key = prompt.text.toLowerCase();
      if (seenPrompts.has(key)) return false;
      seenPrompts.add(key);
      return true;
    })
    .slice(0, 20);

  return {
    feasibility: raw.feasibility,
    verdict: raw.verdict.trim().slice(0, 2000),
    approach: raw.approach.trim().slice(0, 1200),
    tools,
    prompts,
    // Long caps on purpose. These four are prose, not labels: a real hard part
    // is a paragraph saying why a model fails on this material, and a run
    // against a fractal shot came back with one clipped mid-word at 400.
    workflow: cleanList(raw.workflow, 14, 700),
    settings: cleanList(raw.settings, 12, 500),
    hard_parts: cleanList(raw.hard_parts, 8, 700),
    cleanup: cleanList(raw.cleanup, 8, 700),
  };
}
