import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShotTile } from "@/components/shot-tile";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getAppUrl } from "@/lib/env";
import { FEATURES } from "@/lib/features";
import { humanize } from "@/lib/filters";
import { searchShots, shotFacetCounts } from "@/lib/shots";
import { shotHref } from "@/lib/shot-format";
import { MIN_SHOTS_FOR_INDEX } from "@/lib/taxonomy";

export const revalidate = 3600;

type Params = Promise<{ tag: string }>;

export async function generateStaticParams() {
  // Nothing to prerender while the flag is off — every one of these pages 404s.
  if (!FEATURES.tagPages) return [];

  try {
    const facets = await shotFacetCounts({ scope: "public" });
    return (facets.tags ?? [])
      .filter((t) => t.count >= MIN_SHOTS_FOR_INDEX)
      .slice(0, 80)
      .map((t) => ({ tag: t.value }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (!FEATURES.tagPages) return { robots: { index: false, follow: false } };

  const { tag } = await params;
  const label = humanize(decodeURIComponent(tag));
  return {
    title: `${label} shots`,
    description: `Cinematography reference shots tagged ${label} — framing, lighting, colour and camera movement for each.`,
    alternates: { canonical: `${getAppUrl()}/tags/${tag}` },
  };
}

export default async function TagPage({ params }: { params: Params }) {
  if (!FEATURES.tagPages) notFound();

  const { tag } = await params;
  const decoded = decodeURIComponent(tag);
  if (!/^[a-z0-9-]{1,60}$/i.test(decoded)) notFound();

  const result = await searchShots({
    filters: { tags: [decoded] },
    limit: 48,
    scope: "public",
  });

  const facets = await shotFacetCounts({ scope: "public" });
  const relatedTags = (facets.tags ?? []).filter((t) => t.value !== decoded).slice(0, 16);
  const label = humanize(decoded);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      {result.total < MIN_SHOTS_FOR_INDEX ? (
        <meta name="robots" content="noindex, follow" />
      ) : null}
      <main id="main" className="flex-1 w-full mx-auto max-w-[1600px] px-4 sm:px-6 py-8">
        <nav aria-label="Breadcrumb" className="mb-3 text-[12px] text-text-2">
          <Link href="/library" className="hover:text-text-0">Library</Link>
          <span aria-hidden className="mx-1.5">/</span>
          <span className="text-text-1">Tags</span>
        </nav>

        <header className="mb-6 max-w-2xl">
          <h1 className="text-[22px] font-medium text-text-0">{label}</h1>
          <p className="mt-2 text-[13px] text-text-2">
            {result.total} shot{result.total === 1 ? "" : "s"} tagged {label.toLowerCase()}.
          </p>
        </header>

        {result.shots.length > 0 ? (
          <div className="shot-grid">
            {result.shots.map((shot, index) => (
              <ShotTile key={shot.id} shot={shot} href={shotHref(shot)} priority={index < 4} />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-text-2">No public shots carry this tag yet.</p>
        )}

        {relatedTags.length > 0 ? (
          <section className="mt-10 border-t border-line pt-5">
            <h2 className="eyebrow mb-3">Other tags</h2>
            <ul className="flex flex-wrap gap-1.5">
              {relatedTags.map((t) => (
                <li key={t.value}>
                  <Link
                    href={`/tags/${encodeURIComponent(t.value)}`}
                    className="inline-flex rounded-[3px] border border-line bg-ink-1 px-2 py-1 text-[11px] text-text-1 hover:border-line-strong hover:text-text-0"
                  >
                    {humanize(t.value)} <span className="ml-1 text-text-3">{t.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
