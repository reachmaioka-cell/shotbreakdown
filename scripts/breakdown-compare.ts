/**
 * Is the segment breakdown the same document on a cheaper model?
 *
 * The breakdown is the product's moat — the technique reading, the physics, the
 * routes — and it is prose and structure, so there is nothing here to diff
 * field by field: two correct writers produce different sentences. What this
 * does is put the two documents side by side on the things that are either
 * right or wrong, and print the evidence each model was given so the reader can
 * check the answer against the input rather than against the other answer.
 *
 * Both models are handed THE SAME inputs: one call to the pipeline's own
 * loadSegmentFrames, one set of facet records, one motion block, then
 * generateSegmentBreakdown twice with only the model swapped. Rebuilding the
 * request here instead would measure this script, not the product.
 *
 *   npx tsx --env-file=.env.local scripts/breakdown-compare.ts \
 *     --videos=id,id [--baseline=claude-sonnet-4-6] [--candidate=claude-sonnet-5]
 *     [--out=path.json]
 */
import type Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "../lib/constants";
import { MAX_BREAKDOWN_FRAMES, generateSegmentBreakdown, motionBlock } from "../lib/segment-breakdown";
import { loadSegmentFrames } from "../lib/pipeline/stages";
import { createAdminClient } from "../lib/supabase/admin";
import type { SegmentBreakdown } from "../lib/validation";

const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const videoIds = (flag("videos") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const baselineModel = flag("baseline") ?? MODEL;
const candidateModel = flag("candidate") ?? "claude-sonnet-5";
const outPath = flag("out");

type Usage = { input: number; output: number; calls: number };
const usage = new Map<string, Usage>();

function record(u: Anthropic.Usage, model: string) {
  const prev = usage.get(model) ?? { input: 0, output: 0, calls: 0 };
  usage.set(model, {
    // The breakdown carries no cache breakpoint by design, so there is no
    // cached half to add here; whatever the API reports is the whole call.
    input: prev.input + u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    output: prev.output + u.output_tokens,
    calls: prev.calls + 1,
  });
}

function cost(model: string, u: Usage): string {
  const price = PRICES[model];
  if (!price) return "cost n/a";
  const total = (u.input * price.input + u.output * price.output) / 1_000_000;
  return `$${total.toFixed(4)}  ($${(total / u.calls).toFixed(4)}/call)`;
}

function wrap(text: string, indent = "      "): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > 96) {
      lines.push(line.trim());
      line = word;
    } else {
      line += ` ${word}`;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l) => indent + l).join("\n");
}

