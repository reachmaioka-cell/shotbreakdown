/**
 * Seed the public shot library.
 *
 * Writes `videos` + `shots` (the canonical model). The old submissions insert
 * is gone: a one-time backfill already copied that corpus, and new rows there
 * never appear in search.
 *
 *   npm run db:seed              # admin flag + report what would be added
 *   npm run db:seed:analyze      # Claude vision + embeddings (costs tokens)
 *
 * Each new URL is one editorial shot analysed with the facet schema so it is
 * filterable. Recreation guides stay on-demand.
 */
import { clipPosterCandidates, extractYoutubeId } from "../lib/clip";
import { embed, shotEmbeddingText } from "../lib/embeddings";
import { analyzeShotFrames, loadFramesFromUrls, SHOT_PROMPT_VERSION } from "../lib/shot-analysis";
import { youtubeThumbnailAndTitle } from "../lib/source";
import { createAdminClient } from "../lib/supabase/admin";

const ANALYZE = process.argv.includes("--analyze");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

/**
 * Existing editorial references plus a second wave of cinematography trailers.
 * Duplicates against videos.source_url are skipped. Dead thumbs are skipped.
 */
const DEAD_THUMB_IDS = new Set([
  "0hjlsNkFC0M", "0i8uRBbQQ80", "0vS0E9bBL08", "0xbBLJ1WAzg", "2HkjrJ6U7qE",
  "2S9a72dwf2Y", "2Vg69Nq7xKk", "2WgOiuGyJ5U", "4Q5QRhGdvq4", "4g21yUZE2aI",
  "5KbX8VVvOQ0", "5R6qBaY2eI4", "6Ctcv7dV2Ns", "6sxCFZ8_z68", "7A1h0fMU_Ic",
  "7cxoX3LwB6I", "7i5kiFMPZ0w", "8eg0qRkKNrI", "9CgU11iJZIk", "9NQdSHfJnMg",
  "9fBapHZl5VU", "9wxI4kxAi7o", "ArKahVFBeW4", "BY5sCebdcM4", "C8LXJgjd2H8",
  "CRRVL_6GZno", "E7XlTD4oXh4", "G8tzsOFaHt0", "GBuPTnwO5v4", "H4dW2Emq6Pk",
  "H7pYIXNB56I", "Hyag7lR8DMA", "IGq4JoA1BjE", "KBiF7-zQkwI", "KBj2Z24Yg8Y",
  "Li65Ly8TcaI", "R-fQPTgYbKQ", "R7wJ6S9i2oI", "S2V0jPAhCPY", "SUXwaEUThn4",
  "Tf4XaS_a0qI", "UuxqFPIoTOA", "WXryd5jxKdM", "XJBuzwHHXe8", "XYGzRBVfYOM",
  "Y6eKrMRzL5A", "Z2UWOe5yRqY", "aTn9NN6TmYg", "c2G18nIakxw", "cNi_HC8371I",
  "eXMuYlcD7pI", "ex3C1-5Dwb0", "fJ1O1vb9YU4", "fUux2MgUVts", "gG22XNhdnJ4",
  "giXcoHbb9e8", "iszwuX1AKTw", "k0yX0YZaePs", "kQdy2vB1O0Y", "lN5QeLdQxF4",
  "lc0UehItzDc", "nC89q6jJpIw", "ne6p6MthcIU", "oPI4o8gYAyM", "ojsn2mXJJcU",
  "pXu2aJx3ghs", "qEVUfrjU87w", "sR0S50e5t5c", "uJfLOuzCsa4", "uRu3lG5QAdQ",
  "uk-9T5IkcdU", "y03X3yWcAEY", "yNCapQq4xmc", "zkbUiMFGYiY",
]);

