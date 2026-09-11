/**
 * Seed editorial music-video clips with real shot detection.
 *
 * Unlike `seed-library.ts` (one YouTube URL = one thumbnail shot at 0–0),
 * this downloads each MV, detects cuts, extracts an in-clip still, analyzes
 * that span, and stores start/end so playback is the shot — not the whole video.
 *
 *   npm run db:seed:music
 *   npm run db:seed:music -- --target=300
 *   npm run db:seed:music -- --dry-run
 *   npm run db:seed:music -- --max-videos=1 --target=18
 *
 * Everything written here is `private` and `review_status = 'pending'`. A row
 * with `visibility = 'public'` is readable by anyone straight from PostgREST
 * with the publishable anon key that ships in the browser bundle, so the corpus
 * can only be accumulated before launch by storing it private; an admin
 * approves rows at /admin/review and scripts/publish-editorial.ts makes the
 * approved ones public at launch. See docs/editorial-runbook.md.
 *
 * Does not write `submissions`, and deliberately writes no segment breakdown:
 * the editorial artefact is the per-shot recreation guide, generated on demand
 * at /api/shots/[id]/recreation-guide. A whole music video is not a segment,
 * and a breakdown of one would describe an edit nobody asked about.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { extractYoutubeId } from "@/lib/clip";
import { UPLOAD_BUCKET } from "@/lib/constants";
import { embed, shotEmbeddingText } from "@/lib/embeddings";
import { spreadFrames } from "@/lib/segment-breakdown";
import { analyzeShotFrames, SHOT_PROMPT_VERSION } from "@/lib/shot-analysis";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractFrameAt, extractRepresentativeFrame } from "@/lib/video/ffmpeg";
import { detectShots } from "@/lib/video/shots";

const exec = promisify(execFile);

const DRY_RUN = process.argv.includes("--dry-run");
const targetArg = process.argv.find((a) => a.startsWith("--target=") || a.startsWith("--limit="));
const TARGET = targetArg ? Number(targetArg.split("=")[1]) : 300;
const maxVideosArg = process.argv.find((a) => a.startsWith("--max-videos="));
const MAX_VIDEOS = maxVideosArg ? Number(maxVideosArg.split("=")[1]) : Infinity;
const catalogArg = process.argv.find((a) => a.startsWith("--catalog="));
const CATALOG_FILTER = (catalogArg?.split("=")[1] ?? "all") as "all" | "k-pop" | "lyrical-lemonade";
const extraUrl = process.argv.find((a) => a.startsWith("--url="))?.slice("--url=".length);

const YT_DLP =
  process.env.YT_DLP ??
  (existsSync("/opt/homebrew/bin/yt-dlp") ? "/opt/homebrew/bin/yt-dlp" : "yt-dlp");
const FFMPEG_DIR = existsSync("/opt/homebrew/bin/ffmpeg")
  ? "/opt/homebrew/bin"
  : dirname(process.env.FFMPEG ?? "ffmpeg");

const MUSIC_SHOT_DETECTION = {
  threshold: 0.3,
  minShotSeconds: 1.35,
  maxShotSeconds: 30,
  /*
   * Detect across the whole video. segmentShots stops at maxShots and returns
   * the FIRST that many, so the old cap of 18 handed the sampling below nothing
   * but the opening 75 seconds of a three-and-a-half-minute music video — the
   * very thing spreading the sample is meant to avoid. This is ffmpeg work, not
   * model work; what a run costs is set by SHOTS_PER_VIDEO and --target.
   */
  maxShots: 120,
};

/** How many of the detected shots are kept, analysed and stored per video. */
const SHOTS_PER_VIDEO = 18;

const MIN_DURATION_SEC = 30;
const MAX_DURATION_SEC = 15 * 60;
const PRINT_FMT = "%(id)s|||%(title)s|||%(channel)s|||%(duration)s|||%(webpage_url)s";

type Catalog = "k-pop" | "lyrical-lemonade";

type ClipSource = {
  catalog: Catalog;
  title: string;
  url?: string;
  query: string;
};

type YtMeta = {
  id: string;
  title: string;
  channel: string;
  duration: number;
  webpage_url: string;
};

