import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionBoard } from "@/components/collection-board";
import { CollectionSettings } from "@/components/collection-settings";
import { CreateCollectionButton } from "@/components/create-collection";
import { ExportMenu } from "@/components/export-menu";
import { ShareButton } from "@/components/share-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getCollection } from "@/lib/collections";
import { getAppUrl } from "@/lib/env";
import { getShare } from "@/lib/shares";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const collection = await getCollection({ id }, null);
  if (!collection) return { title: "Collection", robots: { index: false } };
  return {
    title: collection.name,
    description:
      collection.description ??
      `${collection.itemCount} cinematography reference shots collected in ShotBreakdown.`,
    alternates: { canonical: `${getAppUrl()}/collections/${collection.id}` },
    robots: collection.visibility === "public" ? undefined : { index: false, follow: false },
  };
}

export default async function CollectionPage({ params }: { params: Params }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const collection = await getCollection({ id }, user?.id ?? null);
  if (!collection) notFound();

  const isOwner = user !== null && collection.userId === user.id;
  const share = isOwner ? await getShare("collection", collection.id, user.id) : null;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main id="main" className="flex-1 w-full mx-auto max-w-[1400px] px-4 sm:px-6 py-6">
        <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-text-2">
          <Link href="/collections" className="hover:text-text-0">Collections</Link>
          {collection.ancestors.map((ancestor) => (
            <span key={ancestor.id} className="flex items-center gap-1.5">
              <span aria-hidden>/</span>
              <Link href={`/collections/${ancestor.id}`} className="hover:text-text-0">
                {ancestor.name}
              </Link>
            </span>
          ))}
          <span aria-hidden>/</span>
          <span className="text-text-1">{collection.name}</span>
        </nav>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[19px] font-medium text-text-0">{collection.name}</h1>
              <span className="mono rounded-[2px] border border-line px-1.5 py-0.5 text-[10px] uppercase text-text-3">
                {collection.kind}
              </span>
              {collection.visibility !== "private" ? (
                <span className="mono rounded-[2px] border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase text-accent">
                  {collection.visibility}
                </span>
              ) : null}
            </div>
            {collection.description ? (
              <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-1">
                {collection.description}
              </p>
            ) : null}
            <p className="mt-1 text-[12px] text-text-3">
              {collection.itemCount} shot{collection.itemCount === 1 ? "" : "s"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isOwner ? <CreateCollectionButton kind="collection" parentId={collection.id} label="Add sub-collection" /> : null}
            <ExportMenu resourceType="collection" resourceId={collection.id} />
            {isOwner ? (
              <ShareButton
                resourceType="collection"
                resourceId={collection.id}
                existingUrl={share ? `${getAppUrl()}/s/${share.token}` : null}
                visibility={collection.visibility}
              />
            ) : null}
          </div>
        </div>

        {collection.children.length > 0 ? (
          <section className="mb-6">
            <h2 className="eyebrow mb-2">Inside</h2>
            <ul className="flex flex-wrap gap-2">
              {collection.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={`/collections/${child.id}`}
                    className="inline-flex items-center gap-2 rounded-[3px] border border-line bg-ink-1 px-2.5 py-1.5 text-[12px] text-text-1 hover:border-line-strong hover:text-text-0"
                  >
                    {child.name}
                    <span className="mono text-[10px] text-text-3">{child.itemCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <CollectionBoard
          collectionId={collection.id}
          kind={collection.kind}
          items={collection.items}
          editable={isOwner}
        />

        {isOwner ? (
          <section className="mt-10 border-t border-line pt-6">
            <h2 className="eyebrow mb-3">Settings</h2>
            <CollectionSettings collection={collection} />
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
