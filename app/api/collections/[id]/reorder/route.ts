import { NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const Body = z.object({ shotIds: z.array(z.string().uuid()).min(1).max(500) });

/** Persist a new order for a sequence. The order sent is the order stored. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const limited = await enforceRateLimit("collection_write", request, user.id);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const admin = createAdminClient();
  const { data: collection } = await admin
    .from("collections")
    .select("id, user_id, kind")
    .eq("id", id)
    .maybeSingle();
  if (!collection || collection.user_id !== user.id) return jsonError("Not found", 404);

  const { data: existing } = await admin
    .from("collection_items")
    .select("shot_id")
    .eq("collection_id", id);
  const known = new Set((existing ?? []).map((r) => r.shot_id as string));

  const ordered = parsed.data.shotIds.filter((shotId) => known.has(shotId));
  if (ordered.length === 0) return jsonError("No matching shots", 400);

  for (let i = 0; i < ordered.length; i++) {
    const { error } = await admin
      .from("collection_items")
      .update({ position: i })
      .eq("collection_id", id)
      .eq("shot_id", ordered[i]);
    if (error) return jsonError(error.message, 500);
  }

  trackAsync("sequence_reordered", {
    userId: user.id,
    properties: { collectionId: id, count: ordered.length },
  });
  return NextResponse.json({ ok: true, ordered: ordered.length });
}
