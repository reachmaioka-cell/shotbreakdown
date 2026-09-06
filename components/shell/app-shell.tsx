import type { ReactNode } from "react";
import { AppSidebar, SidebarDrawer } from "./app-sidebar";
import { MobileNav } from "./mobile-nav";

export type AppShellProps = {
  children: ReactNode;
  /** Page-specific rail content: the filter tree, the shot strip. */
  sidebar?: ReactNode;
  /** Page-specific top bar content: search, view switches, the page title. */
  topbar?: ReactNode;
  authed?: boolean;
  isPro?: boolean;
  isAdmin?: boolean;
  displayName?: string | null;
  email?: string | null;
};

/**
 * The application frame.
 *
 * A server component on purpose. Account state and feature flags are read on
 * the server and handed down as plain props, so nothing about the chrome waits
 * on a client fetch — and lib/features.ts, which is server-only, never has to
 * cross into a client bundle.
 *
 * The main region takes no max-width. The grids inside it are the product; a
 * centred column would leave a strip of empty ground either side of them.
 */
export function AppShell({
  children,
  sidebar,
  topbar,
  authed = false,
  isPro = false,
  isAdmin = false,
  displayName = null,
  email = null,
}: AppShellProps) {
  const user = { authed, isPro, isAdmin, displayName, email };

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-[var(--radius)] focus:bg-accent focus:px-3 focus:py-1.5 focus:text-[13px] focus:text-accent-ink"
      >
        Skip to content
      </a>

      {/*
        Two copies of the rail exist in the markup, but only ever one at a time
        in the accessibility tree: below lg this one is display:none, and at lg
        and up the drawer's copy is inside a closed <dialog>.
      */}
      <div className="fixed inset-y-0 left-0 z-30 hidden w-sidebar border-r border-line bg-ink-1 lg:block">
        <AppSidebar {...user}>{sidebar}</AppSidebar>
      </div>

      <div className="lg:pl-sidebar">
        <header className="sticky top-0 z-20 h-topbar border-b border-line bg-ink-0/90 backdrop-blur-sm">
          <div className="flex h-full items-center gap-3 px-3">
            <SidebarDrawer className="lg:hidden" {...user}>
              {sidebar}
            </SidebarDrawer>
            <div className="min-w-0 flex-1">{topbar}</div>
          </div>
        </header>

        {/*
          The bottom bar is fixed, so the last row of a grid needs room to clear
          it — the bar's own height plus the phone's home indicator.
        */}
        <main
          id="main"
          className="p-3 pb-[calc(var(--topbar-h)+env(safe-area-inset-bottom)+12px)] lg:pb-3"
        >
          {children}
        </main>
      </div>

      <MobileNav />
    </>
  );
}
