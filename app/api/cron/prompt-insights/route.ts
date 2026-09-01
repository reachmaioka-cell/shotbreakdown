import { NextResponse } from "next/server";
import { isInternalRequest, jsonError } from "@/lib/http";
import { writePromptInsights } from "@/lib/cron-jobs";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isInternalRequest(request)) return jsonError("Unauthorized", 401);
  try {
    const insights = await writePromptInsights();
    return NextResponse.json({ ok: true, ...insights });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Cron failed", 500);
  }
}
