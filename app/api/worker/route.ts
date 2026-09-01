import { NextResponse } from "next/server";
import { isInternalRequest, jsonError } from "@/lib/http";
import { drainQueue } from "@/lib/pipeline/worker";

/**
 * The processing worker. Driven by cron and by an in-process kick after a
 * submit; both are just triggers — the durable job rows are the source of
 * truth, so a missed tick delays work rather than losing it.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isInternalRequest(request)) return jsonError("Unauthorized", 401);
  const url = new URL(request.url);
  const maxMs = Math.min(280_000, Number(url.searchParams.get("maxMs") ?? 240_000));
  const batchSize = Math.min(4, Math.max(1, Number(url.searchParams.get("batch") ?? 2)));
  const result = await drainQueue({ maxMs, batchSize });
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return POST(request);
}
