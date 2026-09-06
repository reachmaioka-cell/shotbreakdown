import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { ShotTile } from "@/components/shot-tile";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getAppUrl } from "@/lib/env";
import { FEATURES } from "@/lib/features";
import { searchShots, shotHref, type ShotSearchFilters } from "@/lib/shots";
import {
  MIN_SHOTS_FOR_INDEX,
  TAXONOMY_GROUPS,
  findTaxonomy,
  resolveRelated,
  taxonomyGroup,
} from "@/lib/taxonomy";

export const revalidate = 3600;

type Params = Promise<{ segment: string; slug: string }>;

export function generateStaticParams() {
  // Nothing to prerender while the flag is off — every one of these pages 404s.
  if (!FEATURES.taxonomyPages) return [];

  return TAXONOMY_GROUPS.flatMap((group) =>
    group.entries.map((entry) => ({ segment: group.segment, slug: entry.slug }))
  );
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (!FEATURES.taxonomyPages) return { robots: { index: false, follow: false } };

  const { segment, slug } = await params;
  const entry = findTaxonomy(segment, slug);
  if (!entry) return { title: "Not found", robots: { index: false } };

  const canonical = `${getAppUrl()}/${segment}/${slug}`;
  return {
    title: entry.title,
    description: entry.description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title: entry.title,
      description: entry.description,
      url: canonical,
    },
  };
}

export default async function TaxonomyPage({ params }: { params: Params }) {
  if (!FEATURES.taxonomyPages) notFound();

  const { segment, slug } = await params;
  const entry = findTaxonomy(segment, slug);
  const group = taxonomyGroup(segment);
  if (!entry || !group) notFound();

  // No cookie read here: taxonomy pages are public, identical for everyone, and
  // statically generated so they are fast for crawlers and first-time visitors.
  const result = await searchShots({
    filters: entry.filter as ShotSearchFilters,
    limit: 48,
    viewerId: null,
    scope: "public",
  });

  // A page with almost nothing on it is a doorway page, not a resource.
  const thin = result.total < MIN_SHOTS_FOR_INDEX;
  const related = resolveRelated(entry);
  const siblings = group.entries.filter((e) => e.slug !== slug).slice(0, 8);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      {thin ? <meta name="robots" content="noindex, follow" /> : null}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: entry.title,
          description: entry.description,
          url: `${getAppUrl()}/${segment}/${slug}`,
          about: { "@type": "Thing", name: entry.title },
        }}
      />

      <main id="main" className="flex-1 w-full mx-auto max-w-[1600px] px-4 sm:px-6 py-8">
        <nav aria-label="Breadcrumb" className="mb-3 text-[12px] text-text-2">
          <Link href="/library" className="hover:text-text-0">Library</Link>
          <span aria-hidden className="mx-1.5">/</span>
          <span className="text-text-1">{group.label}</span>
        </nav>

        <header className="mb-8 max-w-2xl">
          <h1 className="text-[24px] font-medium leading-tight text-text-0">{entry.title}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-text-1">{entry.explainer}</p>
          <p className="mt-3 text-[12px] text-text-3">
            {result.total} shot{result.total === 1 ? "" : "s"} in the library
          </p>
          <Link
            href={`/library?${new URLSearchParams(
              Object.entries(entry.filter).map(([k, v]) => [k, v.join(",")])
            ).toString()}`}
            className="mt-3 inline-flex h-9 items-center rounded-[3px] border border-line px-3 text-[13px] text-text-0 hover:border-line-strong hover:bg-ink-2"
          >
            Open in the library with filters
          </Link>
        </header>

        {result.shots.length > 0 ? (
          <div className="shot-grid">
            {result.shots.map((shot, index) => (
              <ShotTile
                key={shot.id}
                shot={shot}
                href={shotHref(shot)}
                priority={index < 4}
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-text-2">
            No public shots match this yet. The library grows as videos are analyzed.
          </p>
        )}

        <section className="mt-12 border-t border-line pt-6">
          <h2 className="eyebrow mb-3">Related</h2>
          <ul className="flex flex-wrap gap-2">
            {[...related, ...siblings.map((s) => ({ href: `/${segment}/${s.slug}`, title: s.title }))].map(
              (link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex rounded-[3px] border border-line bg-ink-1 px-2.5 py-1.5 text-[12px] text-text-1 hover:border-line-strong hover:text-text-0"
                  >
                    {link.title}
                  </Link>
                </li>
              )
            )}
          </ul>
        </section>

        <section className="mt-8 border-t border-line pt-6">
          <h2 className="eyebrow mb-3">Browse by</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TAXONOMY_GROUPS.filter((g) => g.segment !== segment).map((other) => (
              <div key={other.segment}>
                <p className="mb-1.5 text-[12px] text-text-1">{other.label}</p>
                <ul className="flex flex-col gap-1">
                  {other.entries.slice(0, 5).map((e) => (
                    <li key={e.slug}>
                      <Link
                        href={`/${other.segment}/${e.slug}`}
                        className="text-[12px] text-text-2 hover:text-text-0"
                      >
                        {e.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
