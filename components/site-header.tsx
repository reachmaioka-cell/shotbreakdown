"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Me = {
  authed: boolean;
  plan?: string;
  isPro?: boolean;
  isAdmin?: boolean;
  displayName?: string | null;
  email?: string | null;
};

const NAV = [
  { href: "/library", label: "Library" },
  { href: "/collections", label: "Collections" },
  { href: "/videos", label: "Videos" },
];

export function SiteHeader() {
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me")
      .then((res) => res.json())
      .then((data: Me) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the menu when the route changes, without an effect round-trip.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setMenuOpen(false);
  }

  const initial = (me?.displayName ?? me?.email ?? "U").trim().charAt(0).toUpperCase();

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-[3px] focus:bg-accent focus:px-3 focus:py-1.5 focus:text-[13px] focus:text-accent-ink"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-ink-0/90 backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 h-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="ShotBreakdown home">
              <span
                aria-hidden
                className="inline-block h-3.5 w-3.5 border border-accent"
                style={{
                  background:
                    "linear-gradient(135deg, var(--accent) 0 45%, transparent 45% 55%, var(--accent) 55% 100%)",
                }}
              />
              <span className="text-[13px] font-medium tracking-tight">ShotBreakdown</span>
            </Link>

            <nav aria-label="Main" className="hidden sm:flex items-center gap-1">
              {NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-[3px] px-2.5 py-1.5 text-[13px] transition-colors ${
                      active ? "text-text-0" : "text-text-2 hover:text-text-0"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/upload"
              className="inline-flex h-8 items-center rounded-[3px] bg-text-0 px-3 text-[12px] font-medium text-ink-0 hover:bg-white"
            >
              Break down a segment
            </Link>

            {me?.authed ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  aria-label="Account menu"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-ink-2 text-[11px] font-medium text-text-0 hover:border-line-strong"
                >
                  {initial}
                </button>
                {menuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-40 mt-1 w-44 rounded-[3px] border border-line bg-ink-1 py-1 shadow-xl shadow-black/50"
                  >
                    <MenuLink href="/library?scope=saved">Saved shots</MenuLink>
                    <MenuLink href="/videos">My videos</MenuLink>
                    <MenuLink href="/collections">Collections</MenuLink>
                    <MenuLink href="/settings">Settings</MenuLink>
                    {me.isAdmin ? <MenuLink href="/admin/review">Admin</MenuLink> : null}
                    {!me.isPro ? <MenuLink href="/upgrade">Upgrade</MenuLink> : null}
                    <form action="/auth/signout" method="post">
                      <button
                        type="submit"
                        role="menuitem"
                        className="block w-full px-3 py-1.5 text-left text-[13px] text-text-2 hover:bg-ink-2 hover:text-text-0"
                      >
                        Sign out
                      </button>
                    </form>
                  </div>
                ) : null}
              </div>
            ) : (
              <Link
                href="/auth/login"
                className="rounded-[3px] px-2.5 py-1.5 text-[13px] text-text-2 hover:text-text-0"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>

        <nav aria-label="Main (mobile)" className="sm:hidden flex items-center gap-1 border-t border-line px-4 py-1.5 overflow-x-auto no-scrollbar">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-[3px] px-2.5 py-1 text-[12px] ${
                pathname.startsWith(item.href) ? "bg-ink-2 text-text-0" : "text-text-2"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="block px-3 py-1.5 text-[13px] text-text-1 hover:bg-ink-2 hover:text-text-0"
    >
      {children}
    </Link>
  );
}
