import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import {
  AI_RECREATION_PROMPT_VERSION,
  generateAiRecreation,
  MAX_AI_FRAMES,
} from "@/lib/ai-recreation";
import { SIGNED_URL_TTL_SEC, UPLOAD_BUCKET } from "@/lib/constants";
import { embed, shotEmbeddingText } from "@/lib/embeddings";
import {
  planLimits,
  SEGMENT_LENGTH_TOLERANCE_SECONDS,
  SEGMENT_TRIM_EPSILON_SECONDS,
} from "@/lib/plans";
import { enqueueJob, heartbeat, type ProcessingJob } from "@/lib/pipeline/queue";
import { analyzeShotFrames, SHOT_PROMPT_VERSION } from "@/lib/shot-analysis";
import { generateRecreationGuide } from "@/lib/recreation-guide";
import {
  generateSegmentBreakdown,
  MAX_BREAKDOWN_FRAMES,
  planFrameBudget,
  SEGMENT_PROMPT_VERSION,
  spreadFrames,
  type SegmentFrame,
  type SegmentShotInput,
} from "@/lib/segment-breakdown";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectShots, extractShotFrames, SHOT_DETECTION } from "@/lib/video/shots";
import { probeVideo, runFfmpeg, trimVideo } from "@/lib/video/ffmpeg";
import { instagramOembed, tiktokOembed, youtubeThumbnailAndTitle } from "@/lib/source";
import { fetchAnalysisImage } from "@/lib/media";
import {
  AI_RECREATION_VERSION,
  readSegmentBreakdown,
  SEGMENT_BREAKDOWN_VERSION,
  ShotMetadataSchema,
  type StoredAiRecreation,
  type StoredSegmentBreakdown,
  type StoredShotRecord,
} from "@/lib/validation";

type Admin = ReturnType<typeof createAdminClient>;

/** Leave headroom inside the platform's function timeout before re-enqueueing. */
const TIME_BUDGET_MS = 170_000;
const ANALYSIS_TIME_BUDGET_MS = 150_000;
const FRAME_WIDTH = 1280;
const THUMB_WIDTH = 640;
const CANDIDATES_PER_SHOT = 5;
/** Frames sent to the model per shot: first, representative, last. */
const ANALYSIS_FRAMES = 3;

export class PipelineError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  constructor(message: string, code: string, retryable = true) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
    this.retryable = retryable;
  }
}

async function setVideoStatus(
  admin: Admin,
  videoId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await admin.from("videos").update(patch).eq("id", videoId);
}

async function signedUrl(admin: Admin, path: string, ttl = SIGNED_URL_TTL_SEC): Promise<string> {
  const { data, error } = await admin.storage.from(UPLOAD_BUCKET).createSignedUrl(path, ttl);
  if (error || !data) throw new PipelineError(`Could not read ${path}`, "storage_read_failed");
  return data.signedUrl;
}

async function downloadToTemp(url: string, dir: string, maxBytes: number): Promise<string> {
  const target = join(dir, "source");
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new PipelineError(`Could not download the source video (${res.status})`, "download_failed");
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared && declared > maxBytes) {
    throw new PipelineError("This video is larger than your plan allows", "too_large", false);
  }
  await streamPipeline(Readable.fromWeb(res.body as never), createWriteStream(target));
  const info = await stat(target);
  if (info.size === 0) throw new PipelineError("The uploaded file is empty", "empty_file", false);
  if (info.size > maxBytes) {
    throw new PipelineError("This video is larger than your plan allows", "too_large", false);
  }
  return target;
}

async function makeThumbnail(sourcePath: string, outPath: string): Promise<void> {
  await runFfmpeg([
    "-hide_banner",
    "-nostats",
    "-i",
    sourcePath,
    "-vf",
    `scale='min(${THUMB_WIDTH},iw)':-2`,
    "-q:v",
    "5",
    "-y",
    outPath,
  ]);
}

