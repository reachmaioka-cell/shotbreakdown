/**
 * The launch switch for the editorial corpus.
 *
 * Publishing is not a preview. `visibility = 'public'` is what the `shots
 * public select` RLS policy keys on, and that policy is granted to `anon`, so a
 * published row is readable by anyone straight from PostgREST with the
 * publishable anon key that ships in the browser bundle — no page code, no
 * feature flag and no session involved. Run this once, at launch, when the
 * whole corpus is meant to be public.
 *
 *   npm run editorial:publish -- --dry-run     # count, change nothing
 *   npm run editorial:publish                  # local only
 *   npm run editorial:publish -- --yes         # against production
 *
 * Publishes shots where `is_editorial and review_status = 'approved' and
 * visibility = 'private'`, and the videos those shots belong to. Idempotent:
 * a second run finds nothing left to do. scripts/unpublish-editorial.ts is the
 * way back.
 */
import { createAdminClient } from "@/lib/supabase/admin";

const DRY_RUN = process.argv.includes("--dry-run");
const CONFIRMED = process.argv.includes("--yes");

function isLocalHost(value: string | undefined): boolean {
  if (!value) return true;
  try {
    const host = new URL(value).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

/*
 * Both endpoints have to be local for a run to count as local. The writes go
 * through NEXT_PUBLIC_SUPABASE_URL, but .env.local has held a production
 * DATABASE_URL beside a local Supabase URL, so trusting either one alone would
 * mean this script could read as "local" while something in the same
 * environment points at production. Ambiguity fails closed.
 */
function targetIsProduction(): boolean {
  return (
    !isLocalHost(process.env.NEXT_PUBLIC_SUPABASE_URL) || !isLocalHost(process.env.DATABASE_URL)
  );
}

type Pending = { id: string; video_id: string };

/*
 * PostgREST takes the id list in the query string, and the gateway in front of
 * it answers `URI too long` once that list gets big — measured against the
 * local stack, a single `in` of 250 uuids already fails while 200 goes through.
 * A corpus of a few hundred shots is exactly the size this script is for, so
 * the ids go over in batches rather than in one filter.
 */
const ID_BATCH = 100;

function batches<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += ID_BATCH) out.push(values.slice(i, i + ID_BATCH));
  return out;
}

async function approvedAndUnpublished(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin
    .from("shots")
    .select("id, video_id")
    .eq("is_editorial", true)
    .eq("review_status", "approved")
    .eq("visibility", "private");
  if (error) throw new Error(error.message);
  return (data ?? []) as Pending[];
}

async function main() {
  const target = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!target) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");

  const production = targetIsProduction();
  console.log(`editorial publish against ${target}${production ? " (PRODUCTION)" : " (local)"}`);
  if (production && !DRY_RUN && !CONFIRMED) {
    throw new Error(
      "Refusing to publish against production without --yes. Run with --dry-run first."
    );
  }

  const admin = createAdminClient();
  const pending = await approvedAndUnpublished(admin);
  const videoIds = [...new Set(pending.map((row) => row.video_id))];
  console.log(
    `${pending.length} approved shot${pending.length === 1 ? "" : "s"} across ${videoIds.length} video${videoIds.length === 1 ? "" : "s"} would become public`
  );

  if (DRY_RUN) {
    console.log("dry run: nothing changed");
    return;
  }
  if (pending.length === 0) return;

  /*
   * Videos first. A public shot whose video row is still private renders a shot
   * page that links to a segment page returning 404; the other order is only
   * ever a video with nothing public in it yet, which shows an empty segment.
   */
  for (const batch of batches(videoIds)) {
    const { error: videoError } = await admin
      .from("videos")
      .update({ visibility: "public" })
      .in("id", batch)
      .eq("is_editorial", true);
    if (videoError) throw new Error(`videos: ${videoError.message}`);
  }

  let publishedCount = 0;
  for (const batch of batches(pending.map((row) => row.id))) {
    const { data: published, error: shotError } = await admin
      .from("shots")
      .update({ visibility: "public" })
      .in("id", batch)
      .eq("is_editorial", true)
      .eq("review_status", "approved")
      .select("id");
    if (shotError) throw new Error(`shots: ${shotError.message}`);
    publishedCount += published?.length ?? 0;
  }

  console.log(
    `published ${publishedCount} shots and ${videoIds.length} videos — the corpus is now readable through REST with the anon key`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
