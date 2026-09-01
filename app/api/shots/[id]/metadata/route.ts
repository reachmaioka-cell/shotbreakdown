import { NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { embed, shotEmbeddingText } from "@/lib/embeddings";
import { jsonError } from "@/lib/http";
import { isEditableFieldPath, overlayBreakdown, getPathValue } from "@/lib/overlay";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ShotMetadata } from "@/lib/validation";

const Body = z.object({
  /** Dotted path into the shot record, e.g. "composition.shot_size". */
  fieldKey: z.string().min(1).max(200).optional(),
  value: z.unknown().optional(),
  /** Tag operations are separate so corrections can be attributed correctly. */
  addTags: z.array(z.string().max(60)).max(10).optional(),
  removeTags: z.array(z.string().max(60)).max(10).optional(),
  title: z.string().max(200).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
});

/**
 * Owner corrections to AI output.
 *
 * Corrections are stored as an overlay on top of the original record, never
 * overwriting it, and each one is written to shot_edits so we can measure which
 * fields the model gets wrong. Re-embedding keeps search consistent with what
 * the user now sees.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const limited = await enforceRateLimit("edit", request, user.id);
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
  const { data: shot } = await admin
    .from("shots")
    .select("id, user_id, video_id, metadata, metadata_edits, tags, title, visibility")
    .eq("id", id)
    .maybeSingle();
  if (!shot || shot.user_id !== user.id) return jsonError("Not found", 404);

  const edits = { ...((shot.metadata_edits as Record<string, unknown> | null) ?? {}) };
  const patch: Record<string, unknown> = {};
  const audit: Record<string, unknown>[] = [];
  let tags = ((shot.tags as string[] | null) ?? []).slice();

  if (parsed.data.fieldKey !== undefined) {
    if (!isEditableFieldPath(parsed.data.fieldKey)) {
      return jsonError("That field cannot be edited", 400);
    }
    const previous = getPathValue(
      overlayBreakdown((shot.metadata ?? {}) as Record<string, unknown>, edits),
      parsed.data.fieldKey
    );
    edits[parsed.data.fieldKey] = parsed.data.value ?? null;
    patch.metadata_edits = edits;
    audit.push({
      kind: "metadata_changed",
      field_key: parsed.data.fieldKey,
      previous_value: previous ?? null,
      new_value: parsed.data.value ?? null,
    });
  }

  if (parsed.data.addTags?.length) {
    const added = parsed.data.addTags
      .map((t) => t.toLowerCase().trim().replace(/\s+/g, "-"))
      .filter((t) => t && !tags.includes(t));
    if (added.length + tags.length > 24) return jsonError("Too many tags", 400);
    tags = [...tags, ...added];
    for (const tag of added) audit.push({ kind: "tag_added", field_key: "tags", new_value: tag });
  }

  if (parsed.data.removeTags?.length) {
    const removing = new Set(parsed.data.removeTags.map((t) => t.toLowerCase().trim()));
    for (const tag of tags.filter((t) => removing.has(t))) {
      audit.push({ kind: "tag_removed", field_key: "tags", previous_value: tag });
    }
    tags = tags.filter((t) => !removing.has(t));
  }

  if (parsed.data.addTags?.length || parsed.data.removeTags?.length) patch.tags = tags;
  if (parsed.data.title !== undefined) patch.title = parsed.data.title.trim() || null;
  if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;

  if (Object.keys(patch).length === 0) return jsonError("Nothing to update", 400);

  const { error } = await admin.from("shots").update(patch).eq("id", id);
  if (error) return jsonError(error.message, 500);

  if (audit.length > 0) {
    await admin.from("shot_edits").insert(
      audit.map((entry) => ({ ...entry, shot_id: id, user_id: user.id }))
    );
    trackAsync("metadata_corrected", {
      userId: user.id,
      properties: { shotId: id, fields: audit.map((a) => a.field_key as string) },
    });
  }

  // Corrections change what the shot means, so the index has to follow.
  try {
    const merged = overlayBreakdown((shot.metadata ?? {}) as Record<string, unknown>, edits);
    const forIndex = { ...merged, tags } as unknown as ShotMetadata;
    const vector = await embed(
      shotEmbeddingText(forIndex, {
        title: (patch.title as string) ?? (shot.title as string | null),
      })
    );
    await admin.from("shots").update({ embedding: vector }).eq("id", id);
  } catch (e) {
    console.error("re-embed after edit", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true, tags });
}
