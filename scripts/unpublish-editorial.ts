/**
 * The way back from scripts/publish-editorial.ts.
 *
 * Takes every public editorial row private again, which is the only thing that
 * actually removes it from reach: while `visibility = 'public'` the `shots
 * public select` policy hands the row to anyone holding the publishable anon
 * key, whatever the feature flags say.
 *
 *   npm run editorial:unpublish -- --dry-run
 *   npm run editorial:unpublish
 *   npm run editorial:unpublish -- --yes       # against production
 *
 * Unlike its pair this does not filter on review_status: if a row is editorial
 * and public, pulling it back is the point, however it got there.
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

/* Same rule as publish-editorial.ts: ambiguity counts as production. */
function targetIsProduction(): boolean {
  return (
    !isLocalHost(process.env.NEXT_PUBLIC_SUPABASE_URL) || !isLocalHost(process.env.DATABASE_URL)
  );
}

/*
 * Same batching as publish-editorial.ts, and it matters more here: PostgREST
 * carries the id list in the query string and the gateway answers `URI too
 * long` past a couple of hundred uuids, which would leave the corpus public at
 * the moment someone is trying to pull it back.
 */
const ID_BATCH = 100;

function batches<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += ID_BATCH) out.push(values.slice(i, i + ID_BATCH));
  return out;
}

async function main() {
  const target = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!target) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");

  const production = targetIsProduction();
  console.log(`editorial unpublish against ${target}${production ? " (PRODUCTION)" : " (local)"}`);
  if (production && !DRY_RUN && !CONFIRMED) {
    throw new Error(
      "Refusing to unpublish against production without --yes. Run with --dry-run first."
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shots")
    .select("id")
    .eq("is_editorial", true)
    .eq("visibility", "public");
  if (error) throw new Error(error.message);
  const shotIds = (data ?? []).map((row) => row.id as string);

  /*
   * Asked for directly rather than derived from the shots above. An editorial
   * video whose shots are all private or unlisted is still a public row of its
   * own — title, focus and the whole breakdown document — and deriving the
   * video list from public shots would walk straight past it.
   */
  const { data: videoRows, error: videoListError } = await admin
    .from("videos")
    .select("id")
    .eq("is_editorial", true)
    .eq("visibility", "public");
  if (videoListError) throw new Error(videoListError.message);
  const videoIds = (videoRows ?? []).map((row) => row.id as string);

  console.log(
    `${shotIds.length} public editorial shot${shotIds.length === 1 ? "" : "s"} and ${videoIds.length} public editorial video${videoIds.length === 1 ? "" : "s"} would go private`
  );

  if (DRY_RUN) {
    console.log("dry run: nothing changed");
    return;
  }
  if (shotIds.length === 0 && videoIds.length === 0) return;

  // Shots first here: a private shot under a still-public video is a segment
  // page with nothing in it, which is the harmless half of the window.
  let hiddenShots = 0;
  for (const batch of batches(shotIds)) {
    const { data: hidden, error: shotError } = await admin
      .from("shots")
      .update({ visibility: "private" })
      .in("id", batch)
      .eq("is_editorial", true)
      .select("id");
    if (shotError) throw new Error(`shots: ${shotError.message}`);
    hiddenShots += hidden?.length ?? 0;
  }

  for (const batch of batches(videoIds)) {
    const { error: videoError } = await admin
      .from("videos")
      .update({ visibility: "private" })
      .in("id", batch)
      .eq("is_editorial", true);
    if (videoError) throw new Error(`videos: ${videoError.message}`);
  }

  console.log(`took ${hiddenShots} shots and ${videoIds.length} videos private`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