const OFFICIAL_HINTS = [
  "hybe labels",
  "jyp entertainment",
  "smtown",
  "sm entertainment",
  "blackpink",
  "yg entertainment",
  "starshipent",
  "starship",
  "1thek",
  "bangtantv",
  "adore",
  "source music",
  "pledis",
  "belift",
  "theblacklabel",
  "blissoo",
  "lloud",
  "officialpsy",
  "lyrical lemonade",
  "cole bennett",
  "atlantic records",
  "interscope",
  "republic records",
  "columbia records",
  "geffen",
  "grade a",
  "universal music",
  "warner records",
  "cia records",
];

const KPOP: ClipSource[] = [
  { catalog: "k-pop", title: "NewJeans Super Shy", url: "https://www.youtube.com/watch?v=ArmDp-zijuc", query: "NewJeans Super Shy Official MV HYBE" },
  { catalog: "k-pop", title: "NewJeans OMG", url: "https://www.youtube.com/watch?v=sVTy_wmn5SU", query: "NewJeans OMG Official MV HYBE" },
  { catalog: "k-pop", title: "NewJeans Hype Boy", url: "https://www.youtube.com/watch?v=11cta61wi0g", query: "NewJeans Hype Boy Official MV HYBE" },
  { catalog: "k-pop", title: "NewJeans Ditto", url: "https://www.youtube.com/watch?v=pSUydWEqKwE", query: "NewJeans Ditto Official MV HYBE" },
  { catalog: "k-pop", title: "NewJeans Attention", url: "https://www.youtube.com/watch?v=js1CtxSY38I", query: "NewJeans Attention Official MV HYBE" },
  { catalog: "k-pop", title: "NewJeans How Sweet", url: "https://www.youtube.com/watch?v=Q3K0TOvTOno", query: "NewJeans How Sweet Official MV HYBE" },
  { catalog: "k-pop", title: "NewJeans Bubble Gum", url: "https://www.youtube.com/watch?v=ft70sAYrFyY", query: "NewJeans Bubble Gum Official MV HYBE" },
  { catalog: "k-pop", title: "NewJeans ETA", url: "https://www.youtube.com/watch?v=jOTfBlKSQnk", query: "NewJeans ETA Official MV HYBE" },
  { catalog: "k-pop", title: "LE SSERAFIM ANTIFRAGILE", url: "https://www.youtube.com/watch?v=pyf8cbqyfPs", query: "LE SSERAFIM ANTIFRAGILE Official MV" },
  { catalog: "k-pop", title: "LE SSERAFIM CRAZY", url: "https://www.youtube.com/watch?v=n6B5gQXlB-0", query: "LE SSERAFIM CRAZY Official MV HYBE" },
  { catalog: "k-pop", title: "LE SSERAFIM EASY", url: "https://www.youtube.com/watch?v=bNKXxwOQYB8", query: "LE SSERAFIM EASY Official MV HYBE" },
  { catalog: "k-pop", title: "LE SSERAFIM Perfect Night", url: "https://www.youtube.com/watch?v=hLvWy2b857I", query: "LE SSERAFIM Perfect Night Official MV" },
  { catalog: "k-pop", title: "LE SSERAFIM FEARLESS", url: "https://www.youtube.com/watch?v=4s8BWPH2M-8", query: "LE SSERAFIM FEARLESS Official MV" },
  { catalog: "k-pop", title: "IVE I AM", url: "https://www.youtube.com/watch?v=6ZUIwj3FgUY", query: "IVE I AM Official MV Starship" },
  { catalog: "k-pop", title: "IVE LOVE DIVE", url: "https://www.youtube.com/watch?v=Y8JFxS1HlDo", query: "IVE LOVE DIVE Official MV Starship" },
  { catalog: "k-pop", title: "IVE ELEVEN", url: "https://www.youtube.com/watch?v=0-q1KafFCLU", query: "IVE ELEVEN Official MV Starship" },
  { catalog: "k-pop", title: "IVE After LIKE", url: "https://www.youtube.com/watch?v=F0B7HDiY-10", query: "IVE After LIKE Official MV" },
  { catalog: "k-pop", title: "aespa Supernova", url: "https://www.youtube.com/watch?v=phuiiNCxRMg", query: "aespa Supernova Official MV SMTOWN" },
  { catalog: "k-pop", title: "aespa Drama", url: "https://www.youtube.com/watch?v=D8VEhcPeSlc", query: "aespa Drama Official MV SMTOWN" },
  { catalog: "k-pop", title: "aespa Spicy", url: "https://www.youtube.com/watch?v=Os_heh8vPfs", query: "aespa Spicy Official MV SMTOWN" },
  { catalog: "k-pop", title: "aespa Whiplash", url: "https://www.youtube.com/watch?v=jWQx2f-CErU", query: "aespa Whiplash Official MV SMTOWN" },
  { catalog: "k-pop", title: "aespa Next Level", query: "aespa Next Level Official MV SMTOWN" },
  { catalog: "k-pop", title: "BLACKPINK Pink Venom", url: "https://www.youtube.com/watch?v=gQlMMD8auMs", query: "BLACKPINK Pink Venom Official MV" },
  { catalog: "k-pop", title: "BLACKPINK Shut Down", url: "https://www.youtube.com/watch?v=POe9SOEKotk", query: "BLACKPINK Shut Down Official MV" },
  { catalog: "k-pop", title: "BLACKPINK How You Like That", url: "https://www.youtube.com/watch?v=ioNng23DkIM", query: "BLACKPINK How You Like That Official MV" },
  { catalog: "k-pop", title: "JENNIE SOLO", url: "https://www.youtube.com/watch?v=b73BI9eUkjM", query: "JENNIE SOLO Official MV" },
  { catalog: "k-pop", title: "JENNIE like JENNIE", query: "JENNIE like JENNIE Official MV" },
  { catalog: "k-pop", title: "ROSÉ APT.", url: "https://www.youtube.com/watch?v=ekr2nIex040", query: "ROSÉ Bruno Mars APT Official Music Video" },
  { catalog: "k-pop", title: "LISA ROCKSTAR", url: "https://www.youtube.com/watch?v=hbcGx4MGUMg", query: "LISA ROCKSTAR Official Music Video" },
  { catalog: "k-pop", title: "JISOO FLOWER", url: "https://www.youtube.com/watch?v=YudHcBIxlYw", query: "JISOO FLOWER Official MV" },
  { catalog: "k-pop", title: "Jungkook Seven", url: "https://www.youtube.com/watch?v=QU9c0053UAU", query: "Jungkook Seven Official MV" },
  { catalog: "k-pop", title: "Jungkook Standing Next to You", url: "https://www.youtube.com/watch?v=UNo0TG9LwwI", query: "Jungkook Standing Next to You Official MV" },
  { catalog: "k-pop", title: "Stray Kids S-Class", url: "https://www.youtube.com/watch?v=JsOOis4bBFg", query: "Stray Kids S-Class Official MV JYP" },
  { catalog: "k-pop", title: "(G)I-DLE Queencard", url: "https://www.youtube.com/watch?v=7HDeem-JaMU", query: "(G)I-DLE Queencard Official MV" },
  { catalog: "k-pop", title: "ILLIT Magnetic", url: "https://www.youtube.com/watch?v=Vk5-c_v4gMU", query: "ILLIT Magnetic Official MV HYBE" },
  { catalog: "k-pop", title: "BABYMONSTER SHEESH", query: "BABYMONSTER SHEESH Official MV YG" },
  { catalog: "k-pop", title: "TWICE Strategy", query: "TWICE Strategy Official MV JYP" },
  { catalog: "k-pop", title: "ENHYPEN Bite Me", query: "ENHYPEN Bite Me Official MV HYBE" },
  { catalog: "k-pop", title: "TXT Sugar Rush Ride", query: "TXT Sugar Rush Ride Official MV HYBE" },
  { catalog: "k-pop", title: "ATEEZ Crazy Form", query: "ATEEZ Crazy Form Official MV" },
  { catalog: "k-pop", title: "IU Love Wins All", query: "IU Love Wins All Official MV" },
  { catalog: "k-pop", title: "ITZY GOLD", query: "ITZY GOLD Official MV JYP" },
  { catalog: "k-pop", title: "NMIXX Dash", query: "NMIXX Dash Official MV JYP" },
  { catalog: "k-pop", title: "KISS OF LIFE Sticky", query: "KISS OF LIFE Sticky Official MV" },
  { catalog: "k-pop", title: "LE SSERAFIM HOT", query: "LE SSERAFIM HOT Official MV HYBE" },
  { catalog: "k-pop", title: "IVE REBEL HEART", query: "IVE REBEL HEART Official MV Starship" },
  { catalog: "k-pop", title: "BABYMONSTER DRIP", query: "BABYMONSTER DRIP Official MV YG" },
  { catalog: "k-pop", title: "Stray Kids Chk Chk Boom", query: "Stray Kids Chk Chk Boom Official MV JYP" },
];

