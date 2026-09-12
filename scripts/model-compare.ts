/**
 * Is the per-shot facet record the same record on a cheaper model?
 *
 * Runs the real shot prompt and the real schema over shots that are already in
 * the local database, once per model, and diffs the two records field by field.
 * The enum facets are what search filters on and what the panel prints, so
 * exact agreement there is the thing that decides it. Prose fields are scored
 * loosely on purpose: two correct writers word a sentence differently, and a
 * reworded summary is not a regression.
 *
 * --control=N reruns the baseline model against itself on the first N shots.
 * Without that noise floor a disagreement rate means nothing — the call runs at
 * the API default temperature, exactly as production does, so the baseline
 * disagrees with itself too, and only the gap between the two rates is evidence.
 *
 * --width=N asks the other question with the same instrument: what the
 * downscale costs. It changes the width the CANDIDATE's frames are scaled to
 * and nothing else — same prompt, same schema, same request builder, same cache
 * behaviour, same ffmpeg re-encode on both sides — so running the same model on
 * both sides with --width=1280 pairs a 768px read against a 1280px read of the
 * same shot. Both sides default to MODEL_FRAME_WIDTH, which is what production
 * sends, so omitting the flag leaves the run exactly as it was.
 *
 * Every run spends real money: two calls per shot, plus one per control shot.
 *
 * --dry prints the sample and the frames it can read without calling anything,
 * which is how you check what a run will cost before paying for it.
 *
 *   npx tsx --env-file=.env.local scripts/model-compare.ts [--limit=8]
 *     [--shots=id,id] [--baseline=model] [--candidate=model] [--control=4]
 *     [--width=1280] [--baseline-width=768] [--control-width=1280]
 *     [--dry] [--prose] [--out=path.json]
 */
import Anthropic from "@anthropic-ai/sdk";
import { SHOT_MODEL } from "../lib/constants";
import { formatKnowledgeBlock, retrieveKnowledge } from "../lib/knowledge";
import { inferTagsFromText } from "../lib/knowledge-query";
import { fetchAnalysisImage, resolveMediaUrl } from "../lib/media";
import { MODEL_FRAME_WIDTH, downscaleForModel } from "../lib/pipeline/stages";
import { shotSystemPrompt, type ShotSystemPrompt } from "../lib/prompts/shot";
import { formatTimecode, shotRequestParams } from "../lib/shot-analysis";
import {
  ShotRecordSchema,
  normalizeShotRecord,
  type StoredShotRecord,
} from "../lib/validation";
import { createAdminClient } from "../lib/supabase/admin";

/** List price per million tokens. Anything absent prints its usage without a cost. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};

/** Matches lib/pipeline/stages.ts — first / representative / last. */
const ANALYSIS_FRAMES = 3;

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const limit = Number(flag("limit") ?? 8);
const shotIds = (flag("shots") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const baselineModel = flag("baseline") ?? SHOT_MODEL;
const candidateModel = flag("candidate") ?? "claude-haiku-4-5";
const controlCount = Number(flag("control") ?? 0);
/**
 * Frame width per side. Production's width is the default on both, so a run
 * that does not ask about the downscale is priced and scored on the frames
 * production actually sends.
 */
const baselineWidth = Number(flag("baseline-width") ?? MODEL_FRAME_WIDTH);
const candidateWidth = Number(flag("width") ?? baselineWidth);
/**
 * Which width the noise floor is measured at. Defaults to the baseline's, so
 * a run that is not asking about the downscale is unchanged.
 *
 * A width comparison needs this. The control answers "how often does this
 * model disagree with itself on this material", and that is a property of a
 * width as much as of a model: a 768 control tells you the 768 read is jittery
 * but says nothing about whether the 1280 read is steadier. Without both
 * floors the run can only show that the record MOVED when the width changed,
 * never whether the wider frame bought a more determinate answer — which is
 * the question the width is being asked. `--control-width=1280` measures the
 * other floor, at the cost of two extra calls per control shot.
 */
const controlWidth = Number(flag("control-width") ?? baselineWidth);
const showProse = args.includes("--prose");
const dryRun = args.includes("--dry");
const outPath = flag("out");

type Shot = {
  id: string;
  title: string;
  shot_index: number;
  shot_count: number;
  start_seconds: number;
  end_seconds: number;
  video_title: string | null;
  paths: string[];
  /** Where the pixels came from. A poster is not what production analyses. */
  source: "frames" | "poster";
};

type Usage = { input: number; cacheWrite: number; cacheRead: number; output: number; calls: number };

const usage = new Map<string, Usage>();

function recordUsage(model: string, u: Anthropic.Usage) {
  const prev = usage.get(model) ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, calls: 0 };
  usage.set(model, {
    input: prev.input + u.input_tokens,
    // Cached input is billed too, and it is most of the prompt — leaving it out
    // of the total would understate the call by more than half.
    cacheWrite: prev.cacheWrite + (u.cache_creation_input_tokens ?? 0),
    cacheRead: prev.cacheRead + (u.cache_read_input_tokens ?? 0),
    output: prev.output + u.output_tokens,
    calls: prev.calls + 1,
  });
}

