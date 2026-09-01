import { after, NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { jsonError } from "@/lib/http";
import { enqueueJob } from "@/lib/pipeline/queue";
import { planLimits } from "@/lib/plans";
import { enforceRateLimit } from "@/lib/rate-limit";
import { detectLinkSource } from "@/lib/source";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthlyVideoUsage } from "@/lib/videos";

export const maxDuration = 60;

const LinkBody = z.object({
  url: z.string().url().max(2000),
  title: z.string().max(200).optional(),
});

const UploadBody = z.object({
  filePath: z.string().min(1).max(500),
  sourceType: z.enum(["video_upload", "frame_upload"]),
  title: z.string().max(200).optional(),
  sizeBytes: z.number().int().positive().optional(),
});

const Body = z.union([LinkBody, UploadBody]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to analyze a video", 401);

  const limited = await enforceRateLimit("video_submit", request, user.id);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();
  const plan = (profile?.plan as string | null) ?? "free";
  const limits = planLimits(plan);

  const usage = await monthlyVideoUsage(user.id, plan);
  if (usage.remaining <= 0) {
    return NextResponse.json(
      {
        error: "plan_limit_reached",
        message: `You've used all ${usage.limit} analyses on your plan this month.`,
        usage,
      },
      { status: 402 }
    );
  }

  const admin = createAdminClient();
  let insert: Record<string, unknown>;

  if ("url" in parsed.data) {
    const source = detectLinkSource(parsed.data.url);
    if (!source) {
      return jsonError("Only YouTube, TikTok and Instagram links are supported", 400);
    }
    insert = {
      user_id: user.id,
      source_type: source,
      source_url: parsed.data.url,
      title: parsed.data.title ?? null,
      status: "queued",
      content_hash: `link:${parsed.data.url}`,
    };
  } else {
    // The storage RLS policy already confines writes to the user's own folder;
    // this check stops a mismatched path from ever reaching the pipeline.
    if (!parsed.data.filePath.startsWith(`${user.id}/`)) {
      return jsonError("Invalid file path", 400);
    }
    if (parsed.data.sizeBytes && parsed.data.sizeBytes > limits.maxUploadBytes) {
      return jsonError("This file is larger than your plan allows", 413);
    }
    insert = {
      user_id: user.id,
      source_type: parsed.data.sourceType,
      file_path: parsed.data.filePath,
      title: parsed.data.title ?? null,
      size_bytes: parsed.data.sizeBytes ?? null,
      status: "queued",
      content_hash: `file:${parsed.data.filePath}`,
    };
  }

  // content_hash is uniquely indexed per user, so a double-submit resolves to
  // the existing video instead of starting a second pipeline.
  const { data: existing } = await admin
    .from("videos")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("content_hash", insert.content_hash as string)
    .maybeSingle();

  if (existing) {
    await enqueueJob(
      "ingest_video",
      { videoId: existing.id },
      { videoId: existing.id as string, userId: user.id, dedupeKey: `ingest:${existing.id}` }
    ).catch(() => null);
    after(() => kickWorker());
    return NextResponse.json({ videoId: existing.id, duplicate: true });
  }

  const { data: video, error } = await admin
    .from("videos")
    .insert(insert)
    .select("id")
    .single();

  if (error || !video) {
    return jsonError(error?.message ?? "Could not create the video", 500);
  }

  await enqueueJob(
    "ingest_video",
    { videoId: video.id },
    {
      videoId: video.id as string,
      userId: user.id,
      dedupeKey: `ingest:${video.id}`,
      priority: limits.jobPriority,
    }
  );

  trackAsync("upload_completed", {
    userId: user.id,
    properties: { source_type: insert.source_type as string, plan },
  });
  trackAsync("processing_started", { userId: user.id, properties: { videoId: video.id } });

  // Fast path for a warm instance. Correctness does not depend on it: the job
  // row is durable and the cron worker picks it up regardless.
  after(() => kickWorker());

  return NextResponse.json({ videoId: video.id, usage });
}

/**
 * Warm-start the pipeline in the same invocation the user submitted from, so a
 * short clip is often finished before they finish reading the page. Purely an
 * optimisation: the durable jobs are picked up by cron regardless, and this
 * function is allowed to be cut off at any point.
 */
async function kickWorker(): Promise<void> {
  try {
    const { drainQueue } = await import("@/lib/pipeline/worker");
    await drainQueue({ maxMs: 45_000, batchSize: 1 });
  } catch (e) {
    console.error("kickWorker", e instanceof Error ? e.message : e);
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 24)));

  const { data, error } = await supabase
    .from("videos")
    .select(
      "id, title, status, stage_detail, progress, shot_count, analyzed_shot_count, duration_seconds, poster_path, source_type, error_message, created_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ videos: data ?? [] });
}
