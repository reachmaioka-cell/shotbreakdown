import { z } from "zod";

const confidence = z.number().min(0).max(1);

/**
 * Every role that has to do something to put a shot on screen.
 *
 * The order is the order the work happens in on a real production, and it is
 * the order the UI renders. All nine are always present in a breakdown: a
 * department with nothing to do says so in one line, which is itself useful
 * ("no VFX, this is entirely practical").
 */
export const DEPARTMENTS = [
  "director",
  "camera",
  "lighting_grip",
  "art_department",
  "editorial",
  "color",
  "vfx",
  "sound",
  "producer",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  director: "Director",
  camera: "Camera",
  lighting_grip: "Lighting and grip",
  art_department: "Art department",
  editorial: "Editorial",
  color: "Colour",
  vfx: "VFX",
  sound: "Sound",
  producer: "Producer",
};


export const SubmitLinkSchema = z.object({
  url: z.string().url(),
});

export const SubmitUploadSchema = z.object({
  filePath: z.string().min(1),
  sourceType: z.enum(["frame_upload", "video_upload"]),
});

export const SubmitSchema = z.union([SubmitLinkSchema, SubmitUploadSchema]);

export const LightingSchema = z.object({
  key: z.string(),
  fill: z.string(),
  back: z.string(),
  practicals: z.string(),
  ratio_est: z.string(),
  motivation: z.string(),
  confidence,
});

export const ColorSchema = z.object({
  look: z.string(),
  contrast: z.string(),
  saturation: z.string(),
  notable_hues: z.array(z.string()),
  lut_or_process_guess: z.string(),
  confidence,
});

export const MovementSchema = z.object({
  type: z.string(),
  rig_guess: z.enum([
    "gimbal",
    "dolly",
    "handheld",
    "steadicam",
    "static",
    "drone",
    "crane",
    "unknown",
  ]),
  speed: z.string(),
  confidence,
});

export const BudgetRecreationSchema = z.object({
  under_500_usd: z.array(z.string()),
  under_5000_usd: z.array(z.string()),
});

export const PostProductionSchema = z.object({
  editing: z.string(),
  color_grade: z.string(),
  vfx: z.string(),
  ai_tools: z.string(),
});

export const BreakdownSchema = z.object({
  shot_type: z.string(),
  shot_type_confidence: confidence,
  camera_angle: z.string(),
  camera_angle_confidence: confidence,
  lens: z.string(),
  lens_confidence: confidence,
  depth_of_field: z.string(),
  depth_of_field_confidence: confidence,
  focal_length_mm_est: z.number().nullable(),
  aperture_est: z.string().nullable(),
  sensor_format_guess: z.string(),
  lighting: LightingSchema,
  color: ColorSchema,
  movement: MovementSchema,
  vfx: z.array(z.string()),
  post_production: PostProductionSchema.optional(),
  recreation_steps: z.array(z.string()),
  budget_recreation: BudgetRecreationSchema,
  common_mistakes: z.array(z.string()),
  one_line_summary: z.string(),
  tags: z.array(z.string()),
  notes: z.string(),
});

export type Breakdown = z.infer<typeof BreakdownSchema>;
export type SubmitInput = z.infer<typeof SubmitSchema>;

export const StatusSchema = z.object({
  status: z.enum(["pending", "processing", "draft", "verified", "failed"]),
});

export const ProcessBodySchema = z.object({
  submissionId: z.string().uuid(),
});

export const FeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  field_key: z.string().optional(),
  original_value: z.unknown().optional(),
  corrected_value: z.unknown().optional(),
  comment: z.string().max(2000).optional(),
});

export const AskSchema = z.object({
  question: z.string().min(1).max(2000),
});

export const PreferencesSchema = z.object({
  skill_level: z.enum(["beginner", "intermediate", "pro"]).nullable().optional(),
  primary_camera: z.string().max(120).nullable().optional(),
  lenses: z.array(z.string().max(80)).max(20).optional(),
  typical_work: z.array(z.string().max(40)).max(10).optional(),
  budget_band: z.enum(["under_500", "under_5000", "unlimited"]).nullable().optional(),
  tone: z.enum(["concise", "detailed"]).optional(),
  role: z.enum([...DEPARTMENTS, "other"]).nullable().optional(),
});

