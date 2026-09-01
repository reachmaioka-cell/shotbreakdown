/** URL helpers for clip posters, hover scrub, and embeds. Safe for client components. */

export function extractYoutubeId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/))([a-zA-Z0-9_-]{11})/
  );
  if (match?.[1]) return match[1];
  const fromThumb = url.match(/\/vi(?:_webp)?\/([a-zA-Z0-9_-]{11})\//);
  return fromThumb?.[1] ?? null;
}

export function extractTiktokVideoId(url: string): string | null {
  const match = url.match(/\/video\/(\d+)/);
  if (match?.[1]) return match[1];
  const fromPlayer = url.match(/tiktok\.com\/player\/v1\/(\d+)/);
  return fromPlayer?.[1] ?? null;
}

export function youtubeStartSeconds(url: string): number {
  try {
    const parsed = new URL(url);
    const raw =
      parsed.searchParams.get("t") ??
      parsed.searchParams.get("start") ??
      parsed.hash.match(/[?&]?t=([^&]+)/)?.[1] ??
      null;
    if (!raw) return 0;
    return parseYoutubeTime(raw);
  } catch {
    return 0;
  }
}

function parseYoutubeTime(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function isYoutubeThumbUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "img.youtube.com" || host === "i.ytimg.com" || host.endsWith(".ytimg.com");
  } catch {
    return false;
  }
}

/**
 * Custom upload artwork (maxres/hq/sd default) rather than a still from the
 * clip. Those posters are often title cards, not the analysed moment.
 */
export function isYoutubeBrandedPoster(url: string): boolean {
  if (!isYoutubeThumbUrl(url)) return false;
  return /\/(maxresdefault|hqdefault|sddefault|hq720)(_custom)?\.(jpg|jpeg|webp)/i.test(url);
}

/** Auto-generated stills from the video itself (never custom upload art). */
export function isYoutubeFrameStill(url: string): boolean {
  if (!isYoutubeThumbUrl(url)) return false;
  return /\/(sd[1-3]|hq[1-3]|mq[1-3]|mqdefault|[0-3])\.(jpg|jpeg|webp)/i.test(url);
}

/** Best single still from the clip — sd1 is an auto frame, not custom artwork. */
export function youtubeFramePoster(id: string): string {
  return `https://i.ytimg.com/vi/${id}/sd1.jpg`;
}

/**
 * Numbered stills at ~0 / 25 / 50 / 75% of the video. Used for hover-scrub.
 * 0.jpg is a real frame; hq1–3 are the higher-quality mid-clip stills.
 */
export function youtubeScrubFrameUrls(id: string): string[] {
  return [
    `https://i.ytimg.com/vi/${id}/0.jpg`,
    `https://i.ytimg.com/vi/${id}/hq1.jpg`,
    `https://i.ytimg.com/vi/${id}/hq2.jpg`,
    `https://i.ytimg.com/vi/${id}/hq3.jpg`,
  ];
}

/** Frame stills first. Branded artwork is last-resort only. */
export function youtubeFrameStillCandidates(id: string): string[] {
  const names = ["sd1", "hq1", "mq1", "1", "sd2", "hq2", "2", "sd3", "hq3", "3", "0", "mqdefault"];
  return names.map((name) => `https://i.ytimg.com/vi/${id}/${name}.jpg`);
}

function youtubeBrandedPosterFallbacks(id: string): string[] {
  return [
    `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi_webp/${id}/maxresdefault.webp`,
  ];
}

/** Probe order: clip frames, then last-resort branded posters. */
export function youtubeFramePosterFallbacks(id: string): string[] {
  return [...youtubeFrameStillCandidates(id), ...youtubeBrandedPosterFallbacks(id)];
}

/**
 * Prefer a stored extracted frame. If the stored URL is YouTube custom artwork,
 * swap in an auto-generated clip still.
 */
export function preferClipFrame(
  stored: string | null | undefined,
  sourceUrl?: string | null
): string | null {
  if (stored && !isYoutubeBrandedPoster(stored)) return stored;
  const id = extractYoutubeId(sourceUrl ?? "") ?? extractYoutubeId(stored ?? "");
  if (id) return youtubeFramePoster(id);
  return stored ?? null;
}

export function youtubeWatchUrl(id: string, startSeconds = 0): string {
  const base = `https://www.youtube.com/watch?v=${id}`;
  return startSeconds > 0 ? `${base}&t=${Math.floor(startSeconds)}s` : base;
}

export function clipSourceUrl(input: {
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
}): string | null {
  if (input.sourceUrl) return input.sourceUrl;
  const id = extractYoutubeId(input.thumbnailUrl ?? "");
  return id ? youtubeWatchUrl(id) : null;
}

export function clipPosterCandidates(input: {
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
}): string[] {
  const id = youtubeIdFromClip(input);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (url: string | null | undefined) => {
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  const stored = input.thumbnailUrl;
  if (stored && !isYoutubeBrandedPoster(stored)) push(stored);
  if (id) youtubeFrameStillCandidates(id).forEach(push);
  push(stored);
  if (id) youtubeBrandedPosterFallbacks(id).forEach(push);
  return out;
}

export type ClipEmbedOptions = {
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
  startSeconds?: number;
  endSeconds?: number;
  autoplay?: boolean;
  mute?: boolean;
  controls?: boolean;
  enableJsApi?: boolean;
  origin?: string;
  loop?: boolean;
};

export function clipEmbedUrl(input: ClipEmbedOptions): string | null {
  const source = input.sourceUrl ?? "";
  const ytId = extractYoutubeId(source) ?? extractYoutubeId(input.thumbnailUrl ?? "");
  if (ytId) {
    const start =
      input.startSeconds != null && input.startSeconds > 0
        ? Math.floor(input.startSeconds)
        : source
          ? youtubeStartSeconds(source)
          : 0;
    const autoplay = input.autoplay !== false;
    const mute = input.mute !== false;
    const controls = input.controls === true;
    const loop = input.loop !== false;
    const params = new URLSearchParams({
      autoplay: autoplay ? "1" : "0",
      mute: mute ? "1" : "0",
      controls: controls ? "1" : "0",
      modestbranding: "1",
      playsinline: "1",
      rel: "0",
      iv_load_policy: "3",
    });
    if (loop) {
      params.set("loop", "1");
      params.set("playlist", ytId);
    }
    if (start > 0) params.set("start", String(start));
    if (input.endSeconds != null && input.endSeconds > start) {
      params.set("end", String(Math.floor(input.endSeconds)));
    }
    if (input.enableJsApi) {
      params.set("enablejsapi", "1");
      if (input.origin) params.set("origin", input.origin);
    }
    return `https://www.youtube-nocookie.com/embed/${ytId}?${params.toString()}`;
  }

  const tiktokId = extractTiktokVideoId(source);
  if (tiktokId) {
    const autoplay = input.autoplay !== false ? "1" : "0";
    const mute = input.mute !== false ? "1" : "0";
    const controls = input.controls === true ? "1" : "0";
    return `https://www.tiktok.com/player/v1/${tiktokId}?autoplay=${autoplay}&muted=${mute}&controls=${controls}`;
  }

  return null;
}

export function youtubeSeekCommand(seconds: number): string {
  return JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] });
}

export function youtubePlayerCommand(func: string, args: unknown[] = []): string {
  return JSON.stringify({ event: "command", func, args });
}

function youtubeIdFromClip(input: { sourceUrl?: string | null; thumbnailUrl?: string | null }) {
  return extractYoutubeId(input.sourceUrl ?? "") ?? extractYoutubeId(input.thumbnailUrl ?? "");
}