export const REFERENCE_URLS = [
  "https://www.youtube.com/watch?v=zIfN5oNLz0s",
  "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  "https://www.youtube.com/watch?v=TcMBFSGVi1c",
  "https://www.youtube.com/watch?v=L_jWHffIx5E",
  "https://www.youtube.com/watch?v=Y6eKrMRzL5A",
  "https://www.youtube.com/watch?v=hTWKbfoikeg",
  "https://www.youtube.com/watch?v=fJ9rUzIMcZQ",
  "https://www.youtube.com/watch?v=kXYiU_JCYtU",
  "https://www.youtube.com/watch?v=3tmd-ClpJxA",
  "https://www.youtube.com/watch?v=e-ORhEE9VVg",
  "https://www.youtube.com/watch?v=09R8_2nJtjg",
  "https://www.youtube.com/watch?v=OPf0YbXqDm0",
  "https://www.youtube.com/watch?v=2Vv-BfVoq4g",
  "https://www.youtube.com/watch?v=JGwWNGJdvx8",
  "https://www.youtube.com/watch?v=YQHsXMglC9A",
  "https://www.youtube.com/watch?v=CevxZvSJLk8",
  "https://www.youtube.com/watch?v=pt8VYOfr8To",
  "https://www.youtube.com/watch?v=hLQl3WQQoQ0",
  "https://www.youtube.com/watch?v=lp-EO5I60KA",
  "https://www.youtube.com/watch?v=rYEDA3JcQqw",
  "https://www.youtube.com/watch?v=450p7goxZqg",
  "https://www.youtube.com/watch?v=SlPhMPnQ58k",
  "https://www.youtube.com/watch?v=0KSOMA3QBU0",
  "https://www.youtube.com/watch?v=PMivT7MJ41M",
  "https://www.youtube.com/watch?v=IcrbM1l_BoI",
  "https://www.youtube.com/watch?v=nfWlot6h_JM",
  "https://www.youtube.com/watch?v=YVkUvmDQ3HY",
  "https://www.youtube.com/watch?v=fRh_vgS2dFE",
  "https://www.youtube.com/watch?v=PT2_F-1esPk",
  "https://www.youtube.com/watch?v=gCcx85zbxz4",
  "https://www.youtube.com/watch?v=n9xhJrPXop4",
  "https://www.youtube.com/watch?v=5xH0HfJHsaY",
  "https://www.youtube.com/watch?v=9NJj12tJzqc",
  "https://www.youtube.com/watch?v=mqqft2x_Aa4",
  "https://www.youtube.com/watch?v=tFMo3UJ4B4g",
  "https://www.youtube.com/watch?v=7d_jQycdQGo",
  "https://www.youtube.com/watch?v=LoebZZ8K5N0",
  "https://www.youtube.com/watch?v=sR0S50e5t5c",
  "https://www.youtube.com/watch?v=KBiF7-zQkwI",
  "https://www.youtube.com/watch?v=38A__WT3-o0",
  "https://www.youtube.com/watch?v=FeSLPELpMeM",
  "https://www.youtube.com/watch?v=2WgOiuGyJ5U",
  "https://www.youtube.com/watch?v=KBj2Z24Yg8Y",
  "https://www.youtube.com/watch?v=8UVNT4wvIGY",
  // Second wave — theatrical trailers used as cinematography references.
  "https://www.youtube.com/watch?v=gZjQROMAh_s",
  "https://www.youtube.com/watch?v=hEJnMQG9ev8",
  "https://www.youtube.com/watch?v=GBuPTnwO5v4",
  "https://www.youtube.com/watch?v=lB95KLmpLR4",
  "https://www.youtube.com/watch?v=6BS27ngZtxg",
  "https://www.youtube.com/watch?v=Hyag7lR8DMA",
  "https://www.youtube.com/watch?v=YoHD9XEInc0",
  "https://www.youtube.com/watch?v=zSWdZVtXT7E",
  "https://www.youtube.com/watch?v=6kw1UVovByw",
  "https://www.youtube.com/watch?v=ne6p6MthcIU",
  "https://www.youtube.com/watch?v=vKQi3bBA1y8",
  "https://www.youtube.com/watch?v=sGbxmsDFVnE",
  "https://www.youtube.com/watch?v=7TavVZMewpY",
  "https://www.youtube.com/watch?v=pXu2aJx3ghs",
  // Third wave — cinematography-rich theatrical trailers (Deakins, Lubezki, Fraser, etc.).
  "https://www.youtube.com/watch?v=uYPbbksJxIg",
  "https://www.youtube.com/watch?v=Way9Dexny3w",
  "https://www.youtube.com/watch?v=zAGVQLHvwOY",
  "https://www.youtube.com/watch?v=EXeTwQWrcwY",
  "https://www.youtube.com/watch?v=G8tzsOFaHt0",
  "https://www.youtube.com/watch?v=2S9a72dwf2Y",
  "https://www.youtube.com/watch?v=1Vnghdsjmd0",
  "https://www.youtube.com/watch?v=V6wWKNij_1M",
  "https://www.youtube.com/watch?v=XYGzRBVfYOM",
  "https://www.youtube.com/watch?v=89OP78l9oF0",
  "https://www.youtube.com/watch?v=4g21yUZE2aI",
  "https://www.youtube.com/watch?v=u1uP_8VJkDQ",
  "https://www.youtube.com/watch?v=0pdqf4P9MB8",
  "https://www.youtube.com/watch?v=fUux2MgUVts",
  "https://www.youtube.com/watch?v=WXryd5jxKdM",
  "https://www.youtube.com/watch?v=Z2UWOe5yRqY",
  "https://www.youtube.com/watch?v=F-eMt3SrfFU",
  "https://www.youtube.com/watch?v=L3pk_TBkihU",
  "https://www.youtube.com/watch?v=ojsn2mXJJcU",
  "https://www.youtube.com/watch?v=0vS0E9bBL08",
  "https://www.youtube.com/watch?v=SUXwaEUThn4",
  "https://www.youtube.com/watch?v=Ym3LB0lOJ0o",
  "https://www.youtube.com/watch?v=yNCapQq4xmc",
  "https://www.youtube.com/watch?v=fJ1O1vb9YU4",
  "https://www.youtube.com/watch?v=xNsiQMeSvMk",
  "https://www.youtube.com/watch?v=6Ctcv7dV2Ns",
  "https://www.youtube.com/watch?v=zkbUiMFGYiY",
  "https://www.youtube.com/watch?v=BIhNsAtPbPI",
  "https://www.youtube.com/watch?v=36mnx8dBbGE",
  "https://www.youtube.com/watch?v=1Fg5iWmQjwk",
  "https://www.youtube.com/watch?v=dt__kig8PVU",
  "https://www.youtube.com/watch?v=eogpIG53Cis",
  "https://www.youtube.com/watch?v=LjLamj-b0I8",
  "https://www.youtube.com/watch?v=sY1S34973zA",
  "https://www.youtube.com/watch?v=2ilzidi_J8Q",
  "https://www.youtube.com/watch?v=UuxqFPIoTOA",
  "https://www.youtube.com/watch?v=5iaYLCiq5RM",
  "https://www.youtube.com/watch?v=WHXxVmeGQUc",
  "https://www.youtube.com/watch?v=7cxoX3LwB6I",
  "https://www.youtube.com/watch?v=R7wJ6S9i2oI",
  "https://www.youtube.com/watch?v=9fBapHZl5VU",
  "https://www.youtube.com/watch?v=6sxCFZ8_z68",
  "https://www.youtube.com/watch?v=k0yX0YZaePs",
  "https://www.youtube.com/watch?v=wxN1T1uxQ2g",
  "https://www.youtube.com/watch?v=y03X3yWcAEY",
  "https://www.youtube.com/watch?v=c2G18nIakxw",
  "https://www.youtube.com/watch?v=uk-9T5IkcdU",
  "https://www.youtube.com/watch?v=sS6ksY8xWCY",
  "https://www.youtube.com/watch?v=R-fQPTgYbKQ",
  "https://www.youtube.com/watch?v=uRu3lG5QAdQ",
  "https://www.youtube.com/watch?v=XJBuzwHHXe8",
  "https://www.youtube.com/watch?v=oPI4o8gYAyM",
  "https://www.youtube.com/watch?v=qgaRVvAKoqQ",
  "https://www.youtube.com/watch?v=uJfLOuzCsa4",
  "https://www.youtube.com/watch?v=2Vg69Nq7xKk",
  "https://www.youtube.com/watch?v=H4dW2Emq6Pk",
  "https://www.youtube.com/watch?v=aTn9NN6TmYg",
  "https://www.youtube.com/watch?v=4Q5QRhGdvq4",
  "https://www.youtube.com/watch?v=lN5QeLdQxF4",
  "https://www.youtube.com/watch?v=C8LXJgjd2H8",
  "https://www.youtube.com/watch?v=5R6qBaY2eI4",
  "https://www.youtube.com/watch?v=qEVUfrjU87w",
  "https://www.youtube.com/watch?v=ex3C1-5Dwb0",
  "https://www.youtube.com/watch?v=nC89q6jJpIw",
  "https://www.youtube.com/watch?v=giXcoHbb9e8",
  "https://www.youtube.com/watch?v=0i8uRBbQQ80",
  "https://www.youtube.com/watch?v=BY5sCebdcM4",
  "https://www.youtube.com/watch?v=5KbX8VVvOQ0",
  "https://www.youtube.com/watch?v=7A1h0fMU_Ic",
  "https://www.youtube.com/watch?v=9CgU11iJZIk",
  "https://www.youtube.com/watch?v=Li65Ly8TcaI",
  "https://www.youtube.com/watch?v=0hjlsNkFC0M",
  "https://www.youtube.com/watch?v=CRRVL_6GZno",
  "https://www.youtube.com/watch?v=lc0UehItzDc",
  "https://www.youtube.com/watch?v=zwhP5b4tD6g",
  "https://www.youtube.com/watch?v=gG22XNhdnJ4",
  "https://www.youtube.com/watch?v=IGq4JoA1BjE",
  "https://www.youtube.com/watch?v=0xbBLJ1WAzg",
  "https://www.youtube.com/watch?v=n9DwoQ7HWvI",
  "https://www.youtube.com/watch?v=SGWvwjZ0eDc",
  "https://www.youtube.com/watch?v=S2V0jPAhCPY",
  "https://www.youtube.com/watch?v=9NQdSHfJnMg",
  "https://www.youtube.com/watch?v=9wxI4kxAi7o",
  "https://www.youtube.com/watch?v=E7XlTD4oXh4",
  "https://www.youtube.com/watch?v=XFYWazblaUA",
  "https://www.youtube.com/watch?v=neY2xVmOfUM",
  "https://www.youtube.com/watch?v=GokKUqLcvD8",
  "https://www.youtube.com/watch?v=iszwuX1AKTw",
  "https://www.youtube.com/watch?v=eXMuYlcD7pI",
  "https://www.youtube.com/watch?v=Tf4XaS_a0qI",
  "https://www.youtube.com/watch?v=8eg0qRkKNrI",
  "https://www.youtube.com/watch?v=n2igjYFojUo",
  "https://www.youtube.com/watch?v=ArKahVFBeW4",
  "https://www.youtube.com/watch?v=whldChqCsYk",
  "https://www.youtube.com/watch?v=2HkjrJ6U7qE",
  "https://www.youtube.com/watch?v=H7pYIXNB56I",
  "https://www.youtube.com/watch?v=kQdy2vB1O0Y",
  "https://www.youtube.com/watch?v=A5GJLwWiYSg",
  "https://www.youtube.com/watch?v=AST2-4db4ic",
  "https://www.youtube.com/watch?v=cNi_HC8371I",
  "https://www.youtube.com/watch?v=BHi-a1n8t7M",
  "https://www.youtube.com/watch?v=7i5kiFMPZ0w",
  // Fourth wave — IDs probed live (sd1.jpg 200) before ingest.
  "https://www.youtube.com/watch?v=NdvqHc56lE0",
  "https://www.youtube.com/watch?v=nLyxSDHjbHY",
  "https://www.youtube.com/watch?v=OlwRRxY5VHo",
  "https://www.youtube.com/watch?v=nulvWqYUM8k",
  "https://www.youtube.com/watch?v=pBk4NYhWNMM",
  "https://www.youtube.com/watch?v=LNlrGhBpYjc",
  "https://www.youtube.com/watch?v=r-vfg3KkV54",
  "https://www.youtube.com/watch?v=JX9jasdi3ic",
  "https://www.youtube.com/watch?v=UShV9xVzc1U",
  "https://www.youtube.com/watch?v=CT2_P2DZBR0",
  "https://www.youtube.com/watch?v=avz06PDqDbM",
  "https://www.youtube.com/watch?v=RlbR5N6veqw",
  "https://www.youtube.com/watch?v=6ZfuNTqbHE8",
  "https://www.youtube.com/watch?v=2m1drlOZSDw",
  "https://www.youtube.com/watch?v=8ugaeA-nMTc",
];