export const AdminReviewSchema = z.object({
  submissionId: z.string().uuid(),
  action: z.enum(["verify", "reject"]),
});

export function normalizeBreakdown(raw: Breakdown): Breakdown {
  return {
    ...raw,
    post_production: raw.post_production ?? {
      editing: "",
      color_grade: "",
      vfx: "",
      ai_tools: "",
    },
    tags: raw.tags
      .map((t) => t.toLowerCase().trim().replace(/\s+/g, "-"))
      .filter(Boolean)
      .slice(0, 8),
    one_line_summary: raw.one_line_summary.slice(0, 140),
    common_mistakes: raw.common_mistakes.slice(0, 3),
    recreation_steps: raw.recreation_steps.map((s) => s.trim()),
  };
}

/**
 * Generated on demand for a single shot. Kept separate from ShotRecordSchema
 * so per-shot analysis stays under the structured-output grammar ceiling.
 * No min/max array constraints — those explode the compiled grammar.
 */
export const RecreationGuideSchema = z.object({
  recreation_steps: z.array(z.string()),
  budget_recreation: BudgetRecreationSchema,
  common_mistakes: z.array(z.string()),
  post_production: PostProductionSchema,
  vfx: z.array(z.string()),
  notes: z.string(),
});

export type RecreationGuide = z.infer<typeof RecreationGuideSchema>;

export function normalizeRecreationGuide(raw: RecreationGuide): RecreationGuide {
  return {
    recreation_steps: raw.recreation_steps.map((s) => s.trim()).filter(Boolean).slice(0, 12),
    budget_recreation: {
      under_500_usd: raw.budget_recreation.under_500_usd.map((s) => s.trim()).filter(Boolean),
      under_5000_usd: raw.budget_recreation.under_5000_usd.map((s) => s.trim()).filter(Boolean),
    },
    common_mistakes: raw.common_mistakes.map((s) => s.trim()).filter(Boolean).slice(0, 3),
    post_production: raw.post_production,
    vfx: raw.vfx.map((s) => s.trim()).filter(Boolean),
    notes: raw.notes.trim(),
  };
}

export function hasRecreationGuide(
  metadata: { recreation_steps?: string[] } | null | undefined
): boolean {
  return (metadata?.recreation_steps?.length ?? 0) > 0;
}

/* ------------------------------------------------------------------ *
 * Shot metadata — the extended schema behind the searchable library.
 *
 * BreakdownSchema above is unchanged: it drives the existing prompt, the
 * RAG examples and the learning loop, and every stored breakdown validates
 * against it. The sections below add the facets the library needs to be
 * filterable. They are enums (not free text) because search filters depend
 * on canonical values.
 * ------------------------------------------------------------------ */

export const SHOT_SIZES = [
  "extreme-wide",
  "wide",
  "medium-wide",
  "medium",
  "medium-close-up",
  "close-up",
  "extreme-close-up",
  "insert",
] as const;

export const CAMERA_ANGLES = [
  "eye-level",
  "low-angle",
  "high-angle",
  "dutch",
  "overhead",
  "birds-eye",
  "worms-eye",
  "over-the-shoulder",
  "pov",
] as const;

export const CAMERA_HEIGHTS = [
  "ground",
  "low",
  "waist",
  "chest",
  "eye",
  "above-eye",
  "overhead",
] as const;

export const MOVEMENT_TYPES = [
  "static",
  "pan",
  "tilt",
  "push-in",
  "pull-out",
  "tracking",
  "dolly",
  "crane",
  "handheld",
  "orbit",
  "whip-pan",
  "zoom",
  "rack-focus",
  "aerial",
  "float",
] as const;

export const MOVEMENT_SPEEDS = ["none", "slow", "moderate", "fast"] as const;

export const MOVEMENT_DIRECTIONS = [
  "none",
  "left",
  "right",
  "up",
  "down",
  "forward",
  "backward",
  "clockwise",
  "counter-clockwise",
] as const;

