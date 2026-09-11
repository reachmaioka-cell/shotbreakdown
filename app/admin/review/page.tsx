import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { FEATURES } from "@/lib/features";
import { humanize } from "@/lib/filters";
import { resolveMediaUrlMap } from "@/lib/media";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AdminActions } from "./admin-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Review",
  robots: { index: false, follow: false },
};

const ROW_COLUMNS =
  "id, title, summary, thumbnail_path, visibility, review_status, reviewed_at, view_count, save_count, created_at, shot_size, movement_type, lighting_key, videos ( title, source_type )";

/**
 * Editorial review.
 *
 * Two states, and they are not the same axis. `review_status` is the decision —
 * Ken can work through the queue for weeks — and `visibility` is exposure,
 * which only scripts/publish-editorial.ts changes, once, at launch. There is no
 * Publish button here on purpose: a row with `visibility = 'public'` is
 * readable by anyone straight from PostgREST with the publishable anon key, so
 * publishing as you curate would mean leaking the corpus one row at a time.
 *
 * The queue holds editorial rows only. `is_editorial` is writable by the
 * service role alone (protect_shot_columns), so the only things that reach this
 * page are what the seeders put there — never a customer's private upload,
 * which nobody asked us to publish.
 */
export default async function AdminReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  if (!FEATURES.adminReview) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, plan, display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) notFound();

  const tab = (await searchParams)?.tab === "approved" ? "approved" : "pending";
  const admin = createAdminClient();

  const [pendingCount, approvedCount, listed] = await Promise.all([
    admin
      .from("shots")
      .select("id", { count: "exact", head: true })
      .eq("is_editorial", true)
      .eq("review_status", "pending"),
    admin
      .from("shots")
      .select("id", { count: "exact", head: true })
      .eq("is_editorial", true)
      .eq("review_status", "approved"),
    admin
      .from("shots")
      .select(ROW_COLUMNS)
      .eq("is_editorial", true)
      .eq("status", "complete")
      .eq("review_status", tab)
      .not("metadata", "is", null)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const thumbs = await resolveMediaUrlMap(
    (listed.data ?? []).map((row) => row.thumbnail_path as string | null)
  );
  const rows = (listed.data ?? []).map((row) => ({
    ...row,
    thumbUrl: thumbs.get((row.thumbnail_path as string | null) ?? "") ?? null,
  }));

  const counts = { pending: pendingCount.count ?? 0, approved: approvedCount.count ?? 0 };
  const tabs = [
    { key: "pending" as const, label: "Queue", href: "/admin/review" },
    { key: "approved" as const, label: "Approved", href: "/admin/review?tab=approved" },
  ];

  return (
    <AppShell
      authed
      isPro={profile.plan === "pro"}
      isAdmin
      displayName={(profile.display_name as string | null) ?? null}
      email={user.email ?? null}
      topbar={
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[13px] font-medium text-text-0">Review</h1>
          {FEATURES.adminLearning ? (
            <Link href="/admin/learning" className="text-[12px] text-text-2 hover:text-text-0">
              Learning agent →
            </Link>
          ) : null}
        </div>
      }
    >
      <div className="mx-auto w-full max-w-4xl px-1 py-4">
        <nav className="mb-4 flex items-center gap-4 border-b border-line">
          {tabs.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`-mb-px border-b px-0.5 pb-2 text-[13px] ${
                tab === item.key
                  ? "border-text-0 text-text-0"
                  : "border-transparent text-text-2 hover:text-text-0"
              }`}
            >
              {item.label}{" "}
              <span className="mono text-[11px] text-text-3">{counts[item.key]}</span>
            </Link>
          ))}
        </nav>

        <p className="mb-5 text-[13px] text-text-2">
          {tab === "pending"
            ? "Editorial shots nobody has ruled on yet. Approving marks one fit for the library; it does not publish it. Rejecting is durable — the row stays on file with the decision on it."
            : "Approved and waiting for launch. Nothing here is readable by anyone until npm run editorial:publish is run; each row says where it stands."}
        </p>

        {rows.length === 0 ? (
          <p className="text-[13px] text-text-2">
            {tab === "pending" ? "Nothing waiting for review." : "Nothing approved yet."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {rows.map((row) => {
              const video = Array.isArray(row.videos) ? row.videos[0] : row.videos;
              return (
                <li key={row.id as string} className="flex items-center gap-4 py-3">
                  <div className="relative flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-ink-2">
                    {row.thumbUrl ? (
                      <Image src={row.thumbUrl} alt="" fill sizes="96px" className="object-cover" />
                    ) : (
                      // A still that failed to upload leaves the path dangling.
                      // Say so, rather than showing an empty box that reads as a
                      // slow image.
                      <span className="text-[10px] text-text-3">no still</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/shots/${row.id}`}
                      className="text-[13px] text-text-0 hover:text-accent"
                    >
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
                      {row.view_count} views · {row.save_count} saves ·{" "}
                      {/* Exposure, spelled out: the whole point of the split. */}
                      <span
                        className={
                          row.visibility === "public" ? "text-accent" : "text-text-3"
                        }
                      >
                        {row.visibility === "public" ? "public" : "private — not published"}
                      </span>
                    </p>
                  </div>
                  <AdminActions shotId={row.id as string} reviewStatus={tab} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