function printBreakdown(label: string, b: SegmentBreakdown) {
  console.log(`\n  ${"─".repeat(90)}`);
  console.log(`  ${label}`);
  console.log(`  ${"─".repeat(90)}`);
  console.log(`    title:      ${b.title}`);
  console.log(`    difficulty: ${b.difficulty}    crew: ${b.crew ?? "(none)"}`);
  console.log(`    what_happens:`);
  console.log(wrap(b.what_happens));
  if (b.focus_answer.trim()) {
    console.log(`    focus_answer:`);
    console.log(wrap(b.focus_answer));
  }
  const t = b.technique;
  if (!t) {
    console.log("    technique:  (none)");
  } else {
    console.log(`    technique.name:`);
    console.log(wrap(t.name));
    console.log(`    technique.evidence:`);
    console.log(wrap(t.evidence));
    t.routes.forEach((route, i) => {
      console.log(`    route ${i + 1}: ${route.name}`);
      console.log(`      when: ${route.when}`);
      route.steps.forEach((step, j) => console.log(wrap(`${j + 1}. ${step}`, "        ")));
      if (route.gives_up) console.log(`      gives up: ${route.gives_up}`);
    });
  }
  console.log(`    shot_sequence:`);
  for (const s of b.shot_sequence) {
    console.log(`      [${s.shot_index}] ${s.timecode}  ${s.what_happens}`);
    console.log(`           made: ${s.how_it_was_made}`);
    if (s.cut_note) console.log(`           cut:  ${s.cut_note}`);
  }
  console.log(`    departments:`);
  for (const d of b.departments) {
    console.log(`      ${d.role.padEnd(16)} steps ${d.steps.length}  pitfalls ${d.pitfalls.length}  ${d.headline}`);
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (videoIds.length === 0) throw new Error("pass --videos=id,id");

  const admin = createAdminClient();
  const results: unknown[] = [];

  console.log(`baseline  ${baselineModel}`);
  console.log(`candidate ${candidateModel}`);

  for (const videoId of videoIds) {
    const { data: video } = await admin
      .from("videos")
      .select("id, user_id, title, focus, duration_seconds, fps")
      .eq("id", videoId)
      .maybeSingle();
    if (!video) throw new Error(`video ${videoId} not found`);

    const { data: shotRows } = await admin
      .from("shots")
      .select("id, shot_index, start_seconds, end_seconds, metadata, motion_profile")
      .eq("video_id", videoId)
      .eq("status", "complete")
      .order("shot_index");
    const shots = shotRows ?? [];
    if (shots.length === 0) throw new Error(`video ${videoId} has no complete shots`);

    // The pipeline's own frame loader, so the two documents are written from
    // the frames production would have sent, at production's width.
    const inputs = await loadSegmentFrames(admin, shots as never, MAX_BREAKDOWN_FRAMES);

    const [{ data: preferences }, { data: insight }] = await Promise.all([
      video.user_id
        ? admin.from("user_preferences").select("*").eq("user_id", video.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("prompt_insights")
        .select("summary")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const focus = ((video.focus as string | null) ?? "").trim() || null;
    const segmentSeconds =
      video.duration_seconds !== null
        ? Number(video.duration_seconds)
        : Math.max(...inputs.map((s) => s.endSeconds), 0);
    const fps = video.fps !== null && video.fps !== undefined ? Number(video.fps) : null;

    console.log(`\n${"=".repeat(94)}`);
    console.log(`SEGMENT ${videoId}  ${video.title ?? ""}`);
    console.log(
      `  ${shots.length} shots  ${segmentSeconds.toFixed(2)}s  ${fps ?? "?"}fps` +
        `  ${inputs.reduce((n, s) => n + (s.images?.length ?? 0), 0)} frames  focus: ${focus ?? "(none)"}`
    );
    // The physics and the dips are the evidence both documents have to account
    // for, so print them next to the answers rather than making the reader go
    // and find what the model was told.
    const motion = motionBlock(inputs);
    console.log(`\n  WHAT THE MODEL WAS GIVEN — motion profile`);
    console.log(motion ? wrap(motion, "    ") : "    (none measured)");
    if (fps) console.log(`\n  Longest a single frame can be exposed: 1/${fps}s`);

    const shared = {
      shots: inputs,
      focus,
      videoTitle: (video.title as string | null) ?? null,
      segmentSeconds,
      fps,
      preferences: (preferences as never) ?? null,
      insights: (insight?.summary as string | null) ?? null,
      onUsage: record,
    };

    // A model that cannot write this segment's breakdown is a result, not a
    // crash: the run continues so the other side is still measured, and the
    // usage of the failed attempts is already recorded and still billed.
    const attempt = async (model: string) => {
      const before = usage.get(model) ?? { input: 0, output: 0, calls: 0 };
      try {
        return await generateSegmentBreakdown({ ...shared, model });
      } catch (error) {
        const after = usage.get(model) ?? before;
        console.log(
          `\n  FAILED ${model}: ${error instanceof Error ? error.message : String(error)}` +
            `  (${after.calls - before.calls} calls, ${after.output - before.output} output tokens)`
        );
        return null;
      }
    };

    const a = await attempt(baselineModel);
    const b = await attempt(candidateModel);

    if (a) printBreakdown(`A — ${baselineModel}`, a);
    if (b) printBreakdown(`B — ${candidateModel}`, b);

    results.push({ videoId, title: video.title, fps, focus, baseline: a, candidate: b });
  }

  console.log("\nTOKENS AND COST");
  for (const [model, u] of usage) {
    console.log(
      `  ${model.padEnd(20)} ${u.calls} calls  in ${u.input.toLocaleString()}  out ${u.output.toLocaleString()}  ${cost(model, u)}`
    );
  }

  if (outPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outPath, JSON.stringify({ baselineModel, candidateModel, results }, null, 2), "utf8");
    console.log(`\nwrote ${outPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