export const LENS_TYPES = [
  "ultra-wide",
  "wide",
  "normal",
  "telephoto",
  "macro",
  "anamorphic",
] as const;

export const DEPTH_OF_FIELDS = ["shallow", "medium", "deep"] as const;

export const LIGHTING_QUALITIES = ["hard", "soft", "mixed"] as const;
export const LIGHTING_KEYS = ["high-key", "low-key", "neutral"] as const;
export const KEY_DIRECTIONS = [
  "front",
  "side",
  "back",
  "top",
  "under",
  "ambient",
] as const;
export const LIGHTING_SOURCES = ["natural", "artificial", "mixed"] as const;
export const COLOR_TEMPERATURES = ["warm", "neutral", "cool", "mixed"] as const;
export const SATURATIONS = [
  "desaturated",
  "muted",
  "natural",
  "saturated",
  "hyper-saturated",
] as const;
export const CONTRASTS = ["flat", "low", "medium", "high", "extreme"] as const;
export const INTERIOR_EXTERIOR = ["interior", "exterior", "mixed", "unclear"] as const;
export const TIMES_OF_DAY = [
  "dawn",
  "morning",
  "midday",
  "afternoon",
  "golden-hour",
  "dusk",
  "night",
  "unclear",
] as const;

export const SUBJECT_TYPES = [
  "person",
  "group",
  "crowd",
  "product",
  "vehicle",
  "animal",
  "landscape",
  "architecture",
  "object",
  "food",
  "text-graphic",
  "abstract",
] as const;

export const MOODS = [
  "cinematic",
  "intimate",
  "tense",
  "dreamy",
  "energetic",
  "nostalgic",
  "surreal",
  "minimalist",
  "commercial",
  "documentary",
  "epic",
  "melancholic",
  "playful",
  "gritty",
  "romantic",
  "ominous",
  "serene",
  "chaotic",
] as const;

/**
 * Canonical colour families for filtering.
 *
 * The model describes colour vividly ("deep teal", "warm amber", "near black"),
 * which reads well but fragments the filter into dozens of near-duplicates. The
 * descriptive phrasing is kept in `palette` and the swatches come from
 * `hex_colors`; `dominant_colors` is normalised to this list so the facet is
 * actually usable.
 */
export const COLOR_FAMILIES = [
  "red",
  "orange",
  "amber",
  "yellow",
  "green",
  "teal",
  "cyan",
  "blue",
  "purple",
  "magenta",
  "pink",
  "brown",
  "beige",
  "white",
  "grey",
  "black",
  "gold",
  "silver",
] as const;

const COLOR_SYNONYMS: Record<string, (typeof COLOR_FAMILIES)[number]> = {
  crimson: "red", scarlet: "red", maroon: "red", burgundy: "red", rust: "red", brick: "red",
  tangerine: "orange", peach: "orange", coral: "orange", copper: "orange", terracotta: "orange",
  honey: "amber", ochre: "amber", mustard: "amber", butterscotch: "amber", sepia: "amber",
  lemon: "yellow", cream: "beige", ivory: "beige", sand: "beige", tan: "beige", khaki: "beige",
  taupe: "beige", oatmeal: "beige", bone: "beige", skin: "beige", flesh: "beige",
  olive: "green", lime: "green", emerald: "green", sage: "green", moss: "green", forest: "green",
  mint: "green", jade: "green", chartreuse: "green",
  turquoise: "teal", aqua: "teal", seafoam: "teal", petrol: "teal",
  azure: "blue", navy: "blue", cobalt: "blue", indigo: "blue", sapphire: "blue", cerulean: "blue",
  steel: "blue", slate: "blue", denim: "blue", periwinkle: "blue",
  violet: "purple", lavender: "purple", lilac: "purple", plum: "purple", mauve: "purple",
  aubergine: "purple", eggplant: "purple",
  fuchsia: "magenta", cerise: "magenta",
  rose: "pink", blush: "pink", salmon: "pink",
  chocolate: "brown", chestnut: "brown", walnut: "brown", umber: "brown", mahogany: "brown",
  bronze: "brown", coffee: "brown", espresso: "brown", wood: "brown",
  charcoal: "grey", graphite: "grey", ash: "grey", smoke: "grey", gunmetal: "grey",
  gray: "grey", concrete: "grey", pewter: "grey",
  ebony: "black", jet: "black", ink: "black", onyx: "black",
  snow: "white", chalk: "white", pearl: "white", porcelain: "white",
  brass: "gold", champagne: "gold",
  chrome: "silver", platinum: "silver", metallic: "silver",
};

