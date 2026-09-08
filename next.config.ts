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
  /*
   * Hardening headers. None of these were set, and two of them matter for this
   * product specifically.
   *
   * Referrer-Policy protects share tokens: a share link IS the secret, it sits
   * in the path at /s/<token>, and any sub-resource or link that leaves the page
   * would otherwise carry it to a third party in the Referer header.
   *
   * X-Frame-Options stops the app being framed. It holds destructive one-click
   * actions — delete a segment, delete an account, flip a share to public — and
   * nothing here is meant to be embedded in someone else's page.
   *
   * HSTS is production-only on purpose: sending it from a local http server
   * pins the browser to https for localhost and breaks every other local
   * project on the same host.
   */
  async headers() {
    const base = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
      },
    ];
    if (process.env.NODE_ENV === "production") {
      base.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }
    return [{ source: "/:path*", headers: base }];
  },
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