const LYRICAL: ClipSource[] = [
  { catalog: "lyrical-lemonade", title: "Juice WRLD Lucid Dreams", url: "https://www.youtube.com/watch?v=mzB1VGEGcSU", query: "Juice WRLD Lucid Dreams Lyrical Lemonade" },
  { catalog: "lyrical-lemonade", title: "Juice WRLD Robbery", url: "https://www.youtube.com/watch?v=iI34LYmJ1Fs", query: "Juice WRLD Robbery Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "Juice WRLD Bandit", url: "https://www.youtube.com/watch?v=Sw5fNI400E4", query: "Juice WRLD YoungBoy Bandit Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "Juice WRLD Armed and Dangerous", query: "Juice WRLD Armed and Dangerous Lyrical Lemonade" },
  { catalog: "lyrical-lemonade", title: "Juice WRLD Come & Go", query: "Juice WRLD Marshmello Come & Go Lyrical Lemonade" },
  { catalog: "lyrical-lemonade", title: "Juice WRLD Wishing Well", query: "Juice WRLD Wishing Well Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "Lil Tecca Ransom", url: "https://www.youtube.com/watch?v=1XzY2ij_vL4", query: "Lil Tecca Ransom Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "Polo G Pop Out", query: "Polo G Lil Tjay Pop Out Official Music Video Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "NLE Choppa Shotta Flow", url: "https://www.youtube.com/watch?v=BUJ_hyOMIq8", query: "NLE Choppa Shotta Flow Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "Lil Mosey Blueberry Faygo", query: "Lil Mosey Blueberry Faygo Lyrical Lemonade" },
  { catalog: "lyrical-lemonade", title: "Lil Mosey Noticed", query: "Lil Mosey Noticed Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "Jack Harlow WHATS POPPIN", url: "https://www.youtube.com/watch?v=w9uWPBDHEKE", query: "Jack Harlow WHATS POPPIN Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "Ski Mask Nuketown", query: "Ski Mask Juice WRLD Nuketown Lyrical Lemonade" },
  { catalog: "lyrical-lemonade", title: "Lil Tjay F.N", query: "Lil Tjay F.N Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "King Von Crazy Story", query: "King Von Crazy Story Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "King Von Took Her To The O", query: "King Von Took Her To The O Lyrical Lemonade" },
  { catalog: "lyrical-lemonade", title: "21 Savage Glock In My Lap", query: "21 Savage Glock In My Lap Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "Nardo Wick Who Want Smoke", query: "Nardo Wick Who Want Smoke Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "Juice WRLD Hear Me Calling", query: "Juice WRLD Hear Me Calling Lyrical Lemonade Cole Bennett" },
  { catalog: "lyrical-lemonade", title: "Polo G Finer Things", query: "Polo G Finer Things Lyrical Lemonade Cole Bennett" },
];

function mixCatalog(kpop: ClipSource[], ll: ClipSource[]): ClipSource[] {
  const out: ClipSource[] = [];
  let i = 0;
  let j = 0;
  while (i < kpop.length || j < ll.length) {
    if (i < kpop.length) out.push(kpop[i++]);
    if (i < kpop.length) out.push(kpop[i++]);
    if (j < ll.length) out.push(ll[j++]);
  }
  return out;
}

function catalogList(): ClipSource[] {
  const extra: ClipSource[] = extraUrl
    ? [{ catalog: "k-pop", title: extraUrl, url: extraUrl, query: extraUrl }]
    : [];
  if (CATALOG_FILTER === "k-pop") return [...extra, ...KPOP];
  if (CATALOG_FILTER === "lyrical-lemonade") return [...extra, ...LYRICAL];
  return [...extra, ...mixCatalog(KPOP, LYRICAL)];
}

function log(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(ts, ...args);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(title: string, id: string) {
  const shortId = id.replace(/-/g, "").slice(0, 8);
  let base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base || base.length < 3) base = "shot";
  return `${base.slice(0, 48)}-${shortId}`;
}

function parsePrintLine(line: string): YtMeta | null {
  const parts = line.split("|||");
  if (parts.length < 5) return null;
  const [id, title, channel, duration, webpage_url] = parts;
  if (!id || id.length < 8) return null;
  return {
    id,
    title: title || id,
    channel: channel || "",
    duration: Number(duration) || 0,
    webpage_url: webpage_url || `https://www.youtube.com/watch?v=${id}`,
  };
}

function isJunkTitle(title: string) {
  return /lyric|karaoke|dance practice|8d audio|slowed|nightcore|fan.?cam|reaction|cover|instrumental/i.test(
    title
  );
}

function isLikelyOfficial(meta: YtMeta, catalog: Catalog) {
  if (isJunkTitle(meta.title)) return false;
  const ch = meta.channel.toLowerCase();
  if (OFFICIAL_HINTS.some((h) => ch.includes(h))) return true;
  if (catalog === "lyrical-lemonade" && /lyrical|cole bennett/i.test(ch)) return true;
  if (catalog === "k-pop" && /official|m\/v|\bmv\b/i.test(meta.title)) return true;
  return false;
}

async function ytDlp(args: string[], timeoutMs = 120_000): Promise<string> {
  try {
    const { stdout, stderr } = await exec(YT_DLP, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return `${stdout}\n${stderr}`;
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string; killed?: boolean };
    if (err.killed) throw new Error("yt-dlp timed out");
    const tail = (err.stderr || err.message || "").split("\n").filter(Boolean).slice(-8).join(" | ");
    throw new Error(tail.slice(0, 400) || "yt-dlp failed");
  }
}

async function probeUrl(url: string): Promise<YtMeta | null> {
  try {
    const out = await ytDlp(
      ["--skip-download", "--no-playlist", "--no-warnings", "--print", PRINT_FMT, url],
      90_000
    );
    const line = out
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.includes("|||"));
    return line ? parsePrintLine(line) : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("  probe failed", url, msg.slice(0, 180));
    return null;
  }
}

async function searchOfficial(source: ClipSource): Promise<YtMeta | null> {
  try {
    const out = await ytDlp(
      [
        "--skip-download",
        "--no-warnings",
        "--playlist-end",
        "5",
        "--print",
        PRINT_FMT,
        `ytsearch5:${source.query}`,
      ],
      120_000
    );
    const rows = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map(parsePrintLine)
      .filter((m): m is YtMeta => !!m && !isJunkTitle(m.title));
    return rows.find((m) => isLikelyOfficial(m, source.catalog)) ?? rows[0] ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("  search failed", source.query, msg.slice(0, 180));
    return null;
  }
}

async function resolveSource(source: ClipSource): Promise<YtMeta | null> {
  if (source.url) {
    const probed = await probeUrl(source.url);
    if (probed && probed.duration >= MIN_DURATION_SEC && probed.duration <= MAX_DURATION_SEC) {
      return probed;
    }
    if (probed && (probed.duration < MIN_DURATION_SEC || probed.duration > MAX_DURATION_SEC)) {
      log("  skip duration", source.title, `${Math.round(probed.duration)}s`);
    }
  }
  const found = await searchOfficial(source);
  if (!found) return null;
  if (found.duration < MIN_DURATION_SEC || found.duration > MAX_DURATION_SEC) {
    log("  skip duration", found.title, `${Math.round(found.duration)}s`);
    return null;
  }
  return found;
}

async function downloadVideo(url: string, dir: string): Promise<string> {
  const outTpl = join(dir, "source.%(ext)s");
  const attempts: string[][] = [
    [
      "--extractor-args",
      "youtube:player_client=mweb,tv_embedded",
      "-f",
      "18/22/95/96/b[height<=720]/best",
    ],
    [
      "--extractor-args",
      "youtube:player_client=mweb",
      "-f",
      "18/best",
    ],
    [
      "--cookies-from-browser",
      "chrome",
      "--extractor-args",
      "youtube:player_client=web,mweb",
      "-f",
      "18/b[height<=720]/best",
    ],
  ];

  let lastError: Error | null = null;
  for (const extra of attempts) {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "--ffmpeg-location",
      FFMPEG_DIR,
      "--merge-output-format",
      "mp4",
      "-o",
      outTpl,
      ...extra,
      url,
    ];
    try {
      await ytDlp(args, 600_000);
      lastError = null;
      break;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      log("  download attempt failed:", lastError.message.slice(0, 220));
    }
  }
  if (lastError) throw lastError;

  const { readdir } = await import("node:fs/promises");
  const files = await readdir(dir);
  const video = files.find((f) => /\.(mp4|mkv|webm|mov|m4v)$/i.test(f));
  if (!video) throw new Error("yt-dlp produced no video file");
  return join(dir, video);
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /429|rate|overloaded|529|timeout|ECONNRESET|503|502|529/i.test(msg);
      if (!retryable || attempt === 3) throw e;
      const wait = 2000 * 2 ** attempt;
      log(`  retry ${label} in ${wait}ms: ${msg.slice(0, 160)}`);
      await sleep(wait);
    }
  }
  throw last;
}