function cost(model: string, u: Usage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  return (
    (u.input * price.input +
      u.cacheWrite * price.input * 1.25 +
      u.cacheRead * price.input * 0.1 +
      u.output * price.output) /
    1_000_000
  );
}

/**
 * The same call priced as if no prompt cache existed.
 *
 * The two sides of a run do not get the same cache deal. The baseline is
 * called twice per prefix whenever --control is on, so its second call reads
 * back what the first wrote; the candidate is called once and pays the write
 * with nothing to read it. The measured $/call then differs for a reason that
 * has nothing to do with either model, and a verdict drawn off it is a verdict
 * about the run's call order. This prices every prompt token once at the plain
 * input rate, which is the same deal on both sides, so the two numbers can be
 * compared to each other. Neither number is what production pays — production
 * is somewhere between this and the cached price — so print both.
 */
function uncachedCost(model: string, u: Usage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  return ((u.input + u.cacheWrite + u.cacheRead) * price.input + u.output * price.output) / 1_000_000;
}

/* ------------------------------------------------------------------ *
 * Sample selection
 * ------------------------------------------------------------------ */

async function loadShots(): Promise<Shot[]> {
  const admin = createAdminClient();

  let query = admin
    .from("shots")
    .select("id, title, video_id, shot_index, start_seconds, end_seconds, poster_path, thumbnail_path")
    .eq("status", "complete");
  if (shotIds.length) query = query.in("id", shotIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const out: Shot[] = [];

  for (const row of rows) {
    const { data: frames } = await admin
      .from("shot_frames")
      .select("id, storage_path, timestamp_seconds, is_representative")
      .eq("shot_id", row.id as string)
      .order("timestamp_seconds");

    // Same three frames the pipeline pays for, chosen the same way, so the
    // comparison is over the input production actually sends.
    let paths: string[] = [];
    let source: Shot["source"] = "frames";
    if (frames && frames.length > 0) {
      const chosen: typeof frames = [];
      const representative = frames.find((f) => f.is_representative) ?? frames[0];
      chosen.push(frames[0]);
      if (representative.id !== frames[0].id) chosen.push(representative);
      const last = frames[frames.length - 1];
      if (chosen.length < ANALYSIS_FRAMES && last.id !== representative.id && last.id !== frames[0].id) {
        chosen.push(last);
      }
      paths = chosen.map((f) => f.storage_path as string);
    } else {
      // Library shots predate the frame table and carry a single stored poster.
      const poster = (row.poster_path as string | null) ?? (row.thumbnail_path as string | null);
      if (poster) paths = [poster];
      source = "poster";
    }
    if (paths.length === 0) {
      console.log(`  ${(row.id as string).slice(0, 8)}  skipped — nothing in storage to read`);
      continue;
    }

    const { data: video } = await admin
      .from("videos")
      .select("title")
      .eq("id", row.video_id as string)
      .maybeSingle();

    const { count } = await admin
      .from("shots")
      .select("id", { count: "exact", head: true })
      .eq("video_id", row.video_id as string);

    out.push({
      id: row.id as string,
      title: (row.title as string | null) ?? "(untitled)",
      shot_index: Number(row.shot_index ?? 0),
      shot_count: count ?? 1,
      start_seconds: Number(row.start_seconds ?? 0),
      end_seconds: Number(row.end_seconds ?? 0),
      video_title: (video?.title as string | null) ?? null,
      paths,
      source,
    });
  }

  if (shotIds.length) {
    // Honour the order the caller asked for; it is how a run stays comparable
    // with the one before it.
    out.sort((a, b) => shotIds.indexOf(a.id) - shotIds.indexOf(b.id));
    return out;
  }
  out.sort((a, b) => b.paths.length - a.paths.length);
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * One shot, one model — the production prompt, the production schema
 * ------------------------------------------------------------------ */

type Frame = { buffer: Buffer; contentType: string };

/** The stored frames, full size, read once and scaled per side afterwards. */
async function loadSourceFrames(shot: Shot): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const path of shot.paths) {
    const url = await resolveMediaUrl(path);
    if (!url) continue;
    frames.push(await fetchAnalysisImage(url));
  }
  return frames;
}

