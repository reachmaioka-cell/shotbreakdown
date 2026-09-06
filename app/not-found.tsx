import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 sm:px-6 py-20">
        <p className="eyebrow mb-3">404</p>
        <h1 className="text-[22px] font-medium text-text-0">This page isn&apos;t here</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-text-1">
          It may have been deleted, or it may be private. Shots, videos and collections are only
          visible to their owner unless they have been shared or published.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-[3px] border border-line px-4 text-[13px] text-text-0 hover:border-line-strong hover:bg-ink-2"
          >
            Back to the start
          </Link>
          <Link
            href="/upload"
            className="inline-flex h-10 items-center rounded-[3px] bg-text-0 px-4 text-[13px] font-medium text-ink-0 hover:bg-white"
          >
            Break down a segment
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
