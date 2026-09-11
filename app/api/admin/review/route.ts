import { NextResponse } from "next/server";
import { z } from "zod";
import { FEATURES } from "@/lib/features";
import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  shotId: z.string().uuid(),
  action: z.enum(["publish", "reject"]),
});

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return !!profile?.is_admin;
}

export async function POST(request: Request) {
  if (!FEATURES.adminReview) return jsonError("Not found", 404);
  if (!(await requireAdmin())) return jsonError("Not found", 404);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const service = createAdminClient();

  // Both actions are limited to editorial rows. Without that, a shot id typed
  // into this endpoint would publish any customer's private upload.
  if (parsed.data.action === "publish") {
    const { data, error } = await service
      .from("shots")
      .update({ visibility: "public" })
      .eq("id", parsed.data.shotId)
      .eq("status", "complete")
      .eq("is_editorial", true)
      .select("id");
    if (error) return jsonError(error.message, 500);
    if (!data?.length) return jsonError("Not found", 404);

    // Published shots become part of the retrieval corpus for future analyses.
    void import("@/lib/learning/hooks")
      .then(({ queueVerifiedLearning }) => queueVerifiedLearning(parsed.data.shotId))
      .catch(() => {});
  } else {
    // Clearing the editorial flag is what makes a rejection stick: the row
    // drops out of the queue instead of coming back on the next load.
    const { data, error } = await service
      .from("shots")
      .update({ visibility: "private", is_editorial: false })
      .eq("id", parsed.data.shotId)
      .eq("is_editorial", true)
      .select("id");
    if (error) return jsonError(error.message, 500);
    if (!data?.length) return jsonError("Not found", 404);
  }

  return NextResponse.json({ ok: true });
}
