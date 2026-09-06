import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ActiveFilters } from "@/components/active-filters";
import { FilterSidebar, type ScopeTab } from "@/components/library/filter-sidebar";
import { DensityToggle, JustifiedGrid } from "@/components/library/justified-grid";
import { SearchBar } from "@/components/search-bar";
import { AppShell } from "@/components/shell/app-shell";
import { LinkButton, ErrorState } from "@/components/ui/primitives";
import { savedShotIds } from "@/lib/collections";
import { getAppUrl } from "@/lib/env";
import { FEATURES } from "@/lib/features";
import { FILTER_KEYS, humanize } from "@/lib/filters";
import {
  searchShots,
  shotFacetCounts,
  type ShotScope,
  type ShotSearchFilters,
} from "@/lib/shots";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value !== undefined) params.append(key, value);
  }
  return params;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  if (!FEATURES.publicLibrary) {
    // A library of one person's own shots is behind login and worth nothing to
    // a crawler, so it describes itself plainly and asks to be left alone.
    return {
      title: "Shots",
      description:
        "Every segment you have analyzed, searchable by look, lighting, lens, movement and mood.",
      alternates: { canonical: `${getAppUrl()}/library` },
      robots: { index: false, follow: false },
    };
  }

  const raw = await searchParams;
  const params = toParams(raw);
  const query = params.get("q");
  const activeFacets = FILTER_KEYS.flatMap((key) =>
    params.getAll(key).flatMap((v) => v.split(",")).filter(Boolean)
  );

  const descriptor = [query, ...activeFacets.map(humanize)].filter(Boolean).join(" · ");
  const title = descriptor ? `${descriptor} — shot library` : "Shot library";

  return {
    title,
    description: descriptor
      ? `Cinematography reference shots matching ${descriptor}. Search by look, lighting, lens, movement and mood.`
      : "Browse a searchable library of analyzed cinematography shots. Filter by shot size, camera movement, lighting, colour and mood.",
    alternates: { canonical: `${getAppUrl()}/library` },
    robots: descriptor ? { index: false, follow: true } : undefined,
  };
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params = toParams(raw);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  /*
   * With no public corpus there is nothing here for a signed-out visitor: every
   * scope resolves to their own shots, and they have none. Gated on the flag
   * rather than hardcoded, so turning the public library back on restores
   * anonymous browsing instead of leaving the page behind a login wall.
   */
  if (!FEATURES.publicLibrary && !user) redirect("/auth/login?next=/library");

  const scopeParam = params.get("scope");
  /*
   * "public" is the whole-corpus scope. With the public library off there is no
   * corpus to browse, so it collapses to the viewer's own shots — which is also
   * where an unparameterised /library now lands.
   */
  const scope: ShotScope = FEATURES.publicLibrary
    ? scopeParam === "mine" || scopeParam === "saved"
      ? user
        ? scopeParam
        : "public"
      : "public"
    : scopeParam === "saved"
      ? "saved"
      : "mine";

  const filters: ShotSearchFilters = {};
  for (const key of FILTER_KEYS) {
    const values = params.getAll(key).flatMap((v) => v.split(",")).filter(Boolean);
    if (values.length > 0) (filters as Record<string, unknown>)[key] = values;
  }
  const videoId = params.get("video_id");
  if (videoId) filters.video_id = videoId;

  const query = params.get("q") ?? undefined;

  /*
   * The shell's own data — who this is, and the segments the Segment group
   * lists — does not depend on the search, so it is in flight while the search
   * runs rather than after it.
   */
  const shellData = Promise.all([
    user
      ? supabase.from("profiles").select("plan, is_admin, display_name").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    user
      ? supabase
          .from("videos")
          .select("id, title")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] }),
  ]);

  let result: Awaited<ReturnType<typeof searchShots>>;
  let facets: Awaited<ReturnType<typeof shotFacetCounts>>;
  let searchFailed = false;
  try {
    [result, facets] = await Promise.all([
      searchShots({
        query,
        filters,
        limit: 48,
        viewerId: user?.id ?? null,
        scope,
      }),
      shotFacetCounts({ viewerId: user?.id ?? null, scope }),
    ]);
  } catch (e) {
    console.error("library search", e instanceof Error ? e.message : e);
    searchFailed = true;
    result = { shots: [], total: 0, usedSemantic: false, degraded: true };
    facets = {};
  }

  const [profileResult, segmentResult] = await shellData;
  const profile = profileResult.data as {
    plan?: string | null;
    is_admin?: boolean | null;
    display_name?: string | null;
  } | null;
  const segments = ((segmentResult.data ?? []) as { id: string; title: string | null }[]).map(
    (row) => ({ id: row.id, title: row.title })
  );

  /*
   * Which of these shots the viewer has saved, and which came out of a segment
   * that has a breakdown. Both are one query over the whole page — the second
   * keyed by segment rather than by shot, because a page of 48 frames is
   * usually a handful of segments and the answer is the same for every frame in
   * one — and neither depends on the other, so they go together rather than one
   * after the other.
   */
  const resultVideoIds = searchFailed ? [] : [...new Set(result.shots.map((s) => s.videoId))];
  const [saved, breakdownRows] = await Promise.all([
    searchFailed
      ? Promise.resolve(new Set<string>())
      : savedShotIds(user?.id ?? null, result.shots.map((s) => s.id)),
    resultVideoIds.length > 0
      ? supabase.from("videos").select("id").in("id", resultVideoIds).eq("breakdown_status", "ready")
      : Promise.resolve({ data: [] }),
  ]);
  const breakdownVideoIds = ((breakdownRows.data ?? []) as { id: string }[]).map((row) => row.id);

  const queryParams = new URLSearchParams(params.toString());
  queryParams.delete("offset");
  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";

  /*
   * A search that returns nothing is not the same as owning nothing. Only the
   * unnarrowed view can honestly say "you haven't analyzed anything yet"; with
   * a query or a filter applied the answer is "no shots match".
   */
  const narrowed = Boolean(query) || Object.keys(filters).length > 0;

  /*
   * Saved and My shots are personal scopes; a signed-out visitor (only possible
   * with the public library on) gets no tabs at all rather than tabs that lead
   * to an empty page.
   */
  const tabs: ScopeTab[] = !user
    ? []
    : FEATURES.publicLibrary
      ? [
          { key: "public", label: "All shots", href: "/library" },
          { key: "saved", label: "Saved", href: "/library?scope=saved" },
          { key: "mine", label: "My shots", href: "/library?scope=mine" },
        ]
      : [
          { key: "mine", label: "My shots", href: "/library" },
          { key: "saved", label: "Saved", href: "/library?scope=saved" },
        ];

  const plan = profile?.plan ?? "free";

  return (
    <AppShell
      authed={Boolean(user)}
      isPro={plan === "pro"}
      // Only advertise the console when it is actually reachable.
      isAdmin={Boolean(profile?.is_admin) && FEATURES.adminReview}
      displayName={profile?.display_name ?? null}
      email={user?.email ?? null}
      /*
       * The rail renders even when the search fell over. Its facet groups all
       * disappear on their own (no counts, no options), but the scope tabs are
       * navigation, not narrowing — dropping them would strand a user on the
       * error page with no way back to Saved or My shots.
       */
      sidebar={
        <Suspense fallback={null}>
          <FilterSidebar facets={facets} segments={segments} scopes={tabs} scope={scope} />
        </Suspense>
      }
      topbar={
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 sm:max-w-md">
            <Suspense
              fallback={<div className="h-9 rounded-[var(--radius)] border border-line bg-ink-1" />}
            >
              <SearchBar />
            </Suspense>
          </div>
          {/* A count of zero because the database is down is a lie, not a result. */}
          {searchFailed ? null : (
            <p className="hidden shrink-0 text-[12px] text-text-2 md:block">
              {result.total.toLocaleString()} shot{result.total === 1 ? "" : "s"}
              {query ? (
                <>
                  {" "}
                  for <span className="text-text-0">“{query}”</span>
                </>
              ) : null}
            </p>
          )}
          <DensityToggle />
        </div>
      }
    >
      {searchFailed ? (
        <ErrorState
          title="Library is temporarily unavailable"
          body="The database did not respond. If you are running locally, start Supabase with npx supabase start."
        />
      ) : (
        <>
          <Suspense fallback={null}>
            <ActiveFilters />
          </Suspense>

          {result.degraded ? (
            <p className="mb-3 text-[12px] text-text-1">
              Matching on words only — search by meaning is temporarily unavailable.
            </p>
          ) : null}

          <JustifiedGrid
            initialShots={result.shots}
            initialTotal={result.total}
            savedIds={[...saved]}
            breakdownVideoIds={breakdownVideoIds}
            queryString={queryString}
            emptyTitle={
              scope === "saved"
                ? "Nothing saved yet"
                : scope === "mine" && !narrowed
                  ? "You haven't analyzed anything yet"
                  : "No shots match"
            }
            emptyBody={
              scope === "saved"
                ? "Save a shot from the library and it will appear here."
                : scope === "mine" && !narrowed
                  ? "Upload a segment — a scene, a take, a few seconds — and ShotBreakdown breaks down every department in it."
                  : "Clear a filter or search for something looser."
            }
            emptyAction={
              scope === "mine" && !narrowed ? (
                <LinkButton href="/upload" variant="primary">
                  Upload a segment
                </LinkButton>
              ) : scope === "saved" ? (
                <LinkButton href="/library">Browse the library</LinkButton>
              ) : null
            }
          />
        </>
      )}
    </AppShell>
  );
}
