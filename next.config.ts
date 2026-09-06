import type { NextConfig } from "next";
import { getSupabaseHostname } from "./lib/env";

const supabaseHost = getSupabaseHostname();

const nextConfig: NextConfig = {
  // The product is image-heavy: serve modern formats and cache derivatives for
  // a day so a busy library page is not re-encoding the same frames.
  poweredByHeader: false,
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
    "fluent-ffmpeg",
  ],
  images: {
    /*
     * Next 16's image optimizer refuses any upstream that resolves to a private
     * IP, which is the right default: it stops a user-supplied image URL being
     * used to probe the internal network. Locally, Supabase storage IS on a
     * private IP (127.0.0.1:54321), so every frame thumbnail fails to optimize
     * and the app looks broken while being perfectly correct.
     *
     * Allowed in development only. In production the bucket is on
     * *.supabase.co, a public host, and the guard stays on.
     */
    dangerouslyAllowLocalIP: process.env.NODE_ENV === "development",
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
    deviceSizes: [360, 480, 640, 828, 1080, 1280, 1600, 1920],
    imageSizes: [80, 110, 140, 160, 200, 300, 384],
    remotePatterns: [
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "*.tiktokcdn.com" },
      { protocol: "https", hostname: "*.tiktokcdn-us.com" },
      { protocol: "https", hostname: "*.tiktok.com" },
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      { protocol: "http", hostname: "127.0.0.1", port: "54321" },
      { protocol: "http", hostname: "localhost", port: "54321" },
      ...(supabaseHost ? [{ protocol: "https" as const, hostname: supabaseHost }] : []),
    ],
  },
};

export default nextConfig;