async function uploadJpeg(admin: Admin, path: string, body: Buffer): Promise<void> {
  const { error } = await admin.storage.from(UPLOAD_BUCKET).upload(path, body, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw new PipelineError(`Could not store frame: ${error.message}`, "storage_write_failed");
}

/** Where a trimmed segment lives. Stable, so a re-run overwrites rather than piles up. */
function segmentStoragePath(userId: string | null, videoId: string): string {
  return `${userId ?? "editorial"}/videos/${videoId}/segment.mp4`;
}

/**
 * Cut the user's chosen range out of the file they uploaded, and make that cut
 * the thing the rest of the pipeline sees.
 *
 * The product analyses a SEGMENT, never a whole video. Doing the cut here
 * rather than in the browser means the range is enforced server-side, the
 * original never has to be kept, and every downstream timecode is relative to
 * the segment with no offset arithmetic anywhere else.
 *
 * Idempotent. A resumed ingest finds file_path already pointing at the trimmed
 * object and re-uses it, so a long video is not re-encoded once per continuation.
 */
async function materializeSegment(
  admin: Admin,
  args: {
    videoId: string;
    userId: string | null;
    storedPath: string;
    localPath: string;
    dir: string;
    segmentStart: number | null;
    segmentEnd: number | null;
    maxSeconds: number;
  }
): Promise<{ localPath: string; storedPath: string; trimmed: boolean }> {
  const targetPath = segmentStoragePath(args.userId, args.videoId);

  // A previous run already cut this segment; what we downloaded IS the segment.
  if (args.storedPath === targetPath) {
    return { localPath: args.localPath, storedPath: args.storedPath, trimmed: true };
  }

  const probe = await probeVideo(args.localPath);
  const sourceDuration = probe.durationSeconds;

  await setVideoStatus(admin, args.videoId, { source_duration_seconds: sourceDuration });

  const start = Math.max(0, args.segmentStart ?? 0);
  const end = Math.min(
    sourceDuration,
    args.segmentEnd !== null && args.segmentEnd > start ? args.segmentEnd : sourceDuration
  );
  const length = end - start;

  if (!(length > 0)) {
    throw new PipelineError(
      "That segment is empty. Pick a range with some footage in it.",
      "empty_segment",
      false
    );
  }

  if (length > args.maxSeconds + SEGMENT_LENGTH_TOLERANCE_SECONDS) {
    throw new PipelineError(
      `That segment is ${formatSeconds(length)}. Your plan allows ${formatSeconds(args.maxSeconds)}. Trim it and try again.`,
      "too_long",
      false
    );
  }

  const coversWholeFile =
    start <= SEGMENT_TRIM_EPSILON_SECONDS &&
    end >= sourceDuration - SEGMENT_TRIM_EPSILON_SECONDS;

  if (coversWholeFile) {
    return { localPath: args.localPath, storedPath: args.storedPath, trimmed: false };
  }

  await setVideoStatus(admin, args.videoId, {
    stage_detail: `Cutting ${formatSeconds(length)} from your upload`,
    progress: 8,
  });

  const trimmedPath = join(args.dir, "segment.mp4");
  await trimVideo(args.localPath, trimmedPath, start, end);

  const { readFile } = await import("node:fs/promises");
  const body = await readFile(trimmedPath);
  const { error: uploadError } = await admin.storage
    .from(UPLOAD_BUCKET)
    .upload(targetPath, body, { contentType: "video/mp4", upsert: true });
  if (uploadError) {
    throw new PipelineError(
      `Could not store the trimmed segment: ${uploadError.message}`,
      "storage_write_failed"
    );
  }

  // Point the row at the segment only once the object is really there. If this
  // update fails the job retries and re-uploads over the same key.
  await setVideoStatus(admin, args.videoId, { file_path: targetPath });

  // The original is not part of the product and the user did not ask us to keep
  // it. Best-effort: a leftover object is waste, not a broken analysis, and the
  // account-deletion path sweeps the user's folder anyway.
  const { error: removeError } = await admin.storage
    .from(UPLOAD_BUCKET)
    .remove([args.storedPath]);
  if (removeError) {
    console.error("segment original cleanup", args.storedPath, removeError.message);
  }

  return { localPath: trimmedPath, storedPath: targetPath, trimmed: true };
}

/** "45 seconds" / "2m 30s" — for messages a user reads. */
function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 120) return `${whole} second${whole === 1 ? "" : "s"}`;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/* ------------------------------------------------------------------ *
 * Stage 1 — ingest: probe, detect shots, extract and store frames.
 *
 * Resumable: the job carries `fromShotIndex`, and when the time budget runs
 * out it enqueues a continuation for the remaining shots rather than dying
 * mid-video. Re-running a shot that already has frames is a no-op.
 * ------------------------------------------------------------------ */

