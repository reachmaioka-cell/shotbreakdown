import { NextResponse } from "next/server";
import { z } from "zod";
import { getCollection, slugifyName, uniqueSlug } from "@/lib/collections";
import { jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
  parentId: z.string().uuid().nullable().optional(),
  kind: z.enum(["collection", "sequence"]).optional(),
  coverShotId: z.string().uuid().nullable().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const collection = await getCollection({ id }, user?.id ?? null);
  if (!collection) return jsonError("Not found", 404);
  return NextResponse.json({ collection });
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
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("collections")
    .select("id, user_id, name")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.user_id !== user.id) return jsonError("Not found", 404);

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) {
    patch.name = parsed.data.name.trim();
    if (parsed.data.name.trim() !== existing.name) {
      patch.slug = await uniqueSlug(user.id, slugifyName(parsed.data.name));
    }
  }
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;
  if (parsed.data.kind !== undefined) patch.kind = parsed.data.kind;
  if (parsed.data.coverShotId !== undefined) patch.cover_shot_id = parsed.data.coverShotId;

  if (parsed.data.parentId !== undefined) {
    if (parsed.data.parentId) {
      const { data: parent } = await admin
        .from("collections")
        .select("id, user_id")
        .eq("id", parsed.data.parentId)
        .maybeSingle();
      if (!parent || parent.user_id !== user.id) return jsonError("Parent not found", 404);
    }
    patch.parent_id = parsed.data.parentId;
  }

  // The cycle-check trigger raises rather than silently accepting a loop.
  const { error } = await supabase.from("collections").update(patch).eq("id", id);
  if (error) {
    const cycle = /cycle|own parent|too deep/i.test(error.message);
    return jsonError(cycle ? "That would nest a collection inside itself" : error.message, cycle ? 400 : 500);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const { error } = await supabase.from("collections").delete().eq("id", id).eq("user_id", user.id);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