/**
 * The copy one side of the comparison sends.
 *
 * The pipeline hands the model a downscaled copy, never the stored frame. Send
 * the stored frame here and the run prices a request nobody makes — so even a
 * side asking for the stored width goes through the same ffmpeg scale and the
 * same re-encode, and the width is the only thing that differs between sides.
 */
async function framesAt(source: Frame[], width: number): Promise<Frame[]> {
  const out: Frame[] = [];
  for (const image of source) out.push(await downscaleForModel(image, width));
  return out;
}

/**
 * The system prompt analyzeShotFrames would build for this shot. The prompt
 * module is the same one production calls, so the only thing this run changes
 * about the request is the model name.
 */
async function buildSystemPrompt(shot: Shot, frameCount: number): Promise<ShotSystemPrompt> {
  const hintTags = inferTagsFromText(shot.video_title ?? "");
  const knowledge = await retrieveKnowledge(
    [shot.video_title, "cinematography lighting lens composition movement"].filter(Boolean).join(" "),
    5,
    { tags: hintTags }
  ).catch(() => []);

  return shotSystemPrompt({
    frameCount,
    videoTitle: shot.video_title,
    shotPosition: { index: shot.shot_index, total: shot.shot_count },
    timecode: `${formatTimecode(shot.start_seconds)} – ${formatTimecode(shot.end_seconds)}`,
    knowledgeBlock: formatKnowledgeBlock(knowledge),
    focus: null,
  });
}

/**
 * The SDK puts the schema violation on the last lines of the message; the first
 * line is only "failed to parse". The field that broke is the whole point.
 */
function schemaDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const issues = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  return issues.length ? issues.join("; ") : (text.split("\n")[0] ?? text);
}

/** Schema retries and hard failures, per model — a record that will not parse is a cost too. */
const retries = new Map<string, { retried: number; failed: number }>();

function noteRetry(model: string, failed: boolean) {
  const prev = retries.get(model) ?? { retried: 0, failed: 0 };
  retries.set(model, { retried: prev.retried + 1, failed: prev.failed + (failed ? 1 : 0) });
}