/** "deep-warm-amber" -> "amber". Falls back to grey when nothing matches. */
export function canonicalColor(value: string): (typeof COLOR_FAMILIES)[number] | null {
  const tokens = value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i].replace(/s$/, "");
    if ((COLOR_FAMILIES as readonly string[]).includes(token)) {
      return token as (typeof COLOR_FAMILIES)[number];
    }
    const mapped = COLOR_SYNONYMS[token];
    if (mapped) return mapped;
  }
  return null;
}

export function canonicalColors(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const family = canonicalColor(value);
    if (family && !out.includes(family)) out.push(family);
  }
  return out.slice(0, 5);
}

const shotSize = z.enum(SHOT_SIZES);
const cameraAngle = z.enum(CAMERA_ANGLES);

/*
 * The structured-output grammar has a hard ceiling and this schema sits close
 * to it, so every field has to earn its place. Enum facets stay — search
 * filters depend on them. Prose observations are consolidated: four sparse
 * one-line fields read worse in the panel than two written ones, and cost
 * grammar budget that a new facet would need.
 */
export const CompositionSchema = z.object({
  shot_size: shotSize,
  camera_angle: cameraAngle,
  camera_height: z.enum(CAMERA_HEIGHTS),
  /** Subject placement, balance and symmetry in one sentence. */
  framing: z.string(),
  /** Depth planes, foreground and background in one sentence. */
  depth: z.string(),
});

export const OpticsSchema = z.object({
  lens_type: z.enum(LENS_TYPES),
  focal_length_range: z.string(),
  depth_of_field: z.enum(DEPTH_OF_FIELDS),
  /** Compression, distortion and bokeh character in one sentence. */
  character: z.string(),
});

export const LightingFacetsSchema = z.object({
  quality: z.enum(LIGHTING_QUALITIES),
  key_level: z.enum(LIGHTING_KEYS),
  key_direction: z.enum(KEY_DIRECTIONS),
  source: z.enum(LIGHTING_SOURCES),
  contrast: z.enum(CONTRASTS),
  color_temperature: z.enum(COLOR_TEMPERATURES),
  backlight: z.boolean(),
  rim_light: z.boolean(),
  silhouette: z.boolean(),
  practicals_visible: z.boolean(),
});

export const ColorFacetsSchema = z.object({
  palette: z.string(),
  dominant_colors: z.array(z.string()),
  hex_colors: z.array(z.string()),
  saturation: z.enum(SATURATIONS),
  contrast: z.enum(CONTRASTS),
  temperature: z.enum(COLOR_TEMPERATURES),
});

/**
 * As stored: `color_names` holds the model's descriptive colour words, which
 * normalisation moves aside when it rewrites `dominant_colors` into canonical
 * families. It is deliberately NOT part of what the model is asked to return —
 * every extra field enlarges the structured-output grammar.
 */
export const StoredColorFacetsSchema = ColorFacetsSchema.extend({
  color_names: z.array(z.string()).optional(),
});

export const EnvironmentSchema = z.object({
  interior_exterior: z.enum(INTERIOR_EXTERIOR),
  location_type: z.string(),
  time_of_day: z.enum(TIMES_OF_DAY),
  weather: z.string(),
  descriptors: z.array(z.string()),
});

export const SubjectSchema = z.object({
  types: z.array(z.enum(SUBJECT_TYPES)),
  count: z.string(),
  description: z.string(),
});

export const MovementFacetsSchema = z.object({
  type: z.enum(MOVEMENT_TYPES),
  direction: z.enum(MOVEMENT_DIRECTIONS),
  speed: z.enum(MOVEMENT_SPEEDS),
});

