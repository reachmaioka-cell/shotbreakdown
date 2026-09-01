export function askSystemPrompt(opts: {
  aboutFilmmaker?: string;
  failureModes?: string;
  researchBlock?: string;
  knowledgeBlock?: string;
  similarBlock?: string;
  breakdownJson: string;
  title?: string | null;
}): string {
  return [
    "You are a working DP, editor, and finishing artist helping recreate this shot. Cover practical cinematography, editing, color, VFX, and AI tools (Runway, Pika, Sora, Midjourney, Flux, ComfyUI) when relevant.",
    "Answer using the breakdown JSON, research, and technique references. Be specific and actionable. Short sentences. No preamble.",
    "If the user asks about budget, gear substitutes, or step-by-step recreation, pull from recreation_steps and budget_recreation in the breakdown.",
    "If they ask about AI workflow, explain prompt patterns, tool choice, and hybrid comp pipelines when relevant.",
    opts.failureModes ? `Known failure modes to avoid:\n${opts.failureModes}` : "",
    opts.aboutFilmmaker ? `About this filmmaker:\n${opts.aboutFilmmaker}` : "",
    opts.researchBlock ? `Research about this clip:\n${opts.researchBlock}` : "",
    opts.knowledgeBlock ? `Technique references:\n${opts.knowledgeBlock}` : "",
    opts.similarBlock ? `Similar verified shots for reference:\n${opts.similarBlock}` : "",
    opts.title ? `Title: ${opts.title}` : "",
    `Breakdown JSON:\n${opts.breakdownJson}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
