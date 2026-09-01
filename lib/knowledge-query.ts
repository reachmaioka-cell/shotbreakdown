import type { Breakdown } from "@/lib/validation";

/** Build a retrieval query from clip context (pre-breakdown). */
export function knowledgeQueryFromContext(input: {
  title?: string | null;
  creator?: string | null;
  description?: string | null;
  gearMentions?: string[];
  tags?: string[];
  question?: string;
}): string {
  return [
    input.question,
    input.title,
    input.creator,
    input.description?.slice(0, 240),
    input.tags?.join(" "),
    ...input.gearMentions?.slice(0, 5) ?? [],
    "cinematography lens lighting movement",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Build a retrieval query from a completed breakdown. */
export function knowledgeQueryFromBreakdown(
  breakdown: Breakdown,
  meta?: { title?: string | null; question?: string }
): string {
  return [
    meta?.question,
    meta?.title,
    breakdown.one_line_summary,
    breakdown.tags.join(" "),
    breakdown.shot_type,
    breakdown.lens,
    breakdown.lighting.key,
    breakdown.lighting.ratio_est,
    breakdown.movement.type,
    breakdown.movement.rig_guess,
    breakdown.color.look,
    breakdown.post_production?.ai_tools,
    breakdown.vfx.join(" "),
    "cinematography shot breakdown",
  ]
    .filter(Boolean)
    .join(" ");
}

export function extractQueryTags(query: string, extra: string[] = []): string[] {
  const fromQuery = query
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 3)
    .slice(0, 12);
  return [...new Set([...extra.map((t) => t.toLowerCase()), ...fromQuery])];
}

export function tagOverlapScore(articleTags: string[], queryTags: string[]): number {
  if (!articleTags.length || !queryTags.length) return 0;
  const set = new Set(queryTags.map((t) => t.toLowerCase()));
  let hits = 0;
  for (const tag of articleTags) {
    const t = tag.toLowerCase();
    if (set.has(t)) hits += 1;
    else if ([...set].some((q) => t.includes(q) || q.includes(t))) hits += 0.5;
  }
  return hits / Math.max(articleTags.length, queryTags.length);
}

/** Guess likely shot tags from title/research text before breakdown exists. */
export function inferTagsFromText(text: string): string[] {
  const t = text.toLowerCase();
  const tags: string[] = [];
  const rules: [RegExp, string][] = [
    [/music.?video|\bmv\b/, "music-video"],
    [/neon|night.?exterior|street.?light/, "night-exterior"],
    [/golden.?hour|sunset|sunrise/, "golden-hour"],
    [/anamorphic|2\.39|scope/, "anamorphic"],
    [/handheld|documentary/, "handheld"],
    [/gimbal|steadicam|push.?in/, "gimbal"],
    [/studio|seamless|three.?point/, "studio"],
    [/natural.?light|window.?light/, "natural-light"],
    [/runway|pika|sora|midjourney|flux|comfyui|ai.?gener/, "ai-generated"],
    [/vfx|cgi|composit/, "vfx"],
    [/drone|aerial/, "drone"],
    [/close.?up|mcu|macro/, "medium-close-up"],
    [/wide.?shot|establish/, "wide-shot"],
  ];
  for (const [re, tag] of rules) {
    if (re.test(t)) tags.push(tag);
  }
  return [...new Set(tags)];
}

export function looksAiGenerated(text: string): boolean {
  return /runway|pika|sora|kling|midjourney|flux|ai.?gener|comfyui|luma|veo|haiper|minimax/i.test(
    text
  );
}
