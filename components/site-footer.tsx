import Link from "next/link";
import { LEARN_META, LEARN_TOPICS } from "@/lib/learn";
import { TAXONOMY_GROUPS } from "@/lib/taxonomy";

export function SiteFooter({ tags }: { tags?: string[] }) {
  const browse = TAXONOMY_GROUPS.flatMap((group) =>
    group.entries.slice(0, 4).map((entry) => ({
      href: `/${group.segment}/${entry.slug}`,
      label: entry.title,
    }))
  ).slice(0, 12);

  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
        <div>
          <p className="eyebrow mb-3">ShotBreakdown</p>
          <p className="text-text-2 leading-relaxed max-w-xs">
            Turn any video into a searchable cinematography reference library.
          </p>
          <ul className="mt-4 flex flex-col gap-1.5">
            <li><Link href="/library" className="text-text-1 hover:text-text-0">Shot library</Link></li>
            <li><Link href="/upload" className="text-text-1 hover:text-text-0">Analyze a video</Link></li>
            <li><Link href="/upgrade" className="text-text-1 hover:text-text-0">Pricing</Link></li>
          </ul>
        </div>

        <div>
          <p className="eyebrow mb-3">Browse</p>
          <ul className="flex flex-col gap-1.5">
            {browse.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-text-1 hover:text-text-0">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="eyebrow mb-3">Learn</p>
          <ul className="flex flex-col gap-1.5">
            {LEARN_TOPICS.map((topic) => (
              <li key={topic}>
                <Link href={`/learn/${topic}`} className="text-text-1 hover:text-text-0">
                  {LEARN_META[topic].title}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="eyebrow mb-3">{tags?.length ? "Tags" : "Legal"}</p>
          <ul className="flex flex-col gap-1.5">
            {tags?.length
              ? tags.slice(0, 8).map((tag) => (
                  <li key={tag}>
                    <Link href={`/tags/${tag}`} className="text-text-1 hover:text-text-0">
                      {tag}
                    </Link>
                  </li>
                ))
              : null}
            <li><Link href="/terms" className="text-text-1 hover:text-text-0">Terms</Link></li>
            <li><Link href="/privacy" className="text-text-1 hover:text-text-0">Privacy</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-line px-4 sm:px-6 py-4">
        <p className="mx-auto max-w-[1600px] text-[11px] text-text-3">
          Camera, lens and lighting values are AI estimates from image analysis, not verified
          production data.
        </p>
      </div>
    </footer>
  );
}
