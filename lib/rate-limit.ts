import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/errors";

export type RateLimitRule = { limit: number; windowSeconds: number };

/**
 * Every endpoint that costs money or writes user data has a budget. Keyed by
 * user id when authenticated, by hashed IP otherwise.
 */
export const RATE_LIMITS = {
  video_submit: { limit: 10, windowSeconds: 60 * 60 },
  video_retry: { limit: 6, windowSeconds: 60 * 60 },
  search: { limit: 60, windowSeconds: 60 },
  search_anon: { limit: 20, windowSeconds: 60 },
  similar: { limit: 60, windowSeconds: 60 },
  ask: { limit: 40, windowSeconds: 24 * 60 * 60 },
  feedback: { limit: 60, windowSeconds: 60 * 60 },
  edit: { limit: 120, windowSeconds: 60 * 60 },
  save: { limit: 300, windowSeconds: 60 * 60 },
  collection_write: { limit: 200, windowSeconds: 60 * 60 },
  export: { limit: 20, windowSeconds: 60 * 60 },
  share: { limit: 40, windowSeconds: 60 * 60 },
  view: { limit: 120, windowSeconds: 60 * 60 },
  analytics: { limit: 400, windowSeconds: 60 * 60 },
  billing: { limit: 20, windowSeconds: 60 * 60 },
  reanalyze: { limit: 30, windowSeconds: 24 * 60 * 60 },
  recreation_guide: { limit: 20, windowSeconds: 24 * 60 * 60 },
  /**
   * Re-asking for a breakdown with a different question. The first breakdown of
   * a segment is written automatically by the pipeline and does not spend from
   * this budget: only a deliberate refocus does.
   */
  segment_breakdown: { limit: 10, windowSeconds: 24 * 60 * 60 },
  /**
   * The generative route to the same segment, asked for by hand. Nothing writes
   * it automatically, so every call here is a model call somebody chose to make.
   */
  ai_recreation: { limit: 10, windowSeconds: 24 * 60 * 60 },
  /*
   * The `_ip` buckets below are keyed by address even for a signed-in caller.
   * Accounts are free and instant, so the per-user budgets above bound one
   * account rather than one person: twenty inboxes is twenty budgets. One
   * address is harder to come by, so these sit alongside the per-user ones on
   * the three routes that spend model money, and two different signed-in users
   * behind one address share them — that is the point of them.
   */
  video_submit_ip: { limit: 12, windowSeconds: 24 * 60 * 60 },
  ai_recreation_ip: { limit: 10, windowSeconds: 24 * 60 * 60 },
  segment_breakdown_ip: { limit: 10, windowSeconds: 24 * 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/** The buckets that are keyed by address rather than by account. */
export type IpRateLimitBucket = Extract<RateLimitBucket, `${string}_ip`>;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string | null;
};

/**
 * Stable, non-reversible subject for the caller's address. Behind Vercel the
 * client IP is the first hop in `x-forwarded-for`; the other two headers cover
 * running behind something else.
 */
export function ipKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip =
    forwarded.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown";
  const salt = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb";
  return `ip:${createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32)}`;
}

/** Stable, non-reversible subject for anonymous callers. */
export function clientKey(request: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  return ipKey(request);
}

export async function consumeRateLimit(
  bucket: RateLimitBucket,
  subject: string,
  overrides?: Partial<RateLimitRule>
): Promise<RateLimitResult> {
  const rule = { ...RATE_LIMITS[bucket], ...overrides };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_bucket: bucket,
      p_subject: subject,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: !!row?.allowed,
      remaining: Number(row?.remaining ?? 0),
      resetAt: (row?.reset_at as string | null) ?? null,
    };
  } catch (e) {
    // Failing closed would take the whole product down if the counter table has
    // a problem; failing open is logged loudly and is the lesser risk here,
    // because plan entitlements are enforced separately.
    reportError(e, { source: "consumeRateLimit", bucket });
    return { allowed: true, remaining: rule.limit, resetAt: null };
  }
}

export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfter = result.resetAt
    ? Math.max(1, Math.ceil((new Date(result.resetAt).getTime() - Date.now()) / 1000))
    : 60;
  return NextResponse.json(
    { error: "rate_limited", message: "Too many requests. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

/**
 * Guard a route. Returns a 429 response to return early, or null to continue.
 */
export async function enforceRateLimit(
  bucket: RateLimitBucket,
  request: Request,
  userId?: string | null,
  overrides?: Partial<RateLimitRule>
): Promise<NextResponse | null> {
  const result = await consumeRateLimit(bucket, clientKey(request, userId), overrides);
  return result.allowed ? null : rateLimitResponse(result);
}

/**
 * Guard a route by address, whatever account the caller is signed in to. Only
 * the `_ip` buckets can be asked for: keying a per-user bucket by address would
 * make one person's spend count against everyone behind their router.
 */
export async function enforceIpRateLimit(
  bucket: IpRateLimitBucket,
  request: Request,
  overrides?: Partial<RateLimitRule>
): Promise<NextResponse | null> {
  const result = await consumeRateLimit(bucket, ipKey(request), overrides);
  return result.allowed ? null : rateLimitResponse(result);
}