/**
 * What Claude returns for a detected shot.
 *
 * Deliberately narrower than BreakdownSchema: this is a *library record* — the
 * facets a user searches and filters on, plus a concise craft read. The deep
 * recreation guide (steps, budget tiers, common mistakes) stays in
 * BreakdownSchema and is generated on demand for a single shot, not for all 120
 * shots of an upload. Combining both also overflows the structured-output
 * grammar limit.
 */
export const ShotRecordSchema = z.object({
  composition: CompositionSchema,
  optics: OpticsSchema,
  lighting_facets: LightingFacetsSchema,
  color_facets: ColorFacetsSchema,
  environment: EnvironmentSchema,
  subject: SubjectSchema,
  movement_facets: MovementFacetsSchema,
  // Strings, not enums: Claude still picks from the prompt list, but an extra
  // label must not fail the whole structured-output parse (it used to).
  mood: z.array(z.string()),

  focal_length_mm_est: z.number().nullable(),
  aperture_est: z.string().nullable(),
  sensor_format_guess: z.string(),
  rig_guess: z.enum([
    "gimbal",
    "dolly",
    "handheld",
    "steadicam",
    "static",
    "drone",
    "crane",
    "unknown",
  ]),
  lighting_notes: z.string(),
  color_notes: z.string(),
  ai_tools: z.string(),

  description: z.string(),
  why_it_works: z.string(),
  one_line_summary: z.string(),
  tags: z.array(z.string()),
});

export type ShotRecord = z.infer<typeof ShotRecordSchema>;

/**
 * What may be read back from a shot row. Every section is optional: shots
 * backfilled from the pre-shot-model corpus carry BreakdownSchema fields and no
 * facets, and newly analysed shots carry facets and no recreation guide until
 * one is generated on demand.
 */
/** Fields the model no longer returns, still present on shots analysed earlier. */
const RetiredCompositionSchema = CompositionSchema.extend({
  subject_position: z.string().optional(),
  symmetry: z.string().optional(),
  foreground: z.string().optional(),
  background: z.string().optional(),
}).partial();

const RetiredOpticsSchema = OpticsSchema.extend({
  compression: z.string().optional(),
  distortion: z.string().optional(),
  bokeh: z.string().optional(),
}).partial();

