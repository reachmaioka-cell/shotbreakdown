import { GridSkeleton } from "@/components/ui/primitives";
import { SiteHeader } from "@/components/site-header";

/**
 * The library is a dynamic route doing three database round-trips per
 * navigation, so a filter click otherwise looks like nothing happened.
 */
export default function LibraryLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="w-full flex-1">
        <div className="border-b border-line">
          <div className="mx-auto flex max-w-[1600px] gap-3 px-4 py-4 sm:px-6">
            <div className="h-10 w-full max-w-2xl rounded-[3px] border border-line bg-ink-1" />
          </div>
        </div>
        <div className="mx-auto flex max-w-[1600px] gap-8 px-4 py-5 sm:px-6">
          <aside className="hidden w-56 shrink-0 lg:block">
            <div className="flex flex-col gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                  <div className="skeleton mb-2 h-2 w-20 rounded-[2px]" />
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <div key={j} className="skeleton h-6 w-16 rounded-[3px]" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
          <div className="min-w-0 flex-1">
            <div className="skeleton mb-3 h-3 w-24 rounded-[2px]" />
            <GridSkeleton count={18} />
          </div>
        </div>
      </main>
    </div>
  );
}
