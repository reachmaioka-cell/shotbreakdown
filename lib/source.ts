import { extractYoutubeId, youtubeFramePosterFallbacks, youtubeStartSeconds } from "@/lib/clip";
import { safeFetch, safeFetchBuffer } from "@/lib/safe-url";

export { extractYoutubeId };

export async function youtubeThumbnailAndTitle(
  url: string
): Promise<{ thumbnail: string | null; title: string | null }> {
  const id = extractYoutubeId(url);
  let title: string | null = null;
  try {
    const oembed = await safeFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    if (oembed.ok) {
      const data = (await oembed.json()) as { title?: string };
      title = data.title ?? null;
    }
  } catch {
    title = null;
  }

  if (!id) return { thumbnail: null, title };

  for (const candidate of youtubeFramePosterFallbacks(id)) {
    if (await usableYoutubeThumb(candidate)) return { thumbnail: candidate, title };
  }
  return { thumbnail: null, title };
}

/** Multiple auto-generated stills from a YouTube video for movement inference. */
export async function youtubeMultiFrameUrls(url: string): Promise<string[]> {
  const id = extractYoutubeId(url);
  if (!id) return [];

  const start = youtubeStartSeconds(url);
  const candidates = [
    ...youtubeFramePosterFallbacks(id),
    // Storyboard-style frames when a timestamp is linked (approximate offsets).
    ...(start > 0
      ? [`https://i.ytimg.com/vi/${id}/sd1.jpg`, `https://i.ytimg.com/vi/${id}/hq1.jpg`]
      : []),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    if (await usableYoutubeThumb(url)) out.push(url);
    if (out.length >= 3) break;
  }
  return out;
}

export async function usableYoutubeThumb(url: string): Promise<boolean> {
  try {
    const { buffer: buf } = await safeFetchBuffer(url, { maxBytes: 5 * 1024 * 1024 });
    // YouTube serves ~1KB JPEG placeholders for missing storyboard frames (sometimes with HTTP 404).
    return buf.byteLength >= 4000;
  } catch {
    return false;
  }
}

export async function tiktokOembed(
  url: string
): Promise<{ thumbnail: string | null; title: string | null }> {
  try {
    const res = await safeFetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return { thumbnail: null, title: null };
    const data = (await res.json()) as { thumbnail_url?: string; title?: string };
    return { thumbnail: data.thumbnail_url ?? null, title: data.title ?? null };
  } catch {
    return { thumbnail: null, title: null };
  }
}

export async function instagramOembed(
  url: string
): Promise<{ thumbnail: string | null; title: string | null }> {
  try {
    const res = await safeFetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return { thumbnail: null, title: null };
    const data = (await res.json()) as { thumbnail_url?: string; title?: string; author_name?: string };
    return {
      thumbnail: data.thumbnail_url ?? null,
      title: data.title ?? data.author_name ?? null,
    };
  } catch {
    return { thumbnail: null, title: null };
  }
}

const SOURCE_HOSTS: { source: "youtube" | "tiktok" | "instagram"; suffixes: string[] }[] = [
  { source: "youtube", suffixes: ["youtube.com", "youtu.be", "m.youtube.com", "youtube-nocookie.com"] },
  { source: "tiktok", suffixes: ["tiktok.com", "vm.tiktok.com"] },
  { source: "instagram", suffixes: ["instagram.com", "instagr.am"] },
];

/**
 * Match on the parsed hostname, not a substring of the whole URL:
 * "https://evil.example/?ref=youtube.com" must not be accepted as YouTube.
 */
export function detectLinkSource(url: string): "youtube" | "tiktok" | "instagram" | null {
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    hostname = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return null;
  }
  for (const entry of SOURCE_HOSTS) {
    if (entry.suffixes.some((s) => hostname === s || hostname.endsWith(`.${s}`))) {
      return entry.source;
    }
  }
  return null;
}