function slugify(title: string, id: string) {
  const shortId = id.replace(/-/g, "").slice(0, 8);
  let base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base || base.length < 3) base = "shot";
  return `${base.slice(0, 48)}-${shortId}`;
}

function youtubeKey(url: string): string | null {
  return extractYoutubeId(url);
}

async function existingYoutubeIds(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin.from("videos").select("source_url").not("source_url", "is", null);
  if (error) throw new Error(error.message);
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const id = youtubeKey(row.source_url as string);
    if (id) ids.add(id);
  }
  return ids;
}

async function seedShot(
  admin: ReturnType<typeof createAdminClient>,
  sourceUrl: string
): Promise<"ok" | "skip-thumb" | "fail"> {
  const meta = await youtubeThumbnailAndTitle(sourceUrl);
  const ytId = extractYoutubeId(sourceUrl);
  const candidates = clipPosterCandidates({
    sourceUrl,
    thumbnailUrl: meta.thumbnail,
  });
  // Probe stills one at a time. Fetching the whole candidate list in parallel
  // trips YouTube's thumbnail CDN and looks like a dead video.
  let images: Awaited<ReturnType<typeof loadFramesFromUrls>> = [];
  for (const url of candidates.slice(0, 3)) {
    images = await loadFramesFromUrls([url]);
    if (images.length > 0) break;
  }
  if (images.length === 0) {
    console.warn("  skip, no usable frame", sourceUrl);
    return "skip-thumb";
  }

  const title = meta.title ?? `YouTube ${ytId ?? "shot"}`;
  const record = await analyzeShotFrames({
    images,
    videoTitle: title,
    shotIndex: 0,
    shotCount: 1,
    startSeconds: 0,
    endSeconds: 0,
  });
  const vector = await embed(
    shotEmbeddingText(record, { title, sourceType: "youtube", videoTitle: title })
  );

  const poster = images.find((img) => !img.url.includes("hqdefault") && !img.url.includes("maxresdefault"))?.url
    ?? images[0]?.url
    ?? meta.thumbnail
    ?? candidates[0];
  const { data: video, error: videoError } = await admin
    .from("videos")
    .insert({
      source_type: "youtube",
      source_url: sourceUrl,
      title,
      status: "complete",
      visibility: "public",
      is_editorial: true,
      poster_path: poster,
      shot_count: 1,
      analyzed_shot_count: 1,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (videoError || !video) {
    console.error("  video insert failed", videoError?.message);
    return "fail";
  }

  const { data: shot, error: shotError } = await admin
    .from("shots")
    .insert({
      video_id: video.id,
      shot_index: 0,
      start_seconds: 0,
      end_seconds: 0,
      title: record.one_line_summary || title,
      thumbnail_path: poster,
      poster_path: poster,
      metadata: record,
      embedding: vector,
      prompt_version: SHOT_PROMPT_VERSION,
      status: "complete",
      visibility: "public",
      is_editorial: true,
      tags: record.tags,
      aspect_ratio: "16:9",
    })
    .select("id")
    .single();
  if (shotError || !shot) {
    console.error("  shot insert failed", shotError?.message);
    await admin.from("videos").delete().eq("id", video.id);
    return "fail";
  }

  const slug = slugify(record.one_line_summary || title, shot.id as string);
  const { error: slugError } = await admin.from("shots").update({ slug }).eq("id", shot.id);
  if (slugError) console.error("  slug failed", slugError.message);

  console.log(`  ✓ ${slug} — ${record.composition.shot_size}, ${record.lighting_facets.key_level}`);
  return "ok";
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  console.log("seeding shots against", url);

  const admin = createAdminClient();

  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1);
  if (profileErr) throw new Error(profileErr.message);
  const first = profiles?.[0]?.id as string | undefined;
  if (first) {
    const { error } = await admin.from("profiles").update({ is_admin: true }).eq("id", first);
    if (error) console.error("admin flag:", error.message);
    else console.log("is_admin set on first profile");
  } else {
    console.log("no profiles yet — sign in once, then re-run to set admin");
  }

  const seen = await existingYoutubeIds(admin);
  const pending = REFERENCE_URLS.filter((u) => {
    const id = youtubeKey(u);
    if (!id) return true;
    return !seen.has(id) && !DEAD_THUMB_IDS.has(id);
  });

  console.log(`${seen.size} YouTube ids already in videos; ${pending.length} new`);

  if (!ANALYZE) {
    pending.slice(0, 10).forEach((u) => console.log("  would add", u));
    if (pending.length > 10) console.log(`  …and ${pending.length - 10} more`);
    console.log("Re-run with --analyze to ingest (uses Anthropic + OpenAI).");
    return;
  }

  let done = 0;
  let skipped = 0;
  let failed = 0;
  for (const sourceUrl of pending) {
    if (done >= LIMIT) break;
    const ytId = youtubeKey(sourceUrl);
    if (ytId) seen.add(ytId);
    try {
      const result = await seedShot(admin, sourceUrl);
      if (result === "ok") done += 1;
      else if (result === "skip-thumb") skipped += 1;
      else failed += 1;
    } catch (e) {
      failed += 1;
      console.error("  analyze failed", sourceUrl, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\nseeded ${done}, skipped ${skipped}, failed ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