export const ShotMetadataSchema = z.object({
  composition: RetiredCompositionSchema.optional(),
  optics: RetiredOpticsSchema.optional(),
  lighting_facets: LightingFacetsSchema.optional(),
  color_facets: StoredColorFacetsSchema.optional(),
  environment: EnvironmentSchema.optional(),
  subject: SubjectSchema.optional(),
  movement_facets: MovementFacetsSchema.optional(),
  mood: z.array(z.string()).optional(),

  description: z.string().optional(),
  why_it_works: z.string().optional(),
  one_line_summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  confidence: confidence.optional(),

  focal_length_mm_est: z.number().nullable().optional(),
  aperture_est: z.string().nullable().optional(),
  sensor_format_guess: z.string().optional(),
  rig_guess: z.string().optional(),
  lighting_notes: z.string().optional(),
  color_notes: z.string().optional(),
  ai_tools: z.string().optional(),

  // Legacy BreakdownSchema fields, present on backfilled shots and on any shot
  // that has had a full recreation breakdown generated.
  shot_type: z.string().optional(),
  camera_angle: z.string().optional(),
  lens: z.string().optional(),
  depth_of_field: z.string().optional(),
  lighting: LightingSchema.partial().optional(),
  color: ColorSchema.partial().optional(),
  movement: MovementSchema.partial().optional(),
  vfx: z.array(z.string()).optional(),
  post_production: PostProductionSchema.partial().optional(),
  recreation_steps: z.array(z.string()).optional(),
  budget_recreation: BudgetRecreationSchema.partial().optional(),
  common_mistakes: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type ShotMetadata = z.infer<typeof ShotMetadataSchema>;

export type StoredShotRecord = Omit<ShotRecord, "mood" | "color_facets"> & {
  mood: (typeof MOODS)[number][];
  color_facets: z.infer<typeof StoredColorFacetsSchema>;
};

const MOOD_SET = new Set<string>(MOODS);

export function coerceMoods(values: string[]): (typeof MOODS)[number][] {
  const kept: (typeof MOODS)[number][] = [];
  for (const value of values) {
    if (MOOD_SET.has(value)) kept.push(value as (typeof MOODS)[number]);
  }
  if (kept.length === 0) return ["cinematic"];
  return kept.slice(0, 4);
}

export function normalizeShotRecord(raw: ShotRecord): StoredShotRecord {
  return {
    ...raw,
    description: raw.description.trim().slice(0, 400),
    why_it_works: raw.why_it_works.trim().slice(0, 400),
    one_line_summary: raw.one_line_summary.trim().slice(0, 140),
    tags: raw.tags
      .map((t) => t.toLowerCase().trim().replace(/\s+/g, "-"))
      .filter(Boolean)
      .slice(0, 8),
    mood: coerceMoods(raw.mood),
    subject: { ...raw.subject, types: raw.subject.types.slice(0, 4) },
    color_facets: {
      ...raw.color_facets,
      hex_colors: raw.color_facets.hex_colors
        .map((h) => h.trim().toLowerCase())
        .filter((h) => /^#[0-9a-f]{6}$/.test(h))
        .slice(0, 6),
      // Descriptive names stay in `palette`; the filter facet is normalised.
      dominant_colors: canonicalColors(raw.color_facets.dominant_colors),
      color_names: raw.color_facets.dominant_colors
        .map((c) => c.toLowerCase().trim().replace(/\s+/g, "-"))
        .filter(Boolean)
        .slice(0, 6),
    },
    environment: {
      ...raw.environment,
      descriptors: raw.environment.descriptors
        .map((d) => d.toLowerCase().trim().replace(/\s+/g, "-"))
        .filter(Boolean)
        .slice(0, 6),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Segment breakdown — the product.
 *
 * A user uploads a SEGMENT of a video and gets one document back. Not a pile
 * of per-shot cards: one read of the whole segment that says what happens in
 * it, walks every shot and every cut, answers whatever the uploader asked, and
 * then says what each department has to do to make it.
 *
 * This lives on `videos.breakdown`, deliberately NOT on `shots.metadata`.
 * lib/overlay.ts derives the user-correctable field allowlist from
 * ShotMetadataSchema, so anything added there becomes editable through the
 * corrections endpoint. A generated document is not a facet to be corrected.
 * ------------------------------------------------------------------ */

export const DIFFICULTIES = ["easy", "moderate", "hard", "specialist"] as const;

export const DepartmentBriefSchema = z.object({
  role: z.enum(DEPARTMENTS),
  /** One sentence: this department's job in THIS segment. */
  headline: z.string(),
  /** Ordered and imperative, citing shot numbers. */
  steps: z.array(z.string()),
  /** Concrete kit, each with a cheap substitute in the same line. */
  gear: z.array(z.string()),
  /** What goes wrong on this specific segment, not general advice. */
  pitfalls: z.array(z.string()),
});

export type DepartmentBrief = z.infer<typeof DepartmentBriefSchema>;

export const SegmentShotSchema = z.object({
  /** 0-based, matching shots.shot_index. */
  shot_index: z.number(),
  timecode: z.string(),
  what_happens: z.string(),
  how_it_was_made: z.string(),
  /** Why the cut into and out of this shot lands here. Empty for a single-shot segment. */
  cut_note: z.string(),
});

export const SegmentBreakdownSchema = z.object({
  title: z.string(),
  what_happens: z.string(),
  setting: z.string(),
  approach: z.string(),
  /** Direct answer to what the uploader asked. Empty string when they asked nothing. */
  focus_answer: z.string(),
  shot_sequence: z.array(SegmentShotSchema),
  departments: z.array(DepartmentBriefSchema),
  shot_list: z.array(z.string()),
  prep_checklist: z.array(z.string()),
  minimum_crew: z.string(),
  difficulty: z.enum(DIFFICULTIES),
  budget_tiers: z.object({
    under_500_usd: z.array(z.string()),
    under_5000_usd: z.array(z.string()),
    full_production: z.array(z.string()),
  }),
  common_mistakes: z.array(z.string()),
});

export type SegmentBreakdown = z.infer<typeof SegmentBreakdownSchema>;

/** As stored on videos.breakdown. */
export const StoredSegmentBreakdownSchema = SegmentBreakdownSchema.extend({
  version: z.number(),
  prompt_version: z.string(),
  /** The question this breakdown was written against, so a refocus is visible. */
  focus: z.string().nullable(),
  generated_at: z.string(),
});

export type StoredSegmentBreakdown = z.infer<typeof StoredSegmentBreakdownSchema>;

export const SEGMENT_BREAKDOWN_VERSION = 1;

function cleanList(values: string[] | undefined, max: number, maxLen = 400): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = String(raw)
      .replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, "")
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

/**
 * Make a model response safe to render.
 *
 * Two guarantees the UI depends on: all nine departments are present in
 * canonical order, and there is exactly one shot_sequence entry per real shot,
 * in index order. The model is good at both and occasionally drops one; the
 * renderer should not have to care which.
 */
export function normalizeSegmentBreakdown(
  raw: SegmentBreakdown,
  shots: { shotIndex: number; timecode: string; summary?: string | null }[]
): SegmentBreakdown {
  const byRole = new Map(raw.departments?.map((d) => [d.role, d]) ?? []);
  const departments: DepartmentBrief[] = DEPARTMENTS.map((role) => {
    const found = byRole.get(role);
    if (!found) {
      return {
        role,
        headline: "Nothing specific to this segment beyond standard practice.",
        steps: [],
        gear: [],
        pitfalls: [],
      };
    }
    return {
      role,
      headline: found.headline.trim().slice(0, 300),
      steps: cleanList(found.steps, 12),
      gear: cleanList(found.gear, 10),
      pitfalls: cleanList(found.pitfalls, 5),
    };
  });

  const bySequenceIndex = new Map(raw.shot_sequence?.map((s) => [s.shot_index, s]) ?? []);
  const shot_sequence = shots.map((shot) => {
    const found = bySequenceIndex.get(shot.shotIndex);
    return {
      shot_index: shot.shotIndex,
      timecode: found?.timecode?.trim() || shot.timecode,
      what_happens: found?.what_happens?.trim().slice(0, 600) || shot.summary?.trim() || "",
      how_it_was_made: found?.how_it_was_made?.trim().slice(0, 600) || "",
      cut_note: found?.cut_note?.trim().slice(0, 400) || "",
    };
  });

  return {
    title: raw.title.trim().slice(0, 160),
    what_happens: raw.what_happens.trim().slice(0, 1200),
    setting: raw.setting.trim().slice(0, 400),
    approach: raw.approach.trim().slice(0, 1200),
    focus_answer: raw.focus_answer.trim().slice(0, 3000),
    shot_sequence,
    departments,
    // One line per shot, so a short list is padded from the sequence rather
    // than silently describing fewer shots than the segment contains.
    shot_list: cleanList(raw.shot_list, Math.max(shots.length, 1), 200),
    prep_checklist: cleanList(raw.prep_checklist, 15),
    minimum_crew: raw.minimum_crew.trim().slice(0, 200),
    difficulty: raw.difficulty,
    budget_tiers: {
      under_500_usd: cleanList(raw.budget_tiers?.under_500_usd, 10),
      under_5000_usd: cleanList(raw.budget_tiers?.under_5000_usd, 10),
      full_production: cleanList(raw.budget_tiers?.full_production, 10),
    },
    common_mistakes: cleanList(raw.common_mistakes, 6),
  };
}

/** Parse videos.breakdown. Returns null for absent, malformed or older shapes. */
export function readSegmentBreakdown(value: unknown): StoredSegmentBreakdown | null {
  if (!value || typeof value !== "object") return null;
  const parsed = StoredSegmentBreakdownSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
