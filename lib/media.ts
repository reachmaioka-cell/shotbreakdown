import { SIGNED_URL_TTL_SEC, UPLOAD_BUCKET } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";

export function isHttpUrl(value: string | null | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

export async function resolveMediaUrl(pathOrUrl: string | null | undefined): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttpUrl(pathOrUrl)) return pathOrUrl;
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(pathOrUrl, SIGNED_URL_TTL_SEC);
  if (error) return null;
  return data.signedUrl;
}

export async function resolveMediaUrls(paths: string[] | null | undefined): Promise<string[]> {
  if (!paths?.length) return [];
  const resolved = await Promise.all(paths.map((p) => resolveMediaUrl(p)));
  return resolved.filter((u): u is string => !!u);
}

/** True when the URL points at our own Supabase instance (a signed URL we minted). */
export function isOwnStorageUrl(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * Fetch an image for AI analysis.
 *
 * Signed URLs we generated ourselves are fetched directly (they can point at a
 * loopback address in local dev). Everything else — thumbnails handed to us by
 * third-party oembed providers — goes through the SSRF-guarded path.
 */
export async function fetchAnalysisImage(
  url: string
): Promise<{ buffer: Buffer; contentType: string }> {
  if (isOwnStorageUrl(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`image fetch ${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
  }
  const { safeFetchBuffer } = await import("@/lib/safe-url");
  return safeFetchBuffer(url, {
    maxBytes: 20 * 1024 * 1024,
    headers: {
      "User-Agent": "ShotBreakdown/1.0 (+https://shotbreakdown.app)",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
}
