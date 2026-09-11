import { NextResponse } from "next/server";
import { z } from "zod";
import { FEATURES } from "@/lib/features";
import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  shotId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

/** The acting admin's id, or null for anyone who is not one. */
async function adminUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.is_admin ? user.id : null;
}

/**
 * Curation, not publication.
 *
 * Approving records that a row is fit for the library; it does not put it
 * there. Publication is scripts/publish-editorial.ts, run once at launch,
 * because `visibility = 'public'` is readable by anyone straight from PostgREST
 * with the publishable anon key — so a Publish button here would have meant
 * exposing the corpus one row at a time while curating it.
 */
export async function POST(request: Request) {
  if (!FEATURES.adminReview) return jsonError("Not found", 404);
  const reviewerId = await adminUserId();
  if (!reviewerId) return jsonError("Not found", 404);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const service = createAdminClient();
  const decision = {
    review_status: parsed.data.action === "approve" ? "approved" : "rejected",
    reviewed_at: new Date().toISOString(),
    reviewed_by: reviewerId,
  };

  /*
   * Both actions are limited to editorial rows. Without that, a shot id typed
   * into this endpoint would decide the fate of any customer's private upload.
   *
   * A rejection also forces the row private, which is what makes it stick for
   * the rows seeded public by earlier runs. An approval deliberately leaves
   * visibility alone: after launch the corpus is public, and rewriting it here
   * would unpublish a live row the moment Ken approved the next batch.
   */
  const update =
    parsed.data.action === "approve" ? decision : { ...decision, visibility: "private" };

  let query = service
    .from("shots")
    .update(update)
    .eq("id", parsed.data.shotId)
    .eq("is_editorial", true);
  if (parsed.data.action === "approve") query = query.eq("status", "complete");

  const { data, error } = await query.select("id");
  if (error) return jsonError(error.message, 500);
  if (!data?.length) return jsonError("Not found", 404);

  if (parsed.data.action === "approve") {
    // An admin vouching for a shot is what makes it worth distilling into the
    // retrieval corpus; the launch script only moves it into public view.
    void import("@/lib/learning/hooks")
      .then(({ queueVerifiedLearning }) => queueVerifiedLearning(parsed.data.shotId))
      .catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
