import { NextResponse } from "next/server";
import { reportError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The site-wide ceiling on new segments, the backstop behind the per-account
 * plan limits.
 *
 * Accounts are free and instant, so a per-account limit bounds one account, not
 * the bill. This is the number that bounds the bill: at the default, 150
 * twelve-shot segments is roughly $100 of model spend and about ten hours of
 * the two-worker queue — the most that can be lost in a day even if every other
 * layer fails. Pro users bypass nothing here on purpose: a paying customer
 * hitting the cap is the signal to raise it, and the cap is one env var.
 */

const DEFAULT_DAILY_SEGMENT_CAP = 150;

/**
 * Read at call time rather than frozen at import: a preview deploy can be run
 * at a different cap, and a typo in the env var must not silently become a cap
 * of zero and take uploads down site-wide.
 */
export function dailySegmentCap(): number {
  const raw = process.env.DAILY_SEGMENT_CAP;
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_SEGMENT_CAP;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DAILY_SEGMENT_CAP;
  return Math.floor(parsed);
}

/**
 * Segments started in the last 24 hours, across every account.
 *
 * A rolling window, not a calendar day: a calendar cap resets at a known
 * instant, so a script can spend the whole of tomorrow's allowance the second
 * it rolls over and the whole of today's just before. Failed videos are not
 * counted — a pipeline that fell over on our side should not cost the site its
 * capacity. Counted with the admin client so RLS does not hide other users' rows.
 */
export async function segmentsCreatedToday(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await createAdminClient()
    .from("videos")
    .select("id", { count: "exact", head: true })
    .gt("created_at", since)
    .neq("status", "failed");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Whether the site has spent its day. Logs at 80% so the cap can be raised
 * before anyone is turned away, and at 100% because that is a user being
 * refused.
 *
 * Fails open, the way `consumeRateLimit` does and for the same reason: if the
 * count cannot be read, refusing every upload site-wide is a worse outcome than
 * running uncapped for as long as the fault lasts, and the per-account plan
 * limits are still enforced.
 */
export async function atDailyCapacity(): Promise<boolean> {
  const cap = dailySegmentCap();
  let used: number;
  try {
    used = await segmentsCreatedToday();
  } catch (e) {
    reportError(e, { source: "atDailyCapacity", cap });
    return false;
  }

  if (used >= cap) {
    reportError(new Error(`Daily segment cap reached: ${used}/${cap}`), {
      source: "atDailyCapacity",
      used,
      cap,
    });
    return true;
  }
  if (used >= Math.floor(cap * 0.8)) {
    reportError(new Error(`Daily segment cap at 80%: ${used}/${cap}`), {
      source: "atDailyCapacity",
      used,
      cap,
    });
  }
  return false;
}

/**
 * Seconds until the next UTC midnight.
 *
 * Deliberately not the same clock as the window above. The window is rolling so
 * the cap cannot be gamed by a burst either side of midnight; the header is a
 * human-meaningful "come back tomorrow", and a rolling window has no instant to
 * name. Erring towards the later time means nobody is told to retry into a
 * refusal.
 */
export function secondsToUtcMidnight(now: Date = new Date()): number {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

/** The one 503 the upload route returns when the site is out of capacity. */
export function atCapacityResponse(now: Date = new Date()): NextResponse {
  const retryAfter = secondsToUtcMidnight(now);
  return NextResponse.json(
    {
      error: "at_capacity",
      message: "We're at capacity for today. Try again tomorrow.",
      retryAfter,
    },
    { status: 503, headers: { "Retry-After": String(retryAfter) } }
  );
}
