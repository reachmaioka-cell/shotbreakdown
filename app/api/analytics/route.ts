import { NextResponse } from "next/server";
import { z } from "zod";
import { isAnalyticsEvent, track } from "@/lib/analytics";
import { jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  event: z.string().max(60),
  properties: z.record(z.string().max(60), z.unknown()).optional(),
  anonId: z.string().max(64).optional(),
});

/**
 * Client-side analytics ingest. Only known event names are accepted, so the
 * table cannot become an arbitrary write target, and no IP or user agent is
 * recorded.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const limited = await enforceRateLimit("analytics", request, user?.id ?? null);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);
  if (!isAnalyticsEvent(parsed.data.event)) return jsonError("Unknown event", 400);

  await track(parsed.data.event, {
    userId: user?.id ?? null,
    anonId: parsed.data.anonId ?? null,
    properties: (parsed.data.properties ?? {}) as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true });
}
