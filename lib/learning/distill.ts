import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/constants";

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/** Turn raw web/clip snippets into a dense, retrieval-friendly filmmaking article. */
export async function distillSnippetsToArticle(options: {
  title: string;
  rawContent: string;
  tags: string[];
  kind: "curriculum" | "web" | "clip_research" | "correction";
}): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || options.rawContent.trim().length < 80) {
    return options.rawContent.slice(0, 12000);
  }

  const system = [
    "You distill filmmaking research into dense reference articles for a cinematography AI.",
    "Write 400–900 words in plain markdown. No fluff. Commit to specifics.",
    "Structure when applicable:",
    "- ## Overview (1–2 sentences)",
    "- ## Camera & lens (focal length, format, movement rig guesses)",
    "- ## Lighting (key/fill/back, ratio, motivation, gear names)",
    "- ## Color & grade (look, contrast, LUT/process)",
    "- ## Post, VFX & AI tools (editing, comp, Runway/Pika/etc if relevant)",
    "- ## Recreation tips (3–5 imperative steps a filmmaker can do this week)",
    "- ## Common mistakes (2–3, specific)",
    "Drop sections that don't apply. Never invent crew quotes. Prefer concrete gear and numbers from sources.",
  ].join("\n");

  try {
    const res = await client().messages.create({
      model: MODEL,
      max_tokens: 1800,
      system,
      messages: [
        {
          role: "user",
          content: `Title: ${options.title}\nTags: ${options.tags.join(", ")}\nKind: ${options.kind}\n\nRaw research:\n${options.rawContent.slice(0, 14000)}`,
        },
      ],
    });
    const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
    return text.length > 200 ? text.slice(0, 12000) : options.rawContent.slice(0, 12000);
  } catch (err) {
    console.error("distillSnippetsToArticle", err instanceof Error ? err.message : err);
    return options.rawContent.slice(0, 12000);
  }
}
