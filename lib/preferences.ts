import { DEPARTMENT_LABELS, type Department } from "@/lib/validation";

export type UserPreferences = {
  skill_level: "beginner" | "intermediate" | "pro" | null;
  /** The department they actually work in. Decides who the breakdown leads with. */
  role: string | null;
  primary_camera: string | null;
  lenses: string[];
  typical_work: string[];
  budget_band: "under_500" | "under_5000" | "unlimited" | null;
  tone: "concise" | "detailed";
  signals: { expands?: Record<string, number> } | null;
};

export function formatAboutFilmmaker(prefs: UserPreferences | null): string | undefined {
  if (!prefs) return undefined;
  const lines: string[] = [];

  if (prefs.skill_level === "beginner") {
    lines.push("Skill: beginner. Use plain language. Define jargon once, then use it.");
  } else if (prefs.skill_level === "pro") {
    lines.push("Skill: working DP. Skip basics. Name fixtures, ratios, and stop values.");
  } else if (prefs.skill_level === "intermediate") {
    lines.push("Skill: intermediate. Assume they know ISO/shutter; still name the gear.");
  }

  if (prefs.role && prefs.role !== "other") {
    const label = DEPARTMENT_LABELS[prefs.role as Department] ?? prefs.role;
    lines.push(
      `Primary department: ${label}. Give that department the most detail and the most specific gear; still write every other department in full.`
    );
  }

  if (prefs.primary_camera) {
    lines.push(`Owns/shoots on: ${prefs.primary_camera}. Reference that body in recreation steps where plausible, and name a substitute.`);
  }
  if (prefs.lenses.length) {
    lines.push(`Lenses they have: ${prefs.lenses.join(", ")}. Prefer these; say what to rent only if needed.`);
  }
  if (prefs.typical_work.length) {
    lines.push(`Typical work: ${prefs.typical_work.join(", ")}.`);
  }
  if (prefs.budget_band === "under_500") {
    lines.push("Budget band: under $500. Lead with that tier. Do not assume rentals.");
  } else if (prefs.budget_band === "under_5000") {
    lines.push("Budget band: under $5000. Lead with that tier, mention the cheap path second.");
  } else if (prefs.budget_band === "unlimited") {
    lines.push("Budget band: unlimited. Still give a cheap path, but you may specify cinema glass and crew.");
  }
  if (prefs.tone === "detailed") {
    lines.push("Tone: detailed. Extra stop/distance/gel notes are welcome.");
  } else {
    lines.push("Tone: concise. Short sentences.");
  }

  const expands = prefs.signals?.expands ?? {};
  const entries = Object.entries(expands);
  const total = entries.reduce((n, [, v]) => n + v, 0);
  if (total >= 5) {
    const [topKey, topVal] = entries.sort((a, b) => b[1] - a[1])[0];
    if (topVal / total >= 0.5) {
      const label =
        topKey === "light" ? "lighting" : topKey === "camera" ? "camera/lens" : topKey;
      lines.push(`This user cares most about ${label}. Weight that section.`);
    }
  }

  return lines.length ? lines.join("\n") : undefined;
}
