import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreateCollectionButton } from "@/components/create-collection";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { EmptyState } from "@/components/ui/primitives";
import { buildTree, listCollections, type CollectionNode } from "@/lib/collections";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Collections",
  robots: { index: false, follow: false },
};

function CollectionCard({ node }: { node: CollectionNode }) {
  return (
    <li>
      <Link href={`/collections/${node.id}`} className="group block">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] bg-ink-2" style={{ aspectRatio: "16 / 10" }}>
          {node.previewUrls.length > 0 ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="relative bg-ink-2">
                {node.previewUrls[i] ? (
                  <Image
                    src={node.previewUrls[i]}
                    alt=""
                    fill
                    sizes="160px"
                    className="object-cover transition-opacity group-hover:opacity-90"
                  />
                ) : null}
              </div>
            ))
          ) : (
            <div className="col-span-2 flex items-center justify-center text-[11px] text-text-3">
              Empty
            </div>
          )}
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <p className="truncate text-[13px] text-text-0 group-hover:text-accent">{node.name}</p>
          <span className="mono shrink-0 text-[10px] text-text-3">
            {node.kind === "sequence" ? "SEQ" : node.itemCount}
          </span>
        </div>
        {node.description ? (
          <p className="mt-0.5 line-clamp-1 text-[12px] text-text-2">{node.description}</p>
        ) : null}
      </Link>

      {node.children.length > 0 ? (
        <ul className="mt-2 ml-3 flex flex-col gap-1 border-l border-line pl-3">
          {node.children.map((child) => (
            <li key={child.id}>
              <Link
                href={`/collections/${child.id}`}
                className="flex items-baseline justify-between gap-2 py-0.5 text-[12px] text-text-1 hover:text-text-0"
              >
                <span className="truncate">{child.name}</span>
                <span className="mono text-[10px] text-text-3">
                  {child.kind === "sequence" ? "SEQ" : child.itemCount}
                </span>
              </Link>
              {child.children.length > 0 ? (
                <ul className="ml-2 border-l border-line pl-2">
                  {child.children.map((grandchild) => (
                    <li key={grandchild.id}>
                      <Link
                        href={`/collections/${grandchild.id}`}
                        className="block truncate py-0.5 text-[12px] text-text-2 hover:text-text-0"
                      >
                        {grandchild.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default async function CollectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/collections");

  const collections = await listCollections(user.id);
  const tree = buildTree(collections);
  const sequences = tree.filter((n) => n.kind === "sequence");
  const decks = tree.filter((n) => n.kind === "collection");

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main id="main" className="flex-1 w-full mx-auto max-w-[1400px] px-4 sm:px-6 py-8">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-[17px] font-medium text-text-0">Collections</h1>
            <p className="mt-1 text-[13px] text-text-2">
              Decks for references you want to keep. Sequences for shots in a deliberate order.
            </p>
          </div>
          <div className="flex gap-2">
            <CreateCollectionButton kind="collection" />
            <CreateCollectionButton kind="sequence" />
          </div>
        </div>

        {collections.length === 0 ? (
          <EmptyState
            title="No collections yet"
            body="Save a shot from the library and add it to a new collection, or create one here."
          />
        ) : (
          <div className="flex flex-col gap-10">
            {decks.length > 0 ? (
              <section>
                <h2 className="eyebrow mb-3">Collections</h2>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {decks.map((node) => (
                    <CollectionCard key={node.id} node={node} />
                  ))}
                </ul>
              </section>
            ) : null}

            {sequences.length > 0 ? (
              <section>
                <h2 className="eyebrow mb-3">Sequences</h2>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {sequences.map((node) => (
                    <CollectionCard key={node.id} node={node} />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
