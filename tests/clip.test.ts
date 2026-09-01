import { describe, expect, it } from "vitest";
import {
  clipEmbedUrl,
  clipPosterCandidates,
  clipSourceUrl,
  extractYoutubeId,
  isYoutubeBrandedPoster,
  isYoutubeFrameStill,
  preferClipFrame,
  youtubeFramePoster,
  youtubeFramePosterFallbacks,
  youtubeFrameStillCandidates,
  youtubeScrubFrameUrls,
  youtubeSeekCommand,
} from "@/lib/clip";

const ID = "dQw4w9wgGcQ";

describe("YouTube clip frames vs branded posters", () => {
  it("extracts an id from watch, embed, and thumbnail URLs", () => {
    expect(extractYoutubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractYoutubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(extractYoutubeId(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`)).toBe(ID);
    expect(extractYoutubeId(`https://i.ytimg.com/vi_webp/${ID}/maxresdefault.webp`)).toBe(ID);
  });

  it("treats maxres/hq/sd default as branded artwork, not a clip frame", () => {
    expect(isYoutubeBrandedPoster(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`)).toBe(true);
    expect(isYoutubeBrandedPoster(`https://img.youtube.com/vi/${ID}/maxresdefault.jpg`)).toBe(true);
    expect(isYoutubeBrandedPoster(`https://i.ytimg.com/vi/${ID}/sd1.jpg`)).toBe(false);
    expect(isYoutubeBrandedPoster(`https://i.ytimg.com/vi/${ID}/0.jpg`)).toBe(false);
    expect(isYoutubeBrandedPoster(`https://i.ytimg.com/vi/${ID}/mqdefault.jpg`)).toBe(false);
  });

  it("recognises numbered stills as frames from the clip", () => {
    expect(isYoutubeFrameStill(`https://i.ytimg.com/vi/${ID}/sd1.jpg`)).toBe(true);
    expect(isYoutubeFrameStill(`https://i.ytimg.com/vi/${ID}/hq2.jpg`)).toBe(true);
    expect(isYoutubeFrameStill(`https://i.ytimg.com/vi/${ID}/3.jpg`)).toBe(true);
    expect(isYoutubeFrameStill(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`)).toBe(false);
  });

  it("lists frame stills before branded artwork in the probe order", () => {
    const order = youtubeFramePosterFallbacks(ID);
    const firstBranded = order.findIndex((u) => isYoutubeBrandedPoster(u));
    const firstFrame = order.findIndex((u) => isYoutubeFrameStill(u));
    expect(firstFrame).toBe(0);
    expect(firstBranded).toBeGreaterThan(firstFrame);
    expect(order[0]).toBe(youtubeFramePoster(ID));
  });

  it("swaps a stored hqdefault for a clip still", () => {
    const stored = `https://img.youtube.com/vi/${ID}/hqdefault.jpg`;
    expect(preferClipFrame(stored)).toBe(youtubeFramePoster(ID));
    expect(preferClipFrame(stored, `https://www.youtube.com/watch?v=${ID}`)).toBe(
      youtubeFramePoster(ID)
    );
  });

  it("keeps extracted-frame URLs and YouTube numbered stills", () => {
    const supabase = "http://127.0.0.1:54321/storage/v1/object/sign/uploads/frame.jpg?token=x";
    expect(preferClipFrame(supabase)).toBe(supabase);
    const still = `https://i.ytimg.com/vi/${ID}/sd1.jpg`;
    expect(preferClipFrame(still)).toBe(still);
  });

  it("puts stored frames first, then YouTube stills, branded last", () => {
    const stored = `https://img.youtube.com/vi/${ID}/hqdefault.jpg`;
    const candidates = clipPosterCandidates({
      sourceUrl: `https://www.youtube.com/watch?v=${ID}`,
      thumbnailUrl: stored,
    });
    expect(candidates[0]).toBe(youtubeFrameStillCandidates(ID)[0]);
    expect(candidates.indexOf(stored)).toBeGreaterThan(0);
    const brandedIndex = candidates.findIndex((u) => isYoutubeBrandedPoster(u));
    const frameIndex = candidates.findIndex((u) => isYoutubeFrameStill(u));
    expect(frameIndex).toBeLessThan(brandedIndex);
  });

  it("builds a muted autoplay embed and a controls embed", () => {
    const hover = clipEmbedUrl({
      sourceUrl: `https://www.youtube.com/watch?v=${ID}&t=12s`,
      enableJsApi: true,
      origin: "http://127.0.0.1:3002",
    });
    expect(hover).toContain("youtube.com/embed/");
    expect(hover).toContain("autoplay=1");
    expect(hover).toContain("mute=1");
    expect(hover).toContain("controls=0");
    expect(hover).toContain("start=12");
    expect(hover).toContain("enablejsapi=1");

    const page = clipEmbedUrl({
      sourceUrl: `https://www.youtube.com/watch?v=${ID}`,
      autoplay: true,
      mute: true,
      controls: true,
      loop: false,
    });
    expect(page).toContain("controls=1");
    expect(page).not.toContain("loop=1");

    const unmuted = clipEmbedUrl({
      sourceUrl: `https://www.youtube.com/watch?v=${ID}`,
      mute: false,
      controls: true,
      loop: false,
    });
    expect(unmuted).toContain("mute=0");
  });

  it("reconstructs a watch URL from a thumbnail", () => {
    expect(clipSourceUrl({ thumbnailUrl: `https://i.ytimg.com/vi/${ID}/sd1.jpg` })).toBe(
      `https://www.youtube.com/watch?v=${ID}`
    );
  });

  it("maps four scrub frames across the clip", () => {
    const frames = youtubeScrubFrameUrls(ID);
    expect(frames).toHaveLength(4);
    expect(frames[0]).toContain("/0.jpg");
    expect(frames.at(-1)).toContain("hq3.jpg");
  });

  it("encodes a seekTo postMessage payload", () => {
    expect(JSON.parse(youtubeSeekCommand(14.5))).toEqual({
      event: "command",
      func: "seekTo",
      args: [14.5, true],
    });
  });
});
