import { NextResponse } from "next/server";
import { trackAsync } from "@/lib/analytics";
import { jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { findSimilarShots } from "@/lib/shots";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const limited = await enforceRateLimit("similar", request, user?.id ?? null);
  if (limited) return limited;

  const url = new URL(request.url);
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get("limit") ?? 12)));

  try {
    const shots = await findSimilarShots({ shotId: id, limit, viewerId: user?.id ?? null });
    trackAsync("find_similar_clicked", { userId: user?.id ?? null, properties: { shotId: id } });
    return NextResponse.json({ shots });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not find similar shots", 500);
  }
}
