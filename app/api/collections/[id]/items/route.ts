import { NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const AddBody = z.object({
  shotId: z.string().uuid().optional(),
  shotIds: z.array(z.string().uuid()).max(200).optional(),
  note: z.string().max(1000).optional(),
});

const RemoveBody = z.object({ shotId: z.string().uuid() });
const NoteBody = z.object({ shotId: z.string().uuid(), note: z.string().max(1000).nullable() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to add shots", 401);

  const limited = await enforceRateLimit("collection_write", request, user.id);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = AddBody.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const shotIds = parsed.data.shotIds ?? (parsed.data.shotId ? [parsed.data.shotId] : []);
  if (shotIds.length === 0) return jsonError("No shots given", 400);

  const admin = createAdminClient();
  const { data: collection } = await admin
    .from("collections")
    .select("id, user_id, kind")
    .eq("id", id)
    .maybeSingle();
  if (!collection || collection.user_id !== user.id) return jsonError("Not found", 404);

  // Only shots the user may see can be collected.
  const { data: allowed } = await admin
    .from("shots")
    .select("id, user_id, visibility")
    .in("id", shotIds);
  const allowedIds = (allowed ?? [])
    .filter((s) => s.visibility !== "private" || s.user_id === user.id)
    .map((s) => s.id as string);
  if (allowedIds.length === 0) return jsonError("Not found", 404);

  const { data: last } = await admin
    .from("collection_items")
    .select("position")
    .eq("collection_id", id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  let position = ((last?.position as number) ?? -1) + 1;

  const rows = allowedIds.map((shotId) => ({
    collection_id: id,
    shot_id: shotId,
    user_id: user.id,
    note: parsed.data.note ?? null,
    position: position++,
  }));

  const { error } = await supabase
    .from("collection_items")
    .upsert(rows, { onConflict: "collection_id,shot_id", ignoreDuplicates: true });
  if (error) return jsonError(error.message, 500);

  trackAsync("shot_added_to_collection", {
    userId: user.id,
    properties: { collectionId: id, count: rows.length, kind: collection.kind as string },
  });

  return NextResponse.json({ added: rows.length });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const parsed = NoteBody.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const { error } = await supabase
    .from("collection_items")
    .update({ note: parsed.data.note })
    .eq("collection_id", id)
    .eq("shot_id", parsed.data.shotId)
    .eq("user_id", user.id);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = RemoveBody.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const { error } = await supabase
    .from("collection_items")
    .delete()
    .eq("collection_id", id)
    .eq("shot_id", parsed.data.shotId)
    .eq("user_id", user.id);
  if (error) return jsonError(error.message, 500);

  trackAsync("shot_removed_from_collection", { userId: user.id, properties: { collectionId: id } });
  return NextResponse.json({ ok: true });
}
