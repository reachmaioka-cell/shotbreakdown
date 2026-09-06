import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActiveFilters } from "@/components/active-filters";
import { FilterRail } from "@/components/filter-rail";
import { SearchBar } from "@/components/search-bar";
import { ShotGrid } from "@/components/shot-grid";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { GridSkeleton, LinkButton, ErrorState } from "@/components/ui/primitives";
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

  const saved = searchFailed
    ? new Set<string>()
    : await savedShotIds(user?.id ?? null, result.shots.map((s) => s.id));

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
  const tabs = !user
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

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <main id="main" className="flex-1 w-full">
        <div className="border-b border-line">
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1 max-w-2xl">
              <Suspense fallback={<div className="h-10 rounded-[3px] border border-line bg-ink-1" />}>
                <SearchBar />
              </Suspense>
            </div>
            {tabs.length > 0 ? (
            <nav aria-label="Library scope" className="flex items-center gap-1 shrink-0">
              {tabs.map((tab) => (
                <Link
                  key={tab.key}
                  href={tab.href}
                  className={`rounded-[3px] px-2.5 py-1.5 text-[12px] transition-colors ${
                    scope === tab.key ? "bg-ink-2 text-text-0" : "text-text-2 hover:text-text-0"
                  }`}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>
            ) : null}
          </div>
        </div>

        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-4">
          {searchFailed ? (
            <ErrorState
              title="Library is temporarily unavailable"
              body="The database did not respond. If you are running locally, start Supabase with npx supabase start."
            />
          ) : (
            <>
              <div className="mb-4">
                <Suspense fallback={null}>
                  <FilterRail facets={facets} />
                </Suspense>
              </div>

              <Suspense fallback={null}>
                <ActiveFilters />
              </Suspense>

              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-[12px] text-text-2" aria-live="polite">
                  {result.total.toLocaleString()} shot{result.total === 1 ? "" : "s"}
                  {query ? (
                    <>
                      {" "}
                      for <span className="text-text-0">“{query}”</span>
                    </>
                  ) : null}
                </p>
                {result.degraded ? (
                  <p className="text-[12px] text-text-1">
                    Matching on words only — search by meaning is temporarily unavailable.
                  </p>
                ) : null}
              </div>

              <Suspense fallback={<GridSkeleton />}>
                <ShotGrid
                  initialShots={result.shots}
                  initialTotal={result.total}
                  savedIds={[...saved]}
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
              </Suspense>
            </>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
