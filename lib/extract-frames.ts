import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

function getDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const seconds = data.format.duration ?? 0;
      resolve(seconds);
    });
  });
}

function screenshot(file: string, folder: string, filename: string, timestamp: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(file)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .screenshots({
        folder,
        filename,
        timestamps: [timestamp],
        size: "1280x?",
      });
  });
}

/**
 * Extract 3 stills at 10% / 50% / 90% of duration.
 * On Vercel, skip ffmpeg — the binary blows the function size limit.
 * Upload a frame instead, or run this on a worker later.
 */
export async function extractVideoFrames(videoUrl: string): Promise<Buffer[]> {
  if (process.env.VERCEL) {
    throw new Error("Clip uploads need a frame on this host. Export a still and drop that instead.");
  }

  const dir = await mkdtemp(join(tmpdir(), "sb-frames-"));
  const inputPath = join(dir, "input");
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    await writeFile(inputPath, Buffer.from(await res.arrayBuffer()));

    const duration = await getDuration(inputPath);
    const stamps = [0.1, 0.5, 0.9].map((p) => {
      const t = duration > 0 ? duration * p : p;
      return Math.max(0.05, t);
    });

    const frames: Buffer[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const filename = `frame-${i}.jpg`;
      await screenshot(inputPath, dir, filename, stamps[i]);
      frames.push(await readFile(join(dir, filename)));
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
