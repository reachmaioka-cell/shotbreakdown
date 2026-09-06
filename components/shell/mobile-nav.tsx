"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, SHELL_NAV } from "./app-sidebar";

const ITEMS = [...SHELL_NAV, { href: "/upload", label: "Upload" }] as const;

/**
 * The phone's version of the rail: the same destinations, plus the upload
 * action the sidebar carries as a button, within thumb reach at the bottom of
 * the screen. Hidden once the fixed sidebar appears.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      // The home indicator on a modern phone sits inside the viewport; without
      // the inset the last row of labels ends up underneath it.
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-topbar items-center justify-center text-[12px] transition-colors ${
                  active ? "text-accent" : "text-text-2 hover:text-text-0"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