async function callOnce(
  model: string,
  system: ShotSystemPrompt,
  frames: Frame[],
  userText: string,
  cacheShared: boolean
): Promise<StoredShotRecord> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Production's own request builder, with the model swapped. Hand-rolling the
  // request here is how a measurement quietly stops measuring production.
  const params = { ...shotRequestParams(system, frames, userText, cacheShared), model };

  // create() rather than parse(): parse() throws on a schema violation before
  // the caller can read message.usage, and those tokens are billed all the
  // same. A model that fails the schema has to be charged for failing it, or
  // the comparison flatters whichever model fails more often.
  const message = await anthropic.messages.create(params);
  recordUsage(model, message.usage);

  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error(`${model} returned no text block`);

  let raw: unknown;
  try {
    raw = JSON.parse(block.text);
  } catch {
    throw new Error(`${model} returned text that is not JSON`);
  }

  // Same wording the SDK's parser uses, so schemaDetail reads either source.
  const parsed = ShotRecordSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Failed to parse structured output\nValidation issues:\n${issues}`);
  }
  return normalizeShotRecord(parsed.data);
}

/**
 * Same two-attempt shape as analyzeShotFrames: a record that fails the schema
 * gets one stricter retry before the shot is given up on. Counting the retries
 * matters as much as the diff — a retry is a second full call at full price.
 */
async function analyze(
  model: string,
  system: ShotSystemPrompt,
  frames: Frame[],
  cacheShared: boolean
): Promise<StoredShotRecord> {
  const userText =
    frames.length > 1
      ? `Analyse this shot from ${frames.length} frames in order. Return the full shot record.`
      : "Analyse this shot. Return the full shot record.";
  try {
    return await callOnce(model, system, frames, userText, cacheShared);
  } catch (first) {
    const detail = schemaDetail(first);
    try {
      const record = await callOnce(
        model,
        system,
        frames,
        `${userText}\n\nReturn valid JSON only, matching the schema exactly. No markdown.`,
        cacheShared
      );
      noteRetry(model, false);
      console.log(`\n  retry  ${model}  ${detail}`);
      return record;
    } catch (second) {
      noteRetry(model, true);
      const secondDetail = schemaDetail(second);
      console.log(`\n  FAILED ${model}  ${detail} / ${secondDetail}`);
      throw second;
    }
  }
}

/* ------------------------------------------------------------------ *
 * The diff
 * ------------------------------------------------------------------ */

type Kind = "objective" | "focal" | "set" | "prose";

type Field = {
  name: string;
  kind: Kind;
  read: (r: StoredShotRecord) => string | string[] | number | null;
};

const FIELDS: Field[] = [
  { name: "composition.shot_size", kind: "objective", read: (r) => r.composition.shot_size },
  { name: "composition.camera_angle", kind: "objective", read: (r) => r.composition.camera_angle },
  { name: "composition.camera_height", kind: "objective", read: (r) => r.composition.camera_height },
  { name: "movement.type", kind: "objective", read: (r) => r.movement_facets.type },
  { name: "movement.direction", kind: "objective", read: (r) => r.movement_facets.direction },
  { name: "movement.speed", kind: "objective", read: (r) => r.movement_facets.speed },
  { name: "optics.lens_type", kind: "objective", read: (r) => r.optics.lens_type },
  { name: "optics.depth_of_field", kind: "objective", read: (r) => r.optics.depth_of_field },
  { name: "lighting.quality", kind: "objective", read: (r) => r.lighting_facets.quality },
  { name: "lighting.key_level", kind: "objective", read: (r) => r.lighting_facets.key_level },
  { name: "lighting.key_direction", kind: "objective", read: (r) => r.lighting_facets.key_direction },
  { name: "lighting.source", kind: "objective", read: (r) => r.lighting_facets.source },
  { name: "lighting.contrast", kind: "objective", read: (r) => r.lighting_facets.contrast },
  { name: "lighting.color_temperature", kind: "objective", read: (r) => r.lighting_facets.color_temperature },
  { name: "lighting.backlight", kind: "objective", read: (r) => String(r.lighting_facets.backlight) },
  { name: "lighting.rim_light", kind: "objective", read: (r) => String(r.lighting_facets.rim_light) },
  { name: "lighting.silhouette", kind: "objective", read: (r) => String(r.lighting_facets.silhouette) },
  { name: "lighting.practicals_visible", kind: "objective", read: (r) => String(r.lighting_facets.practicals_visible) },
  { name: "color.saturation", kind: "objective", read: (r) => r.color_facets.saturation },
  { name: "color.contrast", kind: "objective", read: (r) => r.color_facets.contrast },
  { name: "color.temperature", kind: "objective", read: (r) => r.color_facets.temperature },
  { name: "environment.interior_exterior", kind: "objective", read: (r) => r.environment.interior_exterior },
  { name: "environment.time_of_day", kind: "objective", read: (r) => r.environment.time_of_day },
  { name: "rig_guess", kind: "objective", read: (r) => r.rig_guess },
  { name: "aperture_est", kind: "objective", read: (r) => r.aperture_est },
  { name: "sensor_format_guess", kind: "objective", read: (r) => r.sensor_format_guess },
  { name: "ai_tools", kind: "objective", read: (r) => r.ai_tools.toLowerCase().trim() },
  { name: "focal_length_mm_est", kind: "focal", read: (r) => r.focal_length_mm_est },

  { name: "subject.types", kind: "set", read: (r) => r.subject.types },
  { name: "color.dominant_colors", kind: "set", read: (r) => r.color_facets.dominant_colors },
  { name: "environment.descriptors", kind: "set", read: (r) => r.environment.descriptors },
  { name: "mood", kind: "set", read: (r) => r.mood },
  { name: "tags", kind: "set", read: (r) => r.tags },

  { name: "composition.framing", kind: "prose", read: (r) => r.composition.framing },
  { name: "composition.depth", kind: "prose", read: (r) => r.composition.depth },
  { name: "optics.focal_length_range", kind: "prose", read: (r) => r.optics.focal_length_range },
  { name: "optics.character", kind: "prose", read: (r) => r.optics.character },
  { name: "color.palette", kind: "prose", read: (r) => r.color_facets.palette },
  { name: "environment.location_type", kind: "prose", read: (r) => r.environment.location_type },
  { name: "environment.weather", kind: "prose", read: (r) => r.environment.weather },
  { name: "subject.count", kind: "prose", read: (r) => r.subject.count },
  { name: "subject.description", kind: "prose", read: (r) => r.subject.description },
  { name: "lighting_notes", kind: "prose", read: (r) => r.lighting_notes },
  { name: "color_notes", kind: "prose", read: (r) => r.color_notes },
  { name: "description", kind: "prose", read: (r) => r.description },
  { name: "why_it_works", kind: "prose", read: (r) => r.why_it_works },
  { name: "one_line_summary", kind: "prose", read: (r) => r.one_line_summary },
];

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a.map((v) => v.toLowerCase()));
  const right = new Set(b.map((v) => v.toLowerCase()));
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it",
  "its", "of", "on", "or", "that", "the", "this", "to", "with",
]);

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Score one field on one shot: 1 is agreement, 0 is none. */
function score(field: Field, a: StoredShotRecord, b: StoredShotRecord): number {
  const left = field.read(a);
  const right = field.read(b);

  if (field.kind === "focal") {
    if (left == null || right == null) return left === right ? 1 : 0;
    const lo = Math.min(Number(left), Number(right));
    const hi = Math.max(Number(left), Number(right));
    // One step on a prime lens set (35 vs 50) is a real disagreement; 50 vs 65
    // is the same read expressed differently.
    return hi <= lo * 1.34 ? 1 : 0;
  }
  if (field.kind === "set") return jaccard(left as string[], right as string[]);
  if (field.kind === "prose") return jaccard(words(String(left ?? "")), words(String(right ?? "")));
  return String(left ?? "") === String(right ?? "") ? 1 : 0;
}

function show(field: Field, r: StoredShotRecord): string {
  const value = field.read(r);
  if (Array.isArray(value)) return value.join(" ") || "(empty)";
  return String(value ?? "null");
}

type Pairing = {
  /** `a` in every pair. */
  baseline: string;
  /** `b` in every pair. */
  candidate: string;
  pairs: { shot: Shot; a: StoredShotRecord; b: StoredShotRecord }[];
};

function report(pairing: Pairing, control: Pairing | null) {
  const controlRate = new Map<string, number>();
  if (control) {
    for (const field of FIELDS) {
      const total = control.pairs.reduce((sum, p) => sum + score(field, p.a, p.b), 0);
      controlRate.set(field.name, total / control.pairs.length);
    }
  }

  const groups: { kind: Kind[]; heading: string }[] = [
    { kind: ["objective", "focal"], heading: "OBJECTIVE FACETS — exact match expected" },
    { kind: ["set"], heading: "LIST FACETS — mean overlap (Jaccard)" },
    { kind: ["prose"], heading: "PROSE — mean word overlap, low numbers are not failures" },
  ];

  if (control) {
    // The control column is only readable if the reader knows what was held
    // fixed in it — with --control-width the floor is not the baseline's.
    console.log(`\ncontrol column: ${control.baseline} read twice, ${control.pairs.length} shots, same run`);
  }

  for (const group of groups) {
    console.log(`\n${group.heading}`);
    console.log(
      `  ${"field".padEnd(32)} ${"agree".padEnd(8)} ${control ? "control".padEnd(8) : ""}`
    );
    const rows = FIELDS.filter((f) => group.kind.includes(f.kind));
    for (const field of rows) {
      const total = pairing.pairs.reduce((sum, p) => sum + score(field, p.a, p.b), 0);
      const rate = total / pairing.pairs.length;
      const ctl = controlRate.get(field.name);
      console.log(
        `  ${field.name.padEnd(32)} ${`${Math.round(rate * 100)}%`.padEnd(8)} ${
          ctl == null ? "" : `${Math.round(ctl * 100)}%`.padEnd(8)
        }`
      );
    }
    const mean =
      rows.reduce(
        (sum, field) =>
          sum + pairing.pairs.reduce((s, p) => s + score(field, p.a, p.b), 0) / pairing.pairs.length,
        0
      ) / rows.length;
    // The control mean belongs on the same line as the mean it qualifies. On
    // its own an agreement rate says nothing; the gap is the whole finding.
    const controlMean = control
      ? rows.reduce((sum, field) => sum + (controlRate.get(field.name) ?? 0), 0) / rows.length
      : null;
    console.log(
      `  ${"— mean —".padEnd(32)} ${`${Math.round(mean * 100)}%`.padEnd(8)} ${
        controlMean == null ? "" : `${Math.round(controlMean * 100)}%`.padEnd(8)
      }`
    );
  }

  // Spell out which side of the arrow is which: reading it backwards inverts
  // the verdict, and the heading is the only thing that says.
  console.log(`\nDISAGREEMENTS  ${pairing.baseline} -> ${pairing.candidate}`);
  for (const pair of pairing.pairs) {
    const misses = FIELDS.filter(
      (f) => (f.kind === "objective" || f.kind === "focal") && score(f, pair.a, pair.b) < 1
    );
    console.log(`\n  ${pair.shot.id.slice(0, 8)}  ${pair.shot.title.slice(0, 72)}`);
    if (misses.length === 0) {
      console.log("    (none)");
      continue;
    }
    for (const field of misses) {
      console.log(`    ${field.name.padEnd(30)} ${show(field, pair.a)}  ->  ${show(field, pair.b)}`);
    }
  }

  if (!showProse) return;
  console.log(`\nPROSE SIDE BY SIDE  a=${pairing.baseline}  b=${pairing.candidate}`);
  for (const pair of pairing.pairs) {
    console.log(`\n  ${pair.shot.id.slice(0, 8)}  ${pair.shot.title.slice(0, 72)}`);
    for (const field of FIELDS.filter((f) => f.kind === "prose")) {
      console.log(`    ${field.name}`);
      console.log(`      a: ${show(field, pair.a)}`);
      console.log(`      b: ${show(field, pair.b)}`);
    }
  }
}

/* ------------------------------------------------------------------ */

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const shots = await loadShots();
  if (shots.length === 0) throw new Error("no shots with readable frames in this database");

  console.log(`baseline  ${baselineModel}  frames ${baselineWidth}px`);
  console.log(`candidate ${candidateModel}  frames ${candidateWidth}px`);
  if (baselineWidth !== candidateWidth && baselineModel !== candidateModel) {
    // Two variables moved at once, so nothing the run prints can say which one
    // moved the number. Refuse rather than publish an uninterpretable table.
    throw new Error(
      "model and frame width both differ between the sides — change one at a time"
    );
  }
  const controlShots = Math.min(controlCount, shots.length);
  const controlCalls = controlShots * (controlWidth === baselineWidth ? 1 : 2);
  console.log(`\nSAMPLE (${shots.length} shots, ${shots.length * 2 + controlCalls} model calls)`);
  for (const shot of shots) {
    console.log(
      `  ${shot.id.slice(0, 8)}  ${shot.paths.length} ${shot.source === "poster" ? "poster" : "frame"}(s)` +
        `  ${shot.title.slice(0, 70)}`
    );
  }

  const posters = shots.filter((s) => s.source === "poster").length;
  if (posters > 0) {
    // A poster is a stored still, not one of the three frames a shot call
    // carries. Reading a whole shot off one of them is a harder task than the
    // one being priced, so a sample that leans on them is not evidence about
    // production. Pin a frame-backed sample with --shots= instead.
    console.log(
      `\n  WARNING: ${posters} of ${shots.length} shots have no stored frames and fall back to a` +
        ` single poster. Those rows do not represent a production shot call.`
    );
  }

  const pairs: Pairing["pairs"] = [];
  const controlPairs: Pairing["pairs"] = [];

  if (dryRun) {
    for (const shot of shots) {
      const source = await loadSourceFrames(shot);
      const a = await framesAt(source, baselineWidth);
      const b = await framesAt(source, candidateWidth);
      const kb = (f: Frame[]) => Math.round(f.reduce((n, i) => n + i.buffer.byteLength, 0) / 1024);
      console.log(
        `  ${shot.id.slice(0, 8)}  ${source.length} readable frame(s)` +
          `  ${baselineWidth}px ${kb(a)}kB  ${candidateWidth}px ${kb(b)}kB`
      );
    }
    return;
  }

  const unusable: { shot: Shot; reason: string }[] = [];

  for (const [index, shot] of shots.entries()) {
    const source = await loadSourceFrames(shot);
    if (source.length === 0) {
      unusable.push({ shot, reason: "frames unreadable" });
      continue;
    }
    // Same frames, same order, scaled once per side. When the widths match —
    // every run that is not asking about the downscale — both sides get an
    // identical request but for the model name.
    const baselineFrames = await framesAt(source, baselineWidth);
    const candidateFrames = await framesAt(source, candidateWidth);
    const system = await buildSystemPrompt(shot, source.length);
    // analyzeShotFrames only pays for the cache write when later shots in the
    // same video will read it back, so mirror that or the per-call price is a
    // fiction on one-shot videos.
    const cacheShared = shot.shot_count > 1;

    // The control is a property of the baseline alone, so it is taken before
    // the candidate can fail the shot out of the run — otherwise a weak
    // candidate quietly shrinks the noise floor it is being judged against.
    let baseline: StoredShotRecord | null = null;
    try {
      baseline = await analyze(baselineModel, system, baselineFrames, cacheShared);
      if (index < controlCount) {
        if (controlWidth === baselineWidth) {
          controlPairs.push({
            shot,
            a: baseline,
            b: await analyze(baselineModel, system, baselineFrames, cacheShared),
          });
        } else {
          // A floor at a width the baseline is not read at has to be two fresh
          // draws of its own. Pairing one of them against the baseline record
          // would be a cross-width diff wearing the control's label — the
          // exact confusion the column exists to resolve.
          const controlFrames = await framesAt(source, controlWidth);
          controlPairs.push({
            shot,
            a: await analyze(baselineModel, system, controlFrames, cacheShared),
            b: await analyze(baselineModel, system, controlFrames, cacheShared),
          });
        }
      }
    } catch (error) {
      unusable.push({ shot, reason: `${baselineModel}: ${schemaDetail(error)}` });
    }

    if (baseline) {
      try {
        pairs.push({
          shot,
          a: baseline,
          b: await analyze(candidateModel, system, candidateFrames, cacheShared),
        });
      } catch (error) {
        // The candidate could not produce a valid record for this shot even on
        // the retry. That is a result, not a crash — the run continues.
        unusable.push({ shot, reason: `${candidateModel}: ${schemaDetail(error)}` });
      }
    }
    process.stdout.write(`.`);
  }
  console.log("");

  if (unusable.length) {
    console.log("\nNO RECORD PRODUCED");
    for (const row of unusable) {
      console.log(`  ${row.shot.id.slice(0, 8)}  ${row.shot.title.slice(0, 50)}  ${row.reason}`);
    }
  }
  if (pairs.length === 0) throw new Error("no shot produced a record from both models");

  console.log("\nTOKENS AND COST");
  for (const [model, u] of usage) {
    const total = cost(model, u);
    const bare = uncachedCost(model, u);
    const r = retries.get(model);
    const prompt = u.input + u.cacheWrite + u.cacheRead;
    console.log(
      `  ${model.padEnd(20)} ${u.calls} calls  in ${u.input.toLocaleString()}` +
        `  cache w/r ${u.cacheWrite.toLocaleString()}/${u.cacheRead.toLocaleString()}` +
        `  out ${u.output.toLocaleString()}` +
        (total == null ? "  cost n/a" : `  $${total.toFixed(4)}  ($${(total / u.calls).toFixed(4)}/call)`) +
        `  schema retries ${r?.retried ?? 0} (${r?.failed ?? 0} unrecoverable)`
    );
    // Per-call prompt and output volume are the only two things a model
    // controls. The cache split is the run's doing, so it gets its own line
    // and a price that ignores it.
    console.log(
      `  ${"".padEnd(20)} per call: prompt ${Math.round(prompt / u.calls).toLocaleString()} tok` +
        `  out ${Math.round(u.output / u.calls).toLocaleString()} tok` +
        (bare == null ? "" : `  $${(bare / u.calls).toFixed(4)}/call priced with no cache`)
    );
  }
  // A prefix left warm by an earlier run reads back at 10% instead of being
  // written at 125%, so a repeat run prices lower than the first call of a
  // segment ever will. Compare the two models to each other, not to a budget.
  console.log("  (cache writes of 0 mean a previous run left the prefix warm)");

  // When the widths differ the models are the same, so a label naming only the
  // model would print the same string on both sides of every arrow.
  const side = (model: string, width: number) =>
    baselineWidth === candidateWidth ? model : `${model} @${width}px`;

  report(
    {
      baseline: side(baselineModel, baselineWidth),
      candidate: side(candidateModel, candidateWidth),
      pairs,
    },
    controlPairs.length
      ? {
          baseline: side(baselineModel, controlWidth),
          candidate: `${side(baselineModel, controlWidth)} (control)`,
          pairs: controlPairs,
        }
      : null
  );

  if (outPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      outPath,
      JSON.stringify(
        {
          baselineModel,
          candidateModel,
          baselineWidth,
          candidateWidth,
          records: pairs.map((p) => ({ shot: p.shot.id, title: p.shot.title, baseline: p.a, candidate: p.b })),
          control: controlPairs.map((p) => ({ shot: p.shot.id, first: p.a, second: p.b })),
        },
        null,
        2
      ),
      "utf8"
    );
    console.log(`\nwrote ${outPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