async function extractStill(
  file: string,
  startSeconds: number,
  endSeconds: number,
  outPath: string
): Promise<void> {
  const duration = Math.max(0.1, endSeconds - startSeconds);
  try {
    await extractRepresentativeFrame(file, startSeconds, duration, outPath, { width: 1280 });
  } catch {
    const mid = startSeconds + duration / 2;
    await extractFrameAt(file, mid, outPath, { width: 1280 });
  }
}

async function existingYoutubeIds(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin.from("videos").select("source_url").not("source_url", "is", null);
  if (error) throw new Error(error.message);
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const id = extractYoutubeId(row.source_url as string);
    if (id) ids.add(id);
  }
  return ids;
}

/*
 * How much corpus there already is. Counted across every visibility on
 * purpose: what this seeder writes is private until launch, so counting the
 * public rows would report an empty library on every run and keep re-seeding
 * material already in hand.
 */
async function countMusicShots(admin: ReturnType<typeof createAdminClient>) {
  const { count, error } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .contains("tags", ["music-video"])
    .eq("status", "complete")
    .eq("is_editorial", true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function mergeTags(recordTags: string[] | undefined, catalog: Catalog): string[] {
  const extra = catalog === "k-pop" ? ["music-video", "k-pop"] : ["music-video", "lyrical-lemonade"];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...extra, ...(recordTags ?? [])]) {
    const t = tag.toLowerCase().trim().replace(/\s+/g, "-");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

async function seedVideo(
  admin: ReturnType<typeof createAdminClient>,
  source: ClipSource,
  meta: YtMeta,
  remaining: number
): Promise<{ inserted: number; kpop: number; ll: number; failed: number }> {
  const stats = { inserted: 0, kpop: 0, ll: 0, failed: 0 };
  if (remaining <= 0) return stats;

  const dir = await mkdtemp(join(tmpdir(), "sb-music-"));
  try {
    log(`download ${source.title} (${meta.id}, ${Math.round(meta.duration)}s)`);
    const file = await downloadVideo(meta.webpage_url, dir);
    log("  detecting shots");
    const detection = await detectShots(file, MUSIC_SHOT_DETECTION);
    /*
     * Spread across the whole runtime rather than taking the opening shots.
     * `slice(0, n)` built a corpus of intros and title cards — the one part of
     * a music video that is least like the rest of it. spreadFrames keeps the
     * first and last cut and walks evenly between them, so the sample covers
     * the piece.
     */
    const wanted = spreadFrames(detection.shots, Math.min(SHOTS_PER_VIDEO, remaining));
    log(`  ${detection.shots.length} shots detected, taking ${wanted.length} spread across the runtime`);

    if (wanted.length === 0) return stats;
    if (DRY_RUN) {
      for (const shot of wanted) {
        log(
          `  dry ${shot.index} ${shot.startSeconds.toFixed(2)}–${shot.endSeconds.toFixed(2)} (${shot.durationSeconds.toFixed(2)}s)`
        );
      }
      stats.inserted = wanted.length;
      if (source.catalog === "k-pop") stats.kpop = wanted.length;
      else stats.ll = wanted.length;
      return stats;
    }

    const spanStart = wanted[0].startSeconds;
    const spanEnd = wanted[wanted.length - 1].endSeconds;

    const { data: video, error: videoError } = await admin
      .from("videos")
      .insert({
        source_type: "youtube",
        source_url: meta.webpage_url,
        title: meta.title,
        status: "analyzing",
        // Private until scripts/publish-editorial.ts runs at launch. RLS makes
        // a private row with no owner unreadable to every anon and
        // authenticated caller, which is the only thing that actually keeps the
        // corpus off PostgREST.
        visibility: "private",
        is_editorial: true,
        // A sample, not the whole cut, so the span covered runs from the first
        // kept shot's in point to the last one's out point. The pipeline uses
        // duration_seconds for the analyzed span, segment_start/segment_end for
        // where that span sits in the source, and source_duration_seconds for
        // the whole thing; a seeded row that filled the first with the runtime
        // drew a three-minute ruler under twenty seconds of shots.
        duration_seconds: spanEnd - spanStart,
        segment_start: spanStart,
        segment_end: spanEnd,
        source_duration_seconds: detection.probe.durationSeconds,
        width: detection.probe.width,
        height: detection.probe.height,
        fps: detection.probe.fps,
        aspect_ratio: detection.probe.aspectRatio,
        shot_count: wanted.length,
        analyzed_shot_count: 0,
      })
      .select("id")
      .single();
    if (videoError || !video) {
      log("  video insert failed", videoError?.message);
      stats.failed += 1;
      return stats;
    }

    let posterPath: string | null = null;
    // A shot that fails analysis leaves no row, so the span the stored shots
    // actually cover runs between the first and last that made it in.
    let insertedStart = Number.POSITIVE_INFINITY;
    let insertedEnd = 0;

    for (const shot of wanted) {
      const stillPath = join(dir, `shot-${shot.index}.jpg`);
      try {
        await extractStill(file, shot.startSeconds, shot.endSeconds, stillPath);
        const buffer = await readFile(stillPath);
        if (buffer.byteLength < 4000) throw new Error("still too small");

        const storagePath = `editorial/${video.id}/${shot.index}.jpg`;
        const { error: upErr } = await admin.storage.from(UPLOAD_BUCKET).upload(storagePath, buffer, {
          contentType: "image/jpeg",
          upsert: true,
        });
        if (upErr) throw new Error(`storage: ${upErr.message}`);

        const record = await withRetry(
          () =>
            analyzeShotFrames({
              images: [{ buffer, contentType: "image/jpeg" }],
              videoTitle: meta.title,
              shotIndex: shot.index,
              shotCount: wanted.length,
              startSeconds: shot.startSeconds,
              endSeconds: shot.endSeconds,
            }),
          `analyze ${shot.index}`
        );
        const vector = await withRetry(
          () =>
            embed(
              shotEmbeddingText(record, {
                title: record.one_line_summary || meta.title,
                sourceType: "youtube",
                videoTitle: meta.title,
              })
            ),
          `embed ${shot.index}`
        );

        const tags = mergeTags(record.tags, source.catalog);
        const { data: inserted, error: shotError } = await admin
          .from("shots")
          .insert({
            video_id: video.id,
            shot_index: shot.index,
            start_seconds: shot.startSeconds,
            end_seconds: shot.endSeconds,
            title: record.one_line_summary || `${meta.title} — shot ${shot.index + 1}`,
            thumbnail_path: storagePath,
            poster_path: storagePath,
            representative_timestamp: shot.startSeconds + shot.durationSeconds / 2,
            metadata: record,
            embedding: vector,
            prompt_version: SHOT_PROMPT_VERSION,
            status: "complete",
            // Same reason as the video row: private is what hides it, and
            // review_status is the axis an admin moves without exposing it.
            visibility: "private",
            review_status: "pending",
            is_editorial: true,
            tags,
            aspect_ratio: detection.probe.aspectRatio,
            width: detection.probe.width,
            height: detection.probe.height,
            // The still this row was analyzed from cannot show a ramp, a freeze
            // or a hold; the per-shot series detectShots already measured can,
            // and the breakdown prompt reads it. Without it a seeded shot gets
            // a worse description than an uploaded one.
            motion_profile: shot.motion,
          })
          .select("id")
          .single();
        if (shotError || !inserted) throw new Error(shotError?.message ?? "shot insert failed");

        /*
         * The still this row was analyzed from, recorded as a frame the way an
         * upload's frames are. Without it the shot page's frame strip is empty
         * and representative_frame_id is null, so a seeded shot reads as a
         * lesser thing than an uploaded one on the same page. One frame, not a
         * candidate set: there is only ever one still per seeded shot.
         */
        const { data: frame, error: frameError } = await admin
          .from("shot_frames")
          .insert({
            shot_id: inserted.id,
            video_id: video.id,
            user_id: null,
            timestamp_seconds: shot.startSeconds + shot.durationSeconds / 2,
            storage_path: storagePath,
            thumb_path: storagePath,
            width: detection.probe.width,
            height: detection.probe.height,
            is_representative: true,
          })
          .select("id")
          .single();
        if (frameError || !frame) throw new Error(frameError?.message ?? "frame insert failed");

        const slug = slugify(record.one_line_summary || meta.title, inserted.id as string);
        await admin
          .from("shots")
          .update({ slug, representative_frame_id: frame.id })
          .eq("id", inserted.id);

        if (!posterPath) posterPath = storagePath;
        insertedStart = Math.min(insertedStart, shot.startSeconds);
        insertedEnd = Math.max(insertedEnd, shot.endSeconds);
        stats.inserted += 1;
        if (source.catalog === "k-pop") stats.kpop += 1;
        else stats.ll += 1;
        log(
          `  ✓ [${stats.inserted}] shot ${shot.index} ${shot.startSeconds.toFixed(1)}–${shot.endSeconds.toFixed(1)}s — ${record.composition.shot_size}`
        );
      } catch (e) {
        stats.failed += 1;
        log(
          `  ✗ shot ${shot.index} ${e instanceof Error ? e.message.slice(0, 200) : e}`
        );
      }
    }

    if (stats.inserted === 0) {
      await admin.from("videos").delete().eq("id", video.id);
      log("  removed empty video");
      return stats;
    }

    await admin
      .from("videos")
      .update({
        status: "complete",
        stage_detail: "Done",
        progress: 100,
        shot_count: stats.inserted,
        analyzed_shot_count: stats.inserted,
        duration_seconds: insertedEnd - insertedStart,
        segment_start: insertedStart,
        segment_end: insertedEnd,
        poster_path: posterPath,
        completed_at: new Date().toISOString(),
      })
      .eq("id", video.id);

    return stats;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!existsSync(YT_DLP) && YT_DLP.startsWith("/")) throw new Error(`yt-dlp not found at ${YT_DLP}`);

  log("music clip seed against", process.env.NEXT_PUBLIC_SUPABASE_URL);
  log("yt-dlp", YT_DLP, "target", TARGET, DRY_RUN ? "DRY-RUN" : "insert");

  const admin = createAdminClient();
  const seen = await existingYoutubeIds(admin);
  const already = DRY_RUN ? 0 : await countMusicShots(admin);
  log(`${seen.size} YouTube ids already in videos; ${already} music-video shots already in library`);
  log(`this run will insert up to ${TARGET} new detected shots`);

  const sources = catalogList();
  let inserted = 0;
  let kpop = 0;
  let ll = 0;
  let failedShots = 0;
  let skipped = 0;
  let videos = 0;
  const failedUrls: string[] = [];

  for (const source of sources) {
    if (videos >= MAX_VIDEOS) break;
    if (inserted >= TARGET) break;

    log(`resolve ${source.title}`);
    const meta = await resolveSource(source);
    if (!meta) {
      skipped += 1;
      failedUrls.push(source.url ?? source.query);
      continue;
    }
    if (seen.has(meta.id)) {
      log("  skip duplicate", meta.id, meta.title);
      skipped += 1;
      continue;
    }

    try {
      const remaining = TARGET - inserted;
      const result = await seedVideo(admin, source, meta, remaining);
      inserted += result.inserted;
      kpop += result.kpop;
      ll += result.ll;
      failedShots += result.failed;
      if (result.inserted > 0 || DRY_RUN) {
        seen.add(meta.id);
        videos += 1;
      } else {
        skipped += 1;
        failedUrls.push(meta.webpage_url);
      }
      log(
        `  video done +${result.inserted} shots (running ${inserted}/${TARGET} this run, k-pop ${kpop}, ll ${ll})`
      );
    } catch (e) {
      skipped += 1;
      failedUrls.push(meta.webpage_url);
      log("  video failed", meta.title, e instanceof Error ? e.message.slice(0, 220) : e);
    }
  }

  const total = already + inserted;
  log(
    `\nmusic seed ${DRY_RUN ? "dry-run" : "complete"}: +${inserted} shots this run (${kpop} k-pop, ${ll} lyrical-lemonade), ${failedShots} shot failures, ${skipped} videos skipped, library music-video total ~${total}`
  );
  if (failedUrls.length > 0) {
    log("failed/skipped sources:");
    failedUrls.slice(0, 40).forEach((u) => log("  ", u));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
