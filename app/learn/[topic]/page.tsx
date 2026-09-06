import { readFile } from "fs/promises";
import path from "path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ShotTile } from "@/components/shot-tile";
import { ArticleJsonLd } from "@/components/json-ld";
import { getAppUrl } from "@/lib/env";
import { FEATURES } from "@/lib/features";
import { isLearnTopic, LEARN_META, LEARN_TOPICS, type LearnTopic } from "@/lib/learn";
import { searchShots, shotFacetCounts } from "@/lib/shots";
import { shotHref } from "@/lib/shot-format";
import { renderMarkdown } from "@/lib/markdown";

export const revalidate = 600;

export function generateStaticParams() {
  // Nothing to prerender while the flag is off — every one of these pages 404s.
  if (!FEATURES.learnPages) return [];

  return LEARN_TOPICS.map((topic) => ({ topic }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  if (!FEATURES.learnPages) return { robots: { index: false, follow: false } };

  const { topic } = await params;
  if (!isLearnTopic(topic)) return { title: "Learn | ShotBreakdown" };
  const meta = LEARN_META[topic];
  const canonical = `${getAppUrl()}/learn/${topic}`;
  return {
    title: `${meta.title} | ShotBreakdown`,
    description: meta.description,
    alternates: { canonical },
    openGraph: { title: meta.title, description: meta.description, url: canonical },
  };
}

async function readGuide(topic: LearnTopic) {
  const file = path.join(process.cwd(), "content/learn", `${topic}.md`);
  return readFile(file, "utf8");
}

export default async function LearnPage({ params }: { params: Promise<{ topic: string }> }) {
  if (!FEATURES.learnPages) notFound();

  const { topic } = await params;
  if (!isLearnTopic(topic)) notFound();
  const meta = LEARN_META[topic];
  const md = await readGuide(topic);
  const [related, facets] = await Promise.all([
    searchShots({ filters: { tags: meta.relatedTags }, limit: 6, scope: "public" }),
    shotFacetCounts({ scope: "public" }),
  ]);
  const tags = (facets.tags ?? []).slice(0, 12).map((t) => t.value);
  const url = `${getAppUrl()}/learn/${topic}`;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <ArticleJsonLd title={meta.title} description={meta.description} url={url} />
      <main id="main" className="max-w-2xl mx-auto px-4 sm:px-6 py-10 w-full flex-1">
        {renderMarkdown(md)}
        {related.shots.length > 0 ? (
          <section className="mt-14 border-t border-line pt-6">
            <h2 className="eyebrow mb-3">Related shots</h2>
            <div className="shot-grid shot-grid-sm">
              {related.shots.map((shot) => (
                <ShotTile key={shot.id} shot={shot} href={shotHref(shot)} showMeta={false} sizes="200px" />
              ))}
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter tags={tags} />
    </div>
  );
}
