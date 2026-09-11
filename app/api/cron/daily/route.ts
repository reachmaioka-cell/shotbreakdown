import { NextResponse } from "next/server";
import { isInternalRequest, jsonError } from "@/lib/http";
import {
  sweepStuckVideos,
  sweepStuckBreakdowns,
  writePromptInsights,
  runLearningTick,
} from "@/lib/cron-jobs";
import { dailySegmentCap, segmentsCreatedToday } from "@/lib/capacity";
import { drainQueue } from "@/lib/pipeline/worker";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/**
 * Daily maintenance: recover any video whose pipeline stalled with no live job,
 * drain whatever is queued, prune rate-limit rows, then run the learning work.
 * The 2-minute /api/worker cron does the routine processing.
 */
export async function GET(request: Request) {
  if (!isInternalRequest(request)) return jsonError("Unauthorized", 401);

  // The processing queue comes first: a user waiting on an analysis matters more
  // than the nightly learning work.
  const requeued = await sweepStuckVideos();
  const breakdowns = await sweepStuckBreakdowns();
  const processed = await drainQueue({ maxMs: 180_000, batchSize: 2 });
  await createAdminClient().rpc("prune_rate_limits").then(
    () => {},
    () => {}
  );

  // What the site-wide ceiling has spent in the last 24 hours, so the daily log
  // line says how close DAILY_SEGMENT_CAP came to turning people away.
  const capacity = {
    segmentsToday: await segmentsCreatedToday().catch(() => null),
    cap: dailySegmentCap(),
  };

  const insights = await writePromptInsights();
  let learning = { seeded: 0, claimed: 0, completed: 0, failed: 0, pending: 0, jobs: [] as unknown[] };
  try {
    learning = await runLearningTick(12);
  } catch (e) {
    console.error("learning tick failed", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true, requeued, breakdowns, processed, capacity, insights, learning });
}
