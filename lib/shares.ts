import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type ShareResource = "shot" | "collection" | "video";

export type Share = {
  id: string;
  token: string;
  resourceType: ShareResource;
  resourceId: string;
  userId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** URL-safe, unguessable, and short enough to paste into a message. */
export function newShareToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Create or return the share for a resource the caller owns. Sharing a private
 * resource promotes it to `unlisted` — reachable with the link, still absent
 * from the public library and from search.
 */
export async function createShare(
  resourceType: ShareResource,
  resourceId: string,
  userId: string
): Promise<Share | null> {
  const admin = createAdminClient();
  const table = resourceType === "collection" ? "collections" : resourceType === "video" ? "videos" : "shots";

  const { data: resource } = await admin
    .from(table)
    .select("id, user_id, visibility")
    .eq("id", resourceId)
    .maybeSingle();
  if (!resource || resource.user_id !== userId) return null;

  if (resource.visibility === "private") {
    await admin.from(table).update({ visibility: "unlisted" }).eq("id", resourceId);
    if (resourceType === "video") {
      await admin
        .from("shots")
        .update({ visibility: "unlisted" })
        .eq("video_id", resourceId)
        .eq("visibility", "private");
    }
  }

  const { data: existing } = await admin
    .from("shares")
    .select("*")
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing && !existing.revoked_at) return toShare(existing);

  const token = newShareToken();
  const { data, error } = await admin
    .from("shares")
    .upsert(
      {
        token,
        resource_type: resourceType,
        resource_id: resourceId,
        user_id: userId,
        revoked_at: null,
      },
      { onConflict: "resource_type,resource_id,user_id" }
    )
    .select("*")
    .single();

  if (error || !data) return null;
  return toShare(data);
}

export async function revokeShare(
  resourceType: ShareResource,
  resourceId: string,
  userId: string
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .eq("user_id", userId);
  if (error) return false;

  // Revoking a link must actually close the door: an unlisted resource goes
  // back to private. Deliberately published (public) resources stay public.
  const table = resourceType === "collection" ? "collections" : resourceType === "video" ? "videos" : "shots";
  await admin
    .from(table)
    .update({ visibility: "private" })
    .eq("id", resourceId)
    .eq("user_id", userId)
    .eq("visibility", "unlisted");

  if (resourceType === "video") {
    await admin
      .from("shots")
      .update({ visibility: "private" })
      .eq("video_id", resourceId)
      .eq("visibility", "unlisted");
  }

  return true;
}

export async function resolveShare(token: string): Promise<Share | null> {
  if (!token || token.length > 64) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("shares")
    .select("*")
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();

  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at as string).getTime() < Date.now()) return null;

  await admin
    .from("shares")
    .update({ view_count: ((data.view_count as number) ?? 0) + 1 })
    .eq("id", data.id);

  return toShare(data);
}

export async function getShare(
  resourceType: ShareResource,
  resourceId: string,
  userId: string
): Promise<Share | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shares")
    .select("*")
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  return data ? toShare(data) : null;
}

function toShare(row: Record<string, unknown>): Share {
  return {
    id: row.id as string,
    token: row.token as string,
    resourceType: row.resource_type as ShareResource,
    resourceId: row.resource_id as string,
    userId: row.user_id as string,
    expiresAt: (row.expires_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/s/${token}`;
}
