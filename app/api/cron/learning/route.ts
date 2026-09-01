import { NextResponse } from "next/server";
import { isInternalRequest, jsonError } from "@/lib/http";
import { runLearningWorker } from "@/lib/learning/worker";

export const maxDuration = 60;

/**
 * Continuous learning tick. Call every 1–5 minutes from an external cron
 * (cron-job.org, GitHub Actions, or `npm run learning:worker` locally).
 * Each invocation seeds recurring jobs if due, then processes a batch.
 */
export async function GET(request: Request) {
  if (!isInternalRequest(request)) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const batch = Math.min(Number(url.searchParams.get("batch") ?? 10), 20);

  const result = await runLearningWorker(batch);
  return NextResponse.json({ ok: true, ...result });
}
