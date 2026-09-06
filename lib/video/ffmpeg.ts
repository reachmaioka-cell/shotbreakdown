import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const exec = promisify(execFile);

function binaries(): { ffmpeg: string; ffprobe: string } {
  return { ffmpeg: ffmpegInstaller.path, ffprobe: ffprobeInstaller.path };
}

export function ffmpegPath(): string {
  return binaries().ffmpeg;
}

export type RunResult = { stdout: string; stderr: string };

export async function runFfmpeg(args: string[], timeoutMs = 240_000): Promise<RunResult> {
  const { ffmpeg } = binaries();
  try {
    const { stdout, stderr } = await exec(ffmpeg, args, {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; killed?: boolean; message?: string };
    if (err.killed) throw new Error("ffmpeg timed out");
    const tail = (err.stderr ?? err.message ?? "").split("\n").slice(-6).join(" ").trim();
    throw new Error(`ffmpeg failed: ${tail.slice(0, 300)}`);
  }
}

export type ProbeResult = {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  sizeBytes: number;
  videoCodec: string | null;
  hasVideoStream: boolean;
  aspectRatio: string;
};

type FfprobeJson = {
  format?: { duration?: string; size?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    duration?: string;
  }[];
};

function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return 0;
  return num / den;
}

/** Reduce e.g. 1920x1080 to "16:9". */
export function aspectRatioLabel(width: number, height: number): string {
  if (!width || !height) return "";
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const known: [number, number, string][] = [
    [16, 9, "16:9"],
    [9, 16, "9:16"],
    [4, 3, "4:3"],
    [3, 4, "3:4"],
    [1, 1, "1:1"],
    [21, 9, "21:9"],
    [239, 100, "2.39:1"],
    [235, 100, "2.35:1"],
    [185, 100, "1.85:1"],
    [2, 1, "2:1"],
    [5, 4, "5:4"],
  ];
  const ratio = width / height;
  for (const [w, h, label] of known) {
    if (Math.abs(ratio - w / h) < 0.02) return label;
  }
  const d = gcd(width, height) || 1;
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

export async function probeVideo(file: string): Promise<ProbeResult> {
  const { ffprobe } = binaries();
  const { stdout } = await exec(
    ffprobe,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }
  );

  const json = JSON.parse(stdout) as FfprobeJson;
  const video = json.streams?.find((s) => s.codec_type === "video");
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  const fps = parseRate(video?.avg_frame_rate) || parseRate(video?.r_frame_rate) || 0;
  const durationSeconds = Number(json.format?.duration ?? video?.duration ?? 0) || 0;

  return {
    durationSeconds,
    width,
    height,
    fps,
    sizeBytes: Number(json.format?.size ?? 0) || 0,
    videoCodec: video?.codec_name ?? null,
    hasVideoStream: !!video,
    aspectRatio: aspectRatioLabel(width, height),
  };
}

export type SceneChange = { timeSeconds: number; score: number };

/**
 * Detect cut points with ffmpeg's scene score.
 *
 * Detection runs on a downscaled, frame-rate-limited copy: full-resolution
 * decode is the slow part and cut detection does not need the detail. Scores
 * come from `showinfo`/`metadata=print` on frames that pass the select filter.
 */
export async function detectSceneChanges(
  file: string,
  options: { threshold?: number; maxSeconds?: number } = {}
): Promise<SceneChange[]> {
  const threshold = options.threshold ?? 0.3;
  const args = [
    "-hide_banner",
    "-nostats",
    ...(options.maxSeconds ? ["-t", String(options.maxSeconds)] : []),
    "-i",
    file,
    "-filter:v",
    `scale=320:-2,fps=12,select='gt(scene,${threshold})',metadata=print:file=-`,
    "-an",
    "-f",
    "null",
    "-",
  ];

  const { stdout, stderr } = await runFfmpeg(args);
  const text = `${stdout}\n${stderr}`;

  const changes: SceneChange[] = [];
  const lines = text.split("\n");
  let pendingTime: number | null = null;

  for (const line of lines) {
    const frameMatch = line.match(/pts_time:([0-9.]+)/);
    if (frameMatch) {
      pendingTime = Number(frameMatch[1]);
      continue;
    }
    const scoreMatch = line.match(/lavfi\.scene_score=([0-9.]+)/);
    if (scoreMatch && pendingTime !== null) {
      changes.push({ timeSeconds: pendingTime, score: Number(scoreMatch[1]) });
      pendingTime = null;
    }
  }

  return changes.sort((a, b) => a.timeSeconds - b.timeSeconds);
}