export async function runIngestVideo(job: ProcessingJob): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const videoId = job.video_id ?? (job.payload.videoId as string | undefined);
  if (!videoId) throw new PipelineError("Job has no video", "bad_job", false);

  const { data: video, error } = await admin
    .from("videos")
    .select(
      "id, user_id, source_type, source_url, file_path, title, status, duration_seconds, segment_start, segment_end, focus"
    )
    .eq("id", videoId)
    .maybeSingle();

  if (error || !video) throw new PipelineError("Video not found", "not_found", false);

  const { data: profile } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", video.user_id ?? "")
    .maybeSingle();
  const limits = planLimits(profile?.plan as string | null);

  // Link and still sources have no timeline to cut up: one video, one shot.
  if (video.source_type !== "video_upload") {
    return ingestSingleFrameSource(admin, video as SourceVideo);
  }

  if (!video.file_path) throw new PipelineError("Video has no stored file", "no_file", false);

  const fromShotIndex = Number(job.payload.fromShotIndex ?? 0);
  const startedAt = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "sb-ingest-"));

  try {
    await setVideoStatus(admin, videoId, {
      status: "detecting_shots",
      stage_detail: "Reading the video",
      progress: 5,
      error_message: null,
      error_code: null,
    });

    const url = await signedUrl(admin, video.file_path, 3600);
    const downloadedPath = await downloadToTemp(url, dir, limits.maxUploadBytes);

    // Cut the segment out before anything else looks at the footage, so every
    // timecode from here on — shot boundaries, the breakdown's cut notes, the
    // player — is relative to what the user actually chose.
    const segment = await materializeSegment(admin, {
      videoId,
      userId: video.user_id as string | null,
      storedPath: video.file_path as string,
      localPath: downloadedPath,
      dir,
      segmentStart: video.segment_start !== null ? Number(video.segment_start) : null,
      segmentEnd: video.segment_end !== null ? Number(video.segment_end) : null,
      maxSeconds: limits.maxVideoSeconds,
    });
    const localPath = segment.localPath;

    const detection = await detectShots(localPath, { maxShots: limits.maxShotsPerVideo });

    await setVideoStatus(admin, videoId, {
      status: "extracting_frames",
      stage_detail: `Found ${detection.shots.length} shot${detection.shots.length === 1 ? "" : "s"}`,
      progress: 15,
      duration_seconds: detection.probe.durationSeconds,
      width: detection.probe.width,
      height: detection.probe.height,
      fps: detection.probe.fps,
      aspect_ratio: detection.probe.aspectRatio,
      size_bytes: detection.probe.sizeBytes,
      shot_count: detection.shots.length,
    });

    // Shot rows are created up front so the UI can show the timeline while
    // frames are still being written.
    const existing = await admin
      .from("shots")
      .select("id, shot_index")
      .eq("video_id", videoId);
    const existingByIndex = new Map(
      (existing.data ?? []).map((r) => [r.shot_index as number, r.id as string])
    );

    const missing = detection.shots.filter((s) => !existingByIndex.has(s.index));
    if (missing.length > 0) {
      const { data: inserted, error: insertError } = await admin
        .from("shots")
        .insert(
          missing.map((s) => ({
            video_id: videoId,
            user_id: video.user_id,
            shot_index: s.index,
            start_seconds: s.startSeconds,
            end_seconds: s.endSeconds,
            status: "pending" as const,
            title: video.title,
            width: detection.probe.width,
            height: detection.probe.height,
            aspect_ratio: detection.probe.aspectRatio,
          }))
        )
        .select("id, shot_index");
      if (insertError) {
        throw new PipelineError(`Could not create shots: ${insertError.message}`, "db_write_failed");
      }
      for (const row of inserted ?? []) {
        existingByIndex.set(row.shot_index as number, row.id as string);
      }
    }

    let processed = 0;
    let nextIndex = fromShotIndex;

    for (const shot of detection.shots) {
      if (shot.index < fromShotIndex) continue;
      nextIndex = shot.index;

      if (Date.now() - startedAt > TIME_BUDGET_MS && processed > 0) {
        await enqueueJob(
          "ingest_video",
          { videoId, fromShotIndex: shot.index },
          { videoId, userId: video.user_id, priority: limits.jobPriority + 1 }
        );
        return { resumedAt: shot.index, framesFor: processed };
      }

      const shotId = existingByIndex.get(shot.index);
      if (!shotId) continue;

      const { count } = await admin
        .from("shot_frames")
        .select("id", { count: "exact", head: true })
        .eq("shot_id", shotId);
      if ((count ?? 0) > 0) continue; // already extracted — idempotent re-run

      await extractAndStoreShotFrames(admin, {
        localPath,
        dir,
        videoId,
        userId: video.user_id,
        shotId,
        shot,
      });

      processed += 1;
      nextIndex = shot.index + 1;

      if (processed % 5 === 0) {
        await heartbeat(job.id);
        await setVideoStatus(admin, videoId, {
          stage_detail: `Extracting frames (${shot.index + 1} of ${detection.shots.length})`,
          progress: Math.min(45, 15 + Math.round(((shot.index + 1) / detection.shots.length) * 30)),
        });
      }
    }

    await setVideoStatus(admin, videoId, {
      status: "analyzing",
      stage_detail: "Analyzing shots",
      progress: 50,
    });

    await enqueueJob(
      "analyze_shots",
      { videoId, fromShotIndex: 0 },
      {
        videoId,
        userId: video.user_id,
        priority: limits.jobPriority,
        dedupeKey: `analyze:${videoId}`,
      }
    );

    return { shots: detection.shots.length, framesFor: processed, nextIndex };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type SourceVideo = {
  id: string;
  user_id: string | null;
  source_type: string;
  source_url: string | null;
  file_path: string | null;
  title: string | null;
};

/**
 * A pasted link or an uploaded still has no timeline to segment. It still
 * becomes a video with exactly one shot, so the rest of the product — library,
 * search, collections, sharing — has a single shape to work with.
 */
async function ingestSingleFrameSource(
  admin: Admin,
  video: SourceVideo
): Promise<Record<string, unknown>> {
  await setVideoStatus(admin, video.id, {
    status: "extracting_frames",
    stage_detail: "Fetching the frame",
    progress: 20,
  });

  let frameUrl: string | null = null;
  let title = video.title;

  if (video.source_type === "frame_upload" && video.file_path) {
    frameUrl = await signedUrl(admin, video.file_path, 3600);
  } else if (video.source_type === "youtube" && video.source_url) {
    const meta = await youtubeThumbnailAndTitle(video.source_url);
    frameUrl = meta.thumbnail;
    title = title ?? meta.title;
  } else if (video.source_type === "tiktok" && video.source_url) {
    const meta = await tiktokOembed(video.source_url);
    frameUrl = meta.thumbnail;
    title = title ?? meta.title;
  } else if (video.source_type === "instagram" && video.source_url) {
    const meta = await instagramOembed(video.source_url);
    frameUrl = meta.thumbnail;
    title = title ?? meta.title;
  }

  if (!frameUrl) {
    throw new PipelineError(
      "Could not get a frame from this link. Upload a still or a clip instead.",
      "no_frame",
      false
    );
  }

  const { buffer } = await fetchAnalysisImage(frameUrl);
  if (buffer.byteLength < 4000) {
    throw new PipelineError("The frame from this link is a placeholder image", "bad_frame", false);
  }

  const { data: existing } = await admin
    .from("shots")
    .select("id")
    .eq("video_id", video.id)
    .eq("shot_index", 0)
    .maybeSingle();

  let shotId = existing?.id as string | undefined;
  if (!shotId) {
    const { data: created, error } = await admin
      .from("shots")
      .insert({
        video_id: video.id,
        user_id: video.user_id,
        shot_index: 0,
        start_seconds: 0,
        end_seconds: 0,
        status: "pending" as const,
        title,
      })
      .select("id")
      .single();
    if (error) throw new PipelineError(`Could not create shot: ${error.message}`, "db_write_failed");
    shotId = created.id as string;
  }

  const dir = await mkdtemp(join(tmpdir(), "sb-frame-"));
  try {
    const framePath = `${video.user_id ?? "editorial"}/videos/${video.id}/shots/0/frame.jpg`;
    const thumbPath = `${video.user_id ?? "editorial"}/videos/${video.id}/shots/0/thumb.jpg`;
    const localFull = join(dir, "full.jpg");
    const localThumb = join(dir, "thumb.jpg");
    await writeFile(localFull, buffer);
    await makeThumbnail(localFull, localThumb);

    await uploadJpeg(admin, framePath, buffer);
    const { readFile } = await import("node:fs/promises");
    await uploadJpeg(admin, thumbPath, await readFile(localThumb));

    const { data: frame } = await admin
      .from("shot_frames")
      .upsert(
        {
          shot_id: shotId,
          video_id: video.id,
          user_id: video.user_id,
          timestamp_seconds: 0,
          storage_path: framePath,
          thumb_path: thumbPath,
          is_representative: true,
          score: 1,
        },
        { onConflict: "shot_id,storage_path", ignoreDuplicates: false }
      )
      .select("id")
      .maybeSingle();

    await admin
      .from("shots")
      .update({
        thumbnail_path: thumbPath,
        poster_path: framePath,
        representative_frame_id: frame?.id ?? null,
        representative_timestamp: 0,
        title,
      })
      .eq("id", shotId);

    await setVideoStatus(admin, video.id, {
      status: "analyzing",
      stage_detail: "Analyzing the shot",
      progress: 50,
      shot_count: 1,
      title,
      poster_path: thumbPath,
    });

    await enqueueJob(
      "analyze_shots",
      { videoId: video.id, fromShotIndex: 0 },
      { videoId: video.id, userId: video.user_id, dedupeKey: `analyze:${video.id}` }
    );

    return { shots: 1 };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function extractAndStoreShotFrames(
  admin: Admin,
  args: {
    localPath: string;
    dir: string;
    videoId: string;
    userId: string | null;
    shotId: string;
    shot: { index: number; startSeconds: number; endSeconds: number };
  }
): Promise<void> {
  const { frames } = await extractShotFrames(args.localPath, args.shot, {
    candidates: CANDIDATES_PER_SHOT,
    width: FRAME_WIDTH,
  });

  const folder = `${args.userId ?? "editorial"}/videos/${args.videoId}/shots/${args.shot.index}`;
  const rows: Record<string, unknown>[] = [];
  let representativePath: string | null = null;
  let representativeThumb: string | null = null;
  let representativeTs = args.shot.startSeconds;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const storagePath = `${folder}/f${i}.jpg`;
    await uploadJpeg(admin, storagePath, frame.buffer);

    let thumbPath: string | null = null;
    if (frame.isRepresentative) {
      const localFull = join(args.dir, `rep-${args.shot.index}.jpg`);
      const localThumb = join(args.dir, `rep-${args.shot.index}-t.jpg`);
      await writeFile(localFull, frame.buffer);
      await makeThumbnail(localFull, localThumb);
      const { readFile } = await import("node:fs/promises");
      thumbPath = `${folder}/thumb.jpg`;
      await uploadJpeg(admin, thumbPath, await readFile(localThumb));
      representativePath = storagePath;
      representativeThumb = thumbPath;
      representativeTs = frame.timestampSeconds;
    }

    rows.push({
      shot_id: args.shotId,
      video_id: args.videoId,
      user_id: args.userId,
      timestamp_seconds: frame.timestampSeconds,
      storage_path: storagePath,
      thumb_path: thumbPath,
      score: frame.score,
      is_representative: frame.isRepresentative,
    });
  }

  const { data: inserted, error } = await admin.from("shot_frames").insert(rows).select("id, is_representative");
  if (error) throw new PipelineError(`Could not store frames: ${error.message}`, "db_write_failed");

  const representative = (inserted ?? []).find((r) => r.is_representative);
  await admin
    .from("shots")
    .update({
      thumbnail_path: representativeThumb,
      poster_path: representativePath,
      representative_frame_id: representative?.id ?? null,
      representative_timestamp: representativeTs,
    })
    .eq("id", args.shotId);

  // The first shot's frame doubles as the video poster.
  if (args.shot.index === 0 && representativeThumb) {
    await admin.from("videos").update({ poster_path: representativeThumb }).eq("id", args.videoId);
  }
}

/* ------------------------------------------------------------------ *
 * Stage 2 — analyse: Claude per shot, then embed and index.
 * ------------------------------------------------------------------ */

export async function runAnalyzeShots(job: ProcessingJob): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const videoId = job.video_id ?? (job.payload.videoId as string | undefined);
  if (!videoId) throw new PipelineError("Job has no video", "bad_job", false);

  const { data: video } = await admin
    .from("videos")
    .select("id, user_id, title, source_type, shot_count, focus")
    .eq("id", videoId)
    .maybeSingle();
  if (!video) throw new PipelineError("Video not found", "not_found", false);

  const [{ data: profile }, { data: preferences }, { data: insight }] = await Promise.all([
    admin.from("profiles").select("plan").eq("id", video.user_id ?? "").maybeSingle(),
    admin.from("user_preferences").select("*").eq("user_id", video.user_id ?? "").maybeSingle(),
    admin
      .from("prompt_insights")
      .select("summary")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const limits = planLimits(profile?.plan as string | null);

  // A shot left in `analyzing` means a worker died mid-call. Return it to the
  // queue before selecting work, otherwise it is invisible to this stage and
  // finalize keeps bouncing the video back here forever.
  await releaseStaleAnalyzing(admin, videoId);

  const { data: pending } = await admin
    .from("shots")
    .select("id, shot_index, start_seconds, end_seconds, title")
    .eq("video_id", videoId)
    .in("status", ["pending", "failed"])
    .order("shot_index")
    .limit(limits.maxShotsPerVideo);

  const queue = pending ?? [];
  if (queue.length === 0) {
    await enqueueJob(
      "finalize_video",
      { videoId },
      { videoId, userId: video.user_id, dedupeKey: `finalize:${videoId}` }
    );
    return { analyzed: 0, remaining: 0 };
  }

  // Retrieve published shots close to this video once per batch and hand them
  // to the analyser as few-shot examples. This is what makes the library
  // improve the analysis rather than only storing its output.
  const similarBlock = await buildSimilarBlock(admin, video.title as string | null);

  const startedAt = Date.now();
  let analyzed = 0;
  let failed = 0;

  for (const shot of queue) {
    if (Date.now() - startedAt > ANALYSIS_TIME_BUDGET_MS && analyzed > 0) break;

    await admin.from("shots").update({ status: "analyzing" }).eq("id", shot.id);

    try {
      await analyzeOneShot(admin, {
        shotId: shot.id as string,
        shotIndex: shot.shot_index as number,
        startSeconds: Number(shot.start_seconds),
        endSeconds: Number(shot.end_seconds),
        videoId,
        videoTitle: (video.title as string | null) ?? (shot.title as string | null),
        sourceType: video.source_type as string,
        shotCount: (video.shot_count as number) || queue.length,
        preferences: preferences ?? null,
        insights: (insight?.summary as string | null) ?? null,
        similarBlock,
        focus: (video.focus as string | null) ?? null,
      });
      analyzed += 1;
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : "Analysis failed";
      await admin
        .from("shots")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", shot.id);
      console.error("analyzeOneShot", shot.id, message);
    }

    await heartbeat(job.id);
    const done = await countAnalyzed(admin, videoId);
    await setVideoStatus(admin, videoId, {
      analyzed_shot_count: done,
      stage_detail: `Analyzing shots (${done} of ${video.shot_count || queue.length})`,
      progress: Math.min(
        95,
        50 + Math.round((done / Math.max(1, (video.shot_count as number) || queue.length)) * 45)
      ),
    });
  }

  const { count: stillPending } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("video_id", videoId)
    .eq("status", "pending");

  if ((stillPending ?? 0) > 0) {
    /*
     * The continuation needs a dedupe key THIS job is not already holding.
     *
     * The dedupe index is unique over ('pending','running'), and this job is
     * still 'running' under `analyze:<id>` while it enqueues its own successor.
     * Reusing that key means the insert is rejected as a duplicate, enqueueJob
     * returns null, and a segment with more shots than fit in one time budget
     * stops dead with no job to carry it on. Numbering the pass keeps the
     * guarantee that matters — two workers cannot queue the same continuation —
     * without colliding with the run that is creating it. Same shape as the
     * finalize hand-back below.
     */
    const pass = Number(job.payload.pass ?? 0) + 1;
    await enqueueJob(
      "analyze_shots",
      { videoId, pass },
      {
        videoId,
        userId: video.user_id,
        priority: limits.jobPriority + 1,
        dedupeKey: `analyze:${videoId}:${pass}`,
      }
    );
  } else {
    await enqueueJob(
      "finalize_video",
      { videoId },
      { videoId, userId: video.user_id, dedupeKey: `finalize:${videoId}` }
    );
  }

  return { analyzed, failed, remaining: stillPending ?? 0 };
}

async function countAnalyzed(admin: Admin, videoId: string): Promise<number> {
  const { count } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("video_id", videoId)
    .eq("status", "complete");
  return count ?? 0;
}

export async function analyzeOneShot(
  admin: Admin,
  args: {
    shotId: string;
    shotIndex: number;
    startSeconds: number;
    endSeconds: number;
    videoId: string;
    videoTitle: string | null;
    sourceType: string;
    shotCount: number;
    preferences: Record<string, unknown> | null;
    insights: string | null;
    similarBlock?: string | null;
    focus?: string | null;
  }
): Promise<StoredShotRecord> {
  const { data: frames } = await admin
    .from("shot_frames")
    .select("id, storage_path, timestamp_seconds, is_representative")
    .eq("shot_id", args.shotId)
    .order("timestamp_seconds");

  if (!frames || frames.length === 0) {
    throw new PipelineError("This shot has no frames to analyze", "no_frames", false);
  }

  // First / representative / last gives the model motion evidence without
  // paying for every candidate frame.
  const chosen: typeof frames = [];
  const representative = frames.find((f) => f.is_representative) ?? frames[0];
  chosen.push(frames[0]);
  if (representative.id !== frames[0].id) chosen.push(representative);
  const last = frames[frames.length - 1];
  if (chosen.length < ANALYSIS_FRAMES && last.id !== representative.id && last.id !== frames[0].id) {
    chosen.push(last);
  }

  const images = await Promise.all(
    chosen.map(async (f) => {
      const url = await signedUrl(admin, f.storage_path as string);
      return fetchAnalysisImage(url);
    })
  );

  const record = await analyzeShotFrames({
    images,
    videoTitle: args.videoTitle,
    shotIndex: args.shotIndex,
    shotCount: args.shotCount,
    startSeconds: args.startSeconds,
    endSeconds: args.endSeconds,
    preferences: args.preferences as never,
    insights: args.insights,
    similarBlock: args.similarBlock ?? null,
    focus: args.focus ?? null,
  });

  const embedding = await embed(
    shotEmbeddingText(record, {
      title: args.videoTitle,
      videoTitle: args.videoTitle,
      sourceType: args.sourceType,
    })
  );

  const title =
    record.one_line_summary ||
    (args.videoTitle ? `${args.videoTitle} — shot ${args.shotIndex + 1}` : `Shot ${args.shotIndex + 1}`);

  const { error } = await admin
    .from("shots")
    .update({
      metadata: record,
      embedding,
      tags: record.tags,
      title,
      status: "complete",
      error_message: null,
      prompt_version: SHOT_PROMPT_VERSION,
    })
    .eq("id", args.shotId);

  if (error) throw new PipelineError(`Could not save shot: ${error.message}`, "db_write_failed");
  return record;
}

/**
 * Two published shots whose records are closest to this video, formatted as
 * examples. Best-effort: retrieval failure degrades the prompt, never the job.
 */
async function buildSimilarBlock(admin: Admin, videoTitle: string | null): Promise<string | null> {
  if (!videoTitle) return null;
  try {
    const vector = await embed(`${videoTitle} cinematography shot composition lighting colour`);
    const { data } = await admin.rpc("match_shots", {
      query_embedding: vector,
      match_k: 2,
      p_user_id: null,
    });
    const rows = (data ?? []) as { metadata: Record<string, unknown> | null }[];
    const examples = rows
      .map((row) => row.metadata)
      .filter((m): m is Record<string, unknown> => !!m)
      .map((m, i) => `Example ${i + 1}:\n${JSON.stringify(m).slice(0, 3000)}`);
    return examples.length > 0 ? examples.join("\n\n") : null;
  } catch (e) {
    console.error("buildSimilarBlock", e instanceof Error ? e.message : e);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Stage 3 — finalize.
 * ------------------------------------------------------------------ */

export async function runFinalizeVideo(job: ProcessingJob): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const videoId = job.video_id ?? (job.payload.videoId as string | undefined);
  if (!videoId) throw new PipelineError("Job has no video", "bad_job", false);

  await releaseStaleAnalyzing(admin, videoId);

  const { data: ownerRow } = await admin
    .from("videos")
    .select("user_id")
    .eq("id", videoId)
    .maybeSingle();
  const userIdForVideo = (ownerRow?.user_id as string | null) ?? null;

  const { data: counts } = await admin
    .from("shots")
    .select("status")
    .eq("video_id", videoId);

  const rows = counts ?? [];
  const complete = rows.filter((r) => r.status === "complete").length;
  const failedShots = rows.filter((r) => r.status === "failed").length;
  const pending = rows.filter((r) => r.status === "pending" || r.status === "analyzing").length;

  // Bounded: finalize hands work back to analyze at most a few times, then
  // settles the video rather than ping-ponging between the two stages.
  const handbacks = Number(job.payload.handbacks ?? 0);
  if (pending > 0 && handbacks < 5) {
    await enqueueJob(
      "finalize_video",
      { videoId, handbacks: handbacks + 1 },
      { videoId, delayMs: 15_000, dedupeKey: `finalize:${videoId}:${handbacks + 1}` }
    );
    await enqueueJob(
      "analyze_shots",
      { videoId, pass: `handback-${handbacks + 1}` },
      { videoId, delayMs: 5_000, dedupeKey: `analyze:${videoId}:handback-${handbacks + 1}` }
    );
    return { requeued: pending, handbacks: handbacks + 1 };
  }

  if (pending > 0) {
    // Give up on the stragglers rather than leaving the user on a spinner.
    await admin
      .from("shots")
      .update({ status: "failed", error_message: "Analysis did not finish after several attempts" })
      .eq("video_id", videoId)
      .in("status", ["pending", "analyzing"]);
  }

  const allFailed = complete === 0 && failedShots > 0;

  await setVideoStatus(admin, videoId, {
    status: allFailed ? "failed" : "complete",
    stage_detail: allFailed ? null : "Done",
    progress: 100,
    shot_count: rows.length,
    analyzed_shot_count: complete,
    completed_at: new Date().toISOString(),
    error_message: allFailed ? "Every shot failed to analyze. Try again." : null,
    error_code: allFailed ? "all_shots_failed" : null,
  });

  if (!allFailed) {
    const { data: poster } = await admin
      .from("shots")
      .select("thumbnail_path")
      .eq("video_id", videoId)
      .not("thumbnail_path", "is", null)
      .order("shot_index")
      .limit(1)
      .maybeSingle();
    if (poster?.thumbnail_path) {
      await admin.from("videos").update({ poster_path: poster.thumbnail_path }).eq("id", videoId);
    }

    // The breakdown IS the product, so it is not something the user has to ask
    // for. Segments are capped by plan, so this is a bounded, known cost per
    // upload rather than an open-ended one.
    await setVideoStatus(admin, videoId, {
      breakdown_status: "pending",
      breakdown_error: null,
    });
    await enqueueJob(
      "generate_segment_breakdown",
      { videoId },
      {
        videoId,
        userId: userIdForVideo,
        dedupeKey: `segment-breakdown:${videoId}`,
        priority: 3,
      }
    ).catch((e) => {
      // A queue failure here must not undo a finished analysis. The breakdown
      // stays 'pending' and the daily sweep or a manual retry picks it up.
      console.error("enqueue segment breakdown", videoId, e instanceof Error ? e.message : e);
      return null;
    });
  }

  return { complete, failed: failedShots };
}

/**
 * How long a shot may sit in `analyzing` before it is presumed abandoned.
 * Comfortably longer than a single analysis call, shorter than a user's
 * patience.
 */
const STALE_ANALYZING_MS = 6 * 60_000;

async function releaseStaleAnalyzing(admin: Admin, videoId: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_ANALYZING_MS).toISOString();
  const { data } = await admin
    .from("shots")
    .update({ status: "pending" })
    .eq("video_id", videoId)
    .eq("status", "analyzing")
    .lt("updated_at", cutoff)
    .select("id");
  return (data ?? []).length;
}

/** Re-run analysis for one shot — used after a representative-frame change. */
export async function runReanalyzeShot(job: ProcessingJob): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const shotId = job.payload.shotId as string | undefined;
  if (!shotId) throw new PipelineError("Job has no shot", "bad_job", false);

  const { data: shot } = await admin
    .from("shots")
    .select("id, video_id, shot_index, start_seconds, end_seconds, title")
    .eq("id", shotId)
    .maybeSingle();
  if (!shot) throw new PipelineError("Shot not found", "not_found", false);

  const { data: video } = await admin
    .from("videos")
    .select("id, user_id, title, source_type, shot_count")
    .eq("id", shot.video_id)
    .maybeSingle();
  if (!video) throw new PipelineError("Video not found", "not_found", false);

  const { data: preferences } = await admin
    .from("user_preferences")
    .select("*")
    .eq("user_id", video.user_id ?? "")
    .maybeSingle();

  await analyzeOneShot(admin, {
    shotId,
    shotIndex: shot.shot_index as number,
    startSeconds: Number(shot.start_seconds),
    endSeconds: Number(shot.end_seconds),
    videoId: shot.video_id as string,
    videoTitle: (video.title as string | null) ?? (shot.title as string | null),
    sourceType: video.source_type as string,
    shotCount: (video.shot_count as number) || 1,
    preferences: preferences ?? null,
    insights: null,
  });

  return { shotId };
}

/**
 * On-demand recreation guide for one shot. Merges steps/budget/mistakes onto
 * the existing library record and never rewrites the facet fields.
 */
export async function runGenerateRecreationGuide(job: ProcessingJob): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const shotId = job.payload.shotId as string | undefined;
  if (!shotId) throw new PipelineError("Job has no shot", "bad_job", false);

  const { data: shot } = await admin
    .from("shots")
    .select("id, video_id, shot_index, start_seconds, end_seconds, title, metadata, poster_path, thumbnail_path")
    .eq("id", shotId)
    .maybeSingle();
  if (!shot) throw new PipelineError("Shot not found", "not_found", false);

  const parsed = ShotMetadataSchema.safeParse(shot.metadata ?? {});
  if (
    !parsed.success ||
    !(parsed.data.description || parsed.data.one_line_summary || parsed.data.composition)
  ) {
    throw new PipelineError("This shot has no analysis to build a guide from", "no_record", false);
  }

  const { data: frames } = await admin
    .from("shot_frames")
    .select("id, storage_path, timestamp_seconds, is_representative")
    .eq("shot_id", shotId)
    .order("timestamp_seconds");

  const chosen: NonNullable<typeof frames> = [];
  if (frames && frames.length > 0) {
    const representative = frames.find((f) => f.is_representative) ?? frames[0];
    chosen.push(frames[0]);
    if (representative.id !== frames[0].id) chosen.push(representative);
    const last = frames[frames.length - 1];
    if (chosen.length < ANALYSIS_FRAMES && last.id !== representative.id && last.id !== frames[0].id) {
      chosen.push(last);
    }
  }

  let images: { buffer: Buffer; contentType: string }[] = [];
  if (chosen.length > 0) {
    images = await Promise.all(
      chosen.map(async (f) => {
        const url = await signedUrl(admin, f.storage_path as string);
        return fetchAnalysisImage(url);
      })
    );
  } else {
    const fallback = (shot.poster_path as string | null) ?? (shot.thumbnail_path as string | null);
    if (!fallback) throw new PipelineError("This shot has no frames to analyze", "no_frames", false);
    const url = fallback.startsWith("http") ? fallback : await signedUrl(admin, fallback);
    images = [await fetchAnalysisImage(url)];
  }

  const { data: video } = await admin
    .from("videos")
    .select("id, user_id, title")
    .eq("id", shot.video_id)
    .maybeSingle();

  const { data: preferences } = video?.user_id
    ? await admin.from("user_preferences").select("*").eq("user_id", video.user_id).maybeSingle()
    : { data: null };

  const { data: insight } = await admin
    .from("prompt_insights")
    .select("summary")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const guide = await generateRecreationGuide({
    images,
    metadata: parsed.data,
    videoTitle: (video?.title as string | null) ?? (shot.title as string | null),
    preferences: (preferences as never) ?? null,
    insights: (insight?.summary as string | null) ?? null,
  });

  const previous = (shot.metadata ?? {}) as Record<string, unknown>;
  const merged = {
    ...previous,
    recreation_steps: guide.recreation_steps,
    budget_recreation: guide.budget_recreation,
    common_mistakes: guide.common_mistakes,
    post_production: guide.post_production,
    vfx: guide.vfx,
    notes: guide.notes || previous.notes,
  };

  const { error } = await admin
    .from("shots")
    .update({ metadata: merged })
    .eq("id", shotId);
  if (error) throw new PipelineError(`Could not save guide: ${error.message}`, "db_write_failed");

  return { shotId };
}

/**
 * Frames for a segment-level pass, several per shot when the budget allows.
 *
 * Both the breakdown and the AI route read across the segment, and both need
 * to see change over time inside a shot — a single representative frame cannot
 * show a time remap, a freeze, a ramp or a hold. The candidate frames the
 * ingest stage already extracted are spread across each shot, so they are the
 * right sample and cost nothing extra to produce.
 */
async function loadSegmentFrames(
  admin: Admin,
  shots: { id: string; shot_index: number; start_seconds: unknown; end_seconds: unknown; metadata: unknown }[],
  maxFrames: number
): Promise<SegmentShotInput[]> {
  const { data: frames } = await admin
    .from("shot_frames")
    .select("shot_id, storage_path, is_representative, timestamp_seconds")
    .in(
      "shot_id",
      shots.map((s) => s.id)
    )
    .order("timestamp_seconds");

  type Candidate = { path: string; t: number; rep: boolean };
  const byShot = new Map<string, Candidate[]>();
  for (const f of frames ?? []) {
    const list = byShot.get(f.shot_id as string) ?? [];
    list.push({
      path: f.storage_path as string,
      t: Number(f.timestamp_seconds),
      rep: !!f.is_representative,
    });
    byShot.set(f.shot_id as string, list);
  }
  // The representative is stored twice on some shots (once as itself, once as a
  // candidate at the same timestamp). One frame per timestamp is enough.
  for (const [id, list] of byShot) {
    const seen = new Set<number>();
    byShot.set(
      id,
      list.filter((c) => {
        const key = Math.round(c.t * 1000);
        if (seen.has(key) && !c.rep) return false;
        seen.add(key);
        return true;
      })
    );
  }

  const budget = planFrameBudget(
    shots.map((s) => byShot.get(s.id)?.length ?? 0),
    maxFrames
  );

  return Promise.all(
    shots.map(async (shot, i) => {
      const parsed = ShotMetadataSchema.safeParse(shot.metadata ?? {});
      const candidates = byShot.get(shot.id) ?? [];
      const chosen = spreadFrames(candidates, budget[i] ?? 0, candidates.find((c) => c.rep));
      const images: SegmentFrame[] = [];
      for (const c of chosen) {
        try {
          const img = await fetchAnalysisImage(await signedUrl(admin, c.path));
          images.push({ ...img, timestampSeconds: c.t });
        } catch (e) {
          // A missing frame degrades the prompt; it must not fail the segment.
          console.error("segment frame", shot.id, e instanceof Error ? e.message : e);
        }
      }
      const rep = chosen.find((c) => c.rep) ?? chosen[0];
      const repImage = rep ? images[chosen.indexOf(rep)] ?? images[0] : images[0];
      return {
        shotIndex: shot.shot_index,
        startSeconds: Number(shot.start_seconds),
        endSeconds: Number(shot.end_seconds),
        metadata: parsed.success ? parsed.data : null,
        images,
        image: repImage ? { buffer: repImage.buffer, contentType: repImage.contentType } : null,
      };
    })
  );
}

/**
 * Write the breakdown for one segment.
 *
 * Runs after finalize, so every shot already has its facet record. This pass
 * reads across them — what happens, how the cuts land, what each department
 * does — which is the thing no per-shot analysis can produce.
 */
export async function runGenerateSegmentBreakdown(
  job: ProcessingJob
): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const videoId = job.video_id ?? (job.payload.videoId as string | undefined);
  if (!videoId) throw new PipelineError("Job has no video", "bad_job", false);

  const { data: video } = await admin
    .from("videos")
    .select("id, user_id, title, focus, duration_seconds, fps")
    .eq("id", videoId)
    .maybeSingle();
  if (!video) throw new PipelineError("Segment not found", "not_found", false);

  const { data: shotRows } = await admin
    .from("shots")
    .select("id, shot_index, start_seconds, end_seconds, metadata")
    .eq("video_id", videoId)
    .eq("status", "complete")
    .order("shot_index");

  const shots = shotRows ?? [];
  if (shots.length === 0) {
    throw new PipelineError(
      "This segment has no analysed shots to break down",
      "no_shots",
      false
    );
  }

  const inputs = await loadSegmentFrames(admin, shots as never, MAX_BREAKDOWN_FRAMES);

  const [{ data: preferences }, { data: insight }] = await Promise.all([
    video.user_id
      ? admin.from("user_preferences").select("*").eq("user_id", video.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("prompt_insights")
      .select("summary")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const focus = ((video.focus as string | null) ?? "").trim() || null;
  const segmentSeconds =
    video.duration_seconds !== null
      ? Number(video.duration_seconds)
      : Math.max(...inputs.map((s) => s.endSeconds), 0);

  const breakdown = await generateSegmentBreakdown({
    shots: inputs,
    focus,
    videoTitle: (video.title as string | null) ?? null,
    segmentSeconds,
    fps: video.fps !== null && video.fps !== undefined ? Number(video.fps) : null,
    preferences: (preferences as never) ?? null,
    insights: (insight?.summary as string | null) ?? null,
  });

  const stored: StoredSegmentBreakdown = {
    ...breakdown,
    version: SEGMENT_BREAKDOWN_VERSION,
    prompt_version: SEGMENT_PROMPT_VERSION,
    focus,
    generated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("videos")
    .update({
      breakdown: stored,
      breakdown_status: "ready",
      breakdown_error: null,
      breakdown_prompt_version: SEGMENT_PROMPT_VERSION,
      breakdown_generated_at: stored.generated_at,
    })
    .eq("id", videoId);
  if (error) {
    throw new PipelineError(`Could not save the breakdown: ${error.message}`, "db_write_failed");
  }

  /*
   * The question can change while the answer is being written.
   *
   * The refocus route cannot start a second job — the dedupe index blocks one
   * while this run is active — so a question asked mid-run would otherwise be
   * stored, charged, and silently never answered. Compare what we actually
   * answered against what the row says now, and if they differ, queue the
   * answer to the newer question. Dedupe no longer blocks it: this job is
   * finished by the time the insert lands.
   */
  const { data: latest } = await admin
    .from("videos")
    .select("focus")
    .eq("id", videoId)
    .maybeSingle();
  const currentFocus = ((latest?.focus as string | null) ?? "").trim() || null;
  if (currentFocus !== focus) {
    await setVideoStatus(admin, videoId, { breakdown_status: "pending", breakdown_error: null });
    await enqueueJob(
      "generate_segment_breakdown",
      { videoId },
      {
        videoId,
        userId: (video.user_id as string | null) ?? null,
        dedupeKey: `segment-breakdown:${videoId}`,
        priority: 4,
      }
    ).catch((e) => {
      // Losing the follow-up leaves the earlier answer in place rather than
      // nothing, so it is not worth failing a completed generation over.
      console.error("requeue segment breakdown", videoId, e instanceof Error ? e.message : e);
      return null;
    });
    return { videoId, shots: inputs.length, requeuedForNewFocus: true };
  }

  return { videoId, shots: inputs.length, framed: inputs.filter((s) => s.image).length };
}

/**
 * Write the generative route to the same segment.
 *
 * Never enqueued automatically. Most people opening a breakdown intend to shoot
 * the thing, and a generative pipeline bolted onto every answer would be padding
 * for them; this runs only when someone presses the button that asks for it.
 */
export async function runGenerateAiRecreation(
  job: ProcessingJob
): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const videoId = job.video_id ?? (job.payload.videoId as string | undefined);
  if (!videoId) throw new PipelineError("Job has no video", "bad_job", false);

  const { data: video } = await admin
    .from("videos")
    .select("id, user_id, title, focus, duration_seconds, breakdown")
    .eq("id", videoId)
    .maybeSingle();
  if (!video) throw new PipelineError("Segment not found", "not_found", false);

  // The AI answer is written against the camera answer: same shots, same
  // reading of the look, and it argues with the post section rather than
  // starting from nothing. Without one there is nothing to write against, and
  // waiting will not produce one, so this is terminal rather than retryable.
  const breakdown = readSegmentBreakdown(video.breakdown);
  if (!breakdown) {
    throw new PipelineError(
      "This segment has no breakdown to build the AI route from",
      "no_breakdown",
      false
    );
  }

  const { data: shotRows } = await admin
    .from("shots")
    .select("id, shot_index, start_seconds, end_seconds, metadata")
    .eq("video_id", videoId)
    .eq("status", "complete")
    .order("shot_index");

  const shots = shotRows ?? [];
  if (shots.length === 0) {
    throw new PipelineError(
      "This segment has no analysed shots to build the AI route from",
      "no_shots",
      false
    );
  }

  // Same frames the breakdown saw, for the same reason: a generative route has
  // to know whether the thing it is imitating moves, ramps, freezes or holds.
  const inputs = await loadSegmentFrames(admin, shots as never, MAX_AI_FRAMES);

  const [{ data: preferences }, { data: insight }] = await Promise.all([
    video.user_id
      ? admin.from("user_preferences").select("*").eq("user_id", video.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("prompt_insights")
      .select("summary")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const focus = ((video.focus as string | null) ?? "").trim() || null;
  const segmentSeconds =
    video.duration_seconds !== null
      ? Number(video.duration_seconds)
      : Math.max(...inputs.map((s) => s.endSeconds), 0);

  const recreation = await generateAiRecreation({
    shots: inputs,
    breakdown,
    focus,
    videoTitle: (video.title as string | null) ?? null,
    segmentSeconds,
    preferences: (preferences as never) ?? null,
    insights: (insight?.summary as string | null) ?? null,
  });

  const stored: StoredAiRecreation = {
    ...recreation,
    version: AI_RECREATION_VERSION,
    prompt_version: AI_RECREATION_PROMPT_VERSION,
    generated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("videos")
    .update({
      ai_recreation: stored,
      ai_recreation_status: "ready",
      ai_recreation_error: null,
      ai_recreation_prompt_version: AI_RECREATION_PROMPT_VERSION,
      ai_recreation_generated_at: stored.generated_at,
    })
    .eq("id", videoId);
  if (error) {
    throw new PipelineError(`Could not save the AI recreation: ${error.message}`, "db_write_failed");
  }

  return { videoId, shots: inputs.length, framed: inputs.filter((s) => s.image).length };
}

export const PIPELINE_LIMITS = { SHOT_DETECTION, FRAME_WIDTH, THUMB_WIDTH, CANDIDATES_PER_SHOT };
