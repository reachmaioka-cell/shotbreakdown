import { NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { listCollections, slugifyName, uniqueSlug } from "@/lib/collections";
import { jsonError } from "@/lib/http";
import { planLimits } from "@/lib/plans";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["collection", "sequence"]).default("collection"),
  description: z.string().max(1000).optional(),
  parentId: z.string().uuid().nullable().optional(),
  visibility: z.enum(["private", "unlisted", "public"]).default("private"),
  /** Optional: create and immediately add a shot, for quick-add from the grid. */
  shotId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const kind = kindParam === "sequence" || kindParam === "collection" ? kindParam : undefined;

  try {
    const collections = await listCollections(user.id, { kind });
    return NextResponse.json({ collections });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not load collections", 500);
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to create collections", 401);

  const limited = await enforceRateLimit("collection_write", request, user.id);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const admin = createAdminClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();
  const limits = planLimits(profile?.plan as string | null);

  const { count } = await admin
    .from("collections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= limits.maxCollections) {
    return NextResponse.json(
      { error: "plan_limit_reached", message: `Your plan holds ${limits.maxCollections} collections.` },
      { status: 402 }
    );
  }

  // A parent must belong to the same user, or hierarchy becomes a data leak.
  if (parsed.data.parentId) {
    const { data: parent } = await admin
      .from("collections")
      .select("id, user_id")
      .eq("id", parsed.data.parentId)
      .maybeSingle();
    if (!parent || parent.user_id !== user.id) return jsonError("Parent not found", 404);
  }

  const slug = await uniqueSlug(user.id, slugifyName(parsed.data.name));

  const { data: collection, error } = await supabase
    .from("collections")
    .insert({
      user_id: user.id,
      name: parsed.data.name.trim(),
      slug,
      kind: parsed.data.kind,
      description: parsed.data.description?.trim() || null,
      parent_id: parsed.data.parentId ?? null,
      visibility: parsed.data.visibility,
    })
    .select("id, name, slug, kind, visibility, item_count")
    .single();

  if (error || !collection) return jsonError(error?.message ?? "Could not create", 500);

  trackAsync(parsed.data.kind === "sequence" ? "sequence_created" : "collection_created", {
    userId: user.id,
    properties: { kind: parsed.data.kind, nested: !!parsed.data.parentId },
  });

  if (parsed.data.shotId) {
    const { data: shot } = await admin
      .from("shots")
      .select("id, user_id, visibility")
      .eq("id", parsed.data.shotId)
      .maybeSingle();
    if (shot && (shot.visibility !== "private" || shot.user_id === user.id)) {
      await supabase.from("collection_items").insert({
        collection_id: collection.id,
        shot_id: parsed.data.shotId,
        user_id: user.id,
        position: 0,
      });
      trackAsync("shot_added_to_collection", {
        userId: user.id,
        properties: { collectionId: collection.id },
      });
    }
  }

  return NextResponse.json({ collection });
}
