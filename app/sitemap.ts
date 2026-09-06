import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/env";
import { FEATURES } from "@/lib/features";
import { LEARN_TOPICS } from "@/lib/learn";
import { searchShots, shotFacetCounts } from "@/lib/shots";
import { MIN_SHOTS_FOR_INDEX, TAXONOMY_GROUPS } from "@/lib/taxonomy";

export const revalidate = 3600;

/**
 * Only genuinely public, genuinely populated pages are listed. Private videos,
 * private shots, share links and filtered library views stay out.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = getAppUrl();

  // With the public library off, every shot in the database belongs to the user
  // who uploaded it and nothing behind /library is crawlable. The marketing
  // pages are the whole sitemap, so return before spending a query on it.
  if (!FEATURES.publicLibrary) {
    return [
      { url: origin, lastModified: new Date(), priority: 1 },
      { url: `${origin}/upgrade`, priority: 0.4 },
      { url: `${origin}/terms`, priority: 0.2 },
      { url: `${origin}/privacy`, priority: 0.2 },
    ];
  }

  const [shots, facets] = await Promise.all([
    searchShots({ limit: 96, scope: "public" }).catch(() => ({ shots: [], total: 0, usedSemantic: false, degraded: false })),
    shotFacetCounts({ scope: "public" }).catch(() => ({} as Record<string, { value: string; count: number }[]>)),
  ]);

  const shotUrls: MetadataRoute.Sitemap = shots.shots
    .filter((shot) => shot.slug)
    .map((shot) => ({
      url: `${origin}/shots/${shot.slug}`,
      lastModified: shot.createdAt ? new Date(shot.createdAt) : undefined,
      changeFrequency: "monthly",
      priority: 0.6,
    }));

  const countFor = (facet: string, value: string) =>
    facets[facet]?.find((f) => f.value === value)?.count ?? 0;

  // The SEO surfaces are flagged independently of the library, so each one is
  // checked on its own — a half-enabled configuration must never list a 404.
  const taxonomyUrls: MetadataRoute.Sitemap = !FEATURES.taxonomyPages
    ? []
    : TAXONOMY_GROUPS.flatMap((group) =>
        group.entries
          .filter((entry) => {
            // Skip taxonomy pages with nothing behind them — a thin page is worse
            // than no page.
            const [facet, values] = Object.entries(entry.filter)[0] ?? [];
            if (!facet || !values) return false;
            return values.some((value) => countFor(facet, value) >= MIN_SHOTS_FOR_INDEX);
          })
          .map((entry) => ({
            url: `${origin}/${group.segment}/${entry.slug}`,
            changeFrequency: "weekly" as const,
            priority: 0.8,
          }))
      );

  const tagUrls: MetadataRoute.Sitemap = !FEATURES.tagPages
    ? []
    : (facets.tags ?? [])
        .filter((tag) => tag.count >= MIN_SHOTS_FOR_INDEX)
        .slice(0, 120)
        .map((tag) => ({
          url: `${origin}/tags/${encodeURIComponent(tag.value)}`,
          changeFrequency: "weekly",
          priority: 0.5,
        }));

  const learn: MetadataRoute.Sitemap = !FEATURES.learnPages
    ? []
    : LEARN_TOPICS.map((topic) => ({
        url: `${origin}/learn/${topic}`,
        changeFrequency: "monthly",
        priority: 0.5,
      }));

  return [
    { url: origin, lastModified: new Date(), priority: 1 },
    { url: `${origin}/library`, lastModified: new Date(), priority: 0.9 },
    { url: `${origin}/upgrade`, priority: 0.4 },
    { url: `${origin}/terms`, priority: 0.2 },
    { url: `${origin}/privacy`, priority: 0.2 },
    ...taxonomyUrls,
    ...shotUrls,
    ...tagUrls,
    ...learn,
  ];
}