/**
 * Extract one JPEG at an exact timestamp.
 * `-ss` before `-i` seeks by keyframe (fast); the extra `-ss` after refines it.
 */
export async function extractFrameAt(
  file: string,
  timeSeconds: number,
  outPath: string,
  options: { width?: number; quality?: number } = {}
): Promise<void> {
  const width = options.width ?? 1280;
  const quality = options.quality ?? 3;
  const coarse = Math.max(0, timeSeconds - 2);
  const fine = timeSeconds - coarse;

  await runFfmpeg([
    "-hide_banner",
    "-nostats",
    "-ss",
    coarse.toFixed(3),
    "-i",
    file,
    "-ss",
    fine.toFixed(3),
    "-frames:v",
    "1",
    "-vf",
    `scale='min(${width},iw)':-2`,
    "-q:v",
    String(quality),
    "-y",
    outPath,
  ]);
}

/**
 * ffmpeg's `thumbnail` filter picks the most representative frame from a batch
 * by histogram distance — the frame least like the batch average, which
 * reliably avoids transition smear and near-duplicate filler.
 */
export async function extractRepresentativeFrame(
  file: string,
  startSeconds: number,
  durationSeconds: number,
  outPath: string,
  options: { width?: number; sampleSize?: number } = {}
): Promise<void> {
  const width = options.width ?? 1280;
  const sample = options.sampleSize ?? 24;
  // Skip the first and last 10% of the shot: cuts and dissolves live there.
  const inset = Math.min(durationSeconds * 0.1, 0.5);
  const start = Math.max(0, startSeconds + inset);
  const span = Math.max(0.1, durationSeconds - inset * 2);

  await runFfmpeg([
    "-hide_banner",
    "-nostats",
    "-ss",
    start.toFixed(3),
    "-t",
    span.toFixed(3),
    "-i",
    file,
    "-vf",
    `thumbnail=${sample},scale='min(${width},iw)':-2`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-y",
    outPath,
  ]);
}

/**
 * Cut a segment out of a longer file.
 *
 * Re-encodes rather than stream-copying. A stream copy can only cut on
 * keyframes, so it silently moves the in-point by up to a GOP — a second or
 * more — and the user's chosen segment is not the segment that gets analysed.
 * Every timecode downstream (shot boundaries, the breakdown's cut notes, the
 * player) is relative to this output, so the cut has to land where they asked.
 *
 * `-ss` before `-i` seeks by index and is fast; `-accurate_seek` makes that
 * seek frame-exact rather than keyframe-aligned. Audio is kept because the
 * segment is played back in the app.
 */
export async function trimVideo(
  input: string,
  output: string,
  startSeconds: number,
  endSeconds: number
): Promise<void> {
  const start = Math.max(0, startSeconds);
  const duration = endSeconds - start;
  if (!(duration > 0)) {
    throw new Error(`trimVideo: end (${endSeconds}) must be after start (${startSeconds})`);
  }

  await runFfmpeg([
    "-hide_banner",
    "-nostats",
    "-accurate_seek",
    "-ss",
    start.toFixed(3),
    "-i",
    input,
    "-t",
    duration.toFixed(3),
    "-map",
    "0:v:0",
    // Audio is optional: a silent screen recording has no stream to map.
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    // Timestamps restart at zero so the segment is its own timeline.
    "-reset_timestamps",
    "1",
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "+faststart",
    "-y",
    output,
  ]);
}

export type FrameStats = { meanLuma: number; stdevLuma: number };

/** Mean/stdev luma via signalstats — used to reject black, blown or flat frames. */
export async function frameStats(file: string): Promise<FrameStats> {
  const { stderr } = await runFfmpeg([
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-vf",
    "signalstats,metadata=print:file=-",
    "-frames:v",
    "1",
    "-f",
    "null",
    "-",
  ]);
  const mean = stderr.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/);
  const low = stderr.match(/lavfi\.signalstats\.YLOW=([0-9.]+)/);
  const high = stderr.match(/lavfi\.signalstats\.YHIGH=([0-9.]+)/);
  const meanLuma = mean ? Number(mean[1]) : 128;
  const spread = low && high ? Number(high[1]) - Number(low[1]) : 128;
  return { meanLuma, stdevLuma: spread };
}
