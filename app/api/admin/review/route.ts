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

  if (parsed.data.action === "publish") {
    const { error } = await service
      .from("shots")
      .update({ visibility: "public", is_editorial: true })
      .eq("id", parsed.data.shotId)
      .eq("status", "complete");
    if (error) return jsonError(error.message, 500);

    // Published shots become part of the retrieval corpus for future analyses.
    void import("@/lib/learning/hooks")
      .then(({ queueVerifiedLearning }) => queueVerifiedLearning(parsed.data.shotId))
      .catch(() => {});
  } else {
    const { error } = await service
      .from("shots")
      .update({ visibility: "private" })
      .eq("id", parsed.data.shotId);
    if (error) return jsonError(error.message, 500);
  }

  return NextResponse.json({ ok: true });
}
