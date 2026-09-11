import { after } from "next/server";
import { requireVerifiedUser } from "@/lib/auth-guard";
import { jsonError } from "@/lib/http";
import { enqueueJob, findActiveJob } from "@/lib/pipeline/queue";
import { enforceIpRateLimit, enforceRateLimit } from "@/lib/rate-limit";
import { editorialHidden } from "@/lib/shots";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  readSegmentBreakdown,
  StoredAiRecreationSchema,
  type StoredAiRecreation,
} from "@/lib/validation";

export const maxDuration = 60;

function dedupeKeyFor(videoId: string): string {
  return `ai-recreation:${videoId}`;
}

/** Parse videos.ai_recreation. Null for absent, malformed or older shapes. */
function readAiRecreation(value: unknown): StoredAiRecreation | null {
  if (!value || typeof value !== "object") return null;
  const parsed = StoredAiRecreationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
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
 * The generative route to the same segment: its status, and the answer once it
 * has been asked for.
 *
 * Read through the service role and authorize in code, the way the breakdown
 * route does: RLS only exposes public rows to a non-owner, so an unlisted
 * segment shared by link would 404 for the person holding the link.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data: video } = await admin
    .from("videos")
    .select(
      "id, user_id, visibility, is_editorial, ai_recreation, ai_recreation_status, ai_recreation_error"
    )
    .eq("id", id)
    .maybeSingle();

  if (!video) return jsonError("Not found", 404);

  const isOwner = !!user && video.user_id === user.id;
  if (!isOwner && video.visibility === "private") return jsonError("Not found", 404);

  /*
   * Belt and braces over the line above. What keeps the editorial corpus out
   * of this response before launch is that its rows are private; this covers
   * the window after scripts/publish-editorial.ts has made them public and
   * before FEATURE_PUBLIC_LIBRARY is on.
   */
  if (await editorialHidden(video.is_editorial, isOwner, user?.id ?? null)) {
    return jsonError("Not found", 404);
  }

  const status = (video.ai_recreation_status as string | null) ?? "missing";
  // ai_recreation_error is the raw pipeline/provider message stored verbatim, so
  // it is the owner's to read, not a public reader's — they cannot act on it and
  // it can name internals.
  const error =
    status === "failed" && isOwner ? ((video.ai_recreation_error as string | null) ?? null) : null;
  return Response.json({
    status,
    recreation: readAiRecreation(video.ai_recreation),
    error,
  });
}

/**
 * Ask for the AI route. Owner only, and never automatic: this is a model call
 * behind a button, for the reader who came to make the thing with generative
 * tools rather than a camera.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // The request body is deliberately never read. This route takes no input, and
  // request.json() throws on the empty body a bare "generate it" POST sends.
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to generate an AI recreation", 401);

  // Nothing writes this document automatically, so every call here spends. It
  // needs an inbox we have reached, checked before the rate limit.
  const unverified = requireVerifiedUser(user);
  if (unverified) return unverified;

  const admin = createAdminClient();
  const { data: video } = await admin
    .from("videos")
    .select("id, user_id, status, breakdown")
    .eq("id", id)
    .maybeSingle();

  // Ownership before the rate limit, so a stranger cannot spend the owner's budget.
  if (!video || video.user_id !== user.id) return jsonError("Not found", 404);
  if (video.status !== "complete") return jsonError("This segment is still processing.", 400);
  // The AI route is written against the breakdown — same shots, same reading of
  // the look — so there is nothing to generate from until that exists.
  if (!readSegmentBreakdown(video.breakdown)) {
    return jsonError("The breakdown has to be written first.", 400);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();
  const isPro = profile?.plan === "pro";

  const limited = await enforceRateLimit(
    "ai_recreation",
    request,
    user.id,
    isPro ? { limit: 40 } : undefined
  );
  if (limited) return limited;

  // The per-user budget bounds one account, and accounts are free.
  const ipLimited = await enforceIpRateLimit("ai_recreation_ip", request);
  if (ipLimited) return ipLimited;

  const already = await findActiveJob(dedupeKeyFor(id));
  if (already) return Response.json({ status: "pending" });

  // ai_recreation_status and ai_recreation_error are pipeline-owned: the
  // protect_video_columns trigger rejects them from a client, so this write has
  // to go through the service role.
  const { error: updateError } = await admin
    .from("videos")
    .update({ ai_recreation_status: "pending", ai_recreation_error: null })
    .eq("id", id);
  if (updateError) return jsonError(updateError.message, 500);

  await enqueueJob(
    "generate_ai_recreation",
    { videoId: id },
    {
      videoId: id,
      userId: user.id,
      dedupeKey: dedupeKeyFor(id),
      priority: 4,
    }
  );

  after(() => kickWorker());
  return Response.json({ status: "pending" });
}
