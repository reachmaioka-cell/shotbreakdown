import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { FEATURES } from "@/lib/features";
import { humanize } from "@/lib/filters";
import { resolveMediaUrl } from "@/lib/media";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AdminActions } from "./admin-actions";

export const dynamic = "force-dynamic";

/**
 * Editorial review. Publishing to the public library is an explicit decision
 * here — it is deliberately not something crowd ratings can trigger.
 */
export default async function AdminReviewPage() {
  if (!FEATURES.adminReview) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) notFound();

  const admin = createAdminClient();
  const { data: candidates } = await admin
    .from("shots")
    .select(
      "id, title, summary, thumbnail_path, visibility, view_count, save_count, created_at, shot_size, movement_type, lighting_key, videos ( title, source_type )"
    )
    .eq("status", "complete")
    .neq("visibility", "public")
    .not("metadata", "is", null)
    .order("save_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);

  const rows = await Promise.all(
    (candidates ?? []).map(async (row) => ({
      ...row,
      thumbUrl: await resolveMediaUrl(row.thumbnail_path as string | null),
    }))
  );

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-8">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-[17px] font-medium text-text-0">Review</h1>
          <Link href="/admin/learning" className="text-[12px] text-text-2 hover:text-text-0">
            Learning agent →
          </Link>
        </div>
        <p className="mb-6 text-[13px] text-text-2">
          Publishing a shot makes it visible in the public library and indexable. Only publish
          shots whose owner intended them to be shared.
        </p>

        {rows.length === 0 ? (
          <p className="text-[13px] text-text-2">Nothing waiting for review.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {rows.map((row) => {
              const video = Array.isArray(row.videos) ? row.videos[0] : row.videos;
              return (
                <li key={row.id} className="flex items-center gap-4 py-3">
                  <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-[3px] bg-ink-2">
                    {row.thumbUrl ? (
                      <Image src={row.thumbUrl} alt="" fill sizes="96px" className="object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/shots/${row.id}`} className="text-[13px] text-text-0 hover:text-accent">
                      {(row.summary as string | null) ?? (row.title as string | null) ?? row.id}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-text-3">
                      {[
                        video?.title as string | undefined,
                        row.shot_size ? humanize(row.shot_size as string) : null,
                        row.movement_type ? humanize(row.movement_type as string) : null,
                        row.lighting_key ? humanize(row.lighting_key as string) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-text-3">
                      {row.view_count} views · {row.save_count} saves · {row.visibility}
                    </p>
                  </div>
                  <AdminActions shotId={row.id as string} />
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
