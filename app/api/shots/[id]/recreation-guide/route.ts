import { after } from "next/server";
import { requireVerifiedUser } from "@/lib/auth-guard";
import { jsonError } from "@/lib/http";
import { enqueueJob, findActiveJob } from "@/lib/pipeline/queue";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getShot } from "@/lib/shots";
import { createClient } from "@/lib/supabase/server";
import { hasRecreationGuide, type RecreationGuide, type ShotMetadata } from "@/lib/validation";

export const maxDuration = 60;

function guideFromMetadata(metadata: ShotMetadata | null): RecreationGuide | null {
  if (!metadata || !hasRecreationGuide(metadata)) return null;
  return {
    recreation_steps: metadata.recreation_steps ?? [],
    budget_recreation: {
      under_500_usd: metadata.budget_recreation?.under_500_usd ?? [],
      under_5000_usd: metadata.budget_recreation?.under_5000_usd ?? [],
    },
    common_mistakes: metadata.common_mistakes ?? [],
    post_production: {
      editing: metadata.post_production?.editing ?? "",
      color_grade: metadata.post_production?.color_grade ?? "",
      vfx: metadata.post_production?.vfx ?? "",
      ai_tools: metadata.post_production?.ai_tools ?? "",
    },
    vfx: metadata.vfx ?? [],
    notes: metadata.notes ?? "",
  };
}

async function kickWorker(): Promise<void> {
  try {
    const { drainQueue } = await import("@/lib/pipeline/worker");
    await drainQueue({ maxMs: 50_000, batchSize: 1 });
  } catch {
    // Cron or the local worker will pick the job up.
  }
}

/**
 * On-demand recreation guide. Generated once per shot, stored on the record,
 * then served to anyone who can read the shot.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const shot = await getShot(id, user?.id ?? null);
  if (!shot) return jsonError("Not found", 404);

  const guide = guideFromMetadata(shot.metadata);
  if (guide) return Response.json({ status: "ready", guide });

  const job = await findActiveJob(`recreation:${id}`);
  if (job) return Response.json({ status: "pending", guide: null });

  return Response.json({ status: "missing", guide: null });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to generate a recreation guide", 401);

  // Generated on demand, one model call per shot, so it needs an inbox we have
  // reached. Checked before the rate limit.
  const unverified = requireVerifiedUser(user);
  if (unverified) return unverified;

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();
  const isPro = profile?.plan === "pro";

  const limited = await enforceRateLimit(
    "recreation_guide",
    request,
    user.id,
    isPro ? { limit: 80 } : undefined
  );
  if (limited) return limited;

  const shot = await getShot(id, user.id);
  if (!shot?.metadata || !(shot.metadata.description || shot.metadata.one_line_summary || shot.metadata.composition)) {
    return jsonError("Not found", 404);
  }

  const existing = guideFromMetadata(shot.metadata);
  if (existing) return Response.json({ status: "ready", guide: existing });

  const already = await findActiveJob(`recreation:${id}`);
  if (already) return Response.json({ status: "pending", guide: null });

  await enqueueJob(
    "generate_recreation_guide",
    { shotId: id },
    {
      videoId: shot.videoId,
      userId: user.id,
      dedupeKey: `recreation:${id}`,
      priority: 4,
    }
  );

  after(() => kickWorker());
  return Response.json({ status: "pending", guide: null });
}
