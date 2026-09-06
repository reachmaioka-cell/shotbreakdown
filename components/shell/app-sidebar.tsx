"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountMenu } from "./account-menu";

/**
 * The three surfaces of the product, named for what the user made rather than
 * for the tables underneath: a segment is what they uploaded, a shot is what
 * came back, a collection is what they kept.
 */
export const SHELL_NAV = [
  { href: "/videos", label: "Segments" },
  { href: "/library", label: "Shots" },
  { href: "/collections", label: "Collections" },
] as const;

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type SidebarUser = {
  authed: boolean;
  isPro: boolean;
  isAdmin: boolean;
  displayName: string | null;
  email: string | null;
};

export function Wordmark({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex shrink-0 items-center gap-2"
      aria-label="ShotBreakdown home"
    >
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
  );
}

/**
 * The rail. Fixed chrome at the top (wordmark, the three destinations, the one
 * action that matters), the page's own controls in the middle on their own
 * scroll, the account at the foot. The middle scrolls alone so a long filter
 * tree never pushes the account out of reach.
 */
export function AppSidebar({
  children,
  authed,
  isPro,
  isAdmin,
  displayName,
  email,
  onNavigate,
}: SidebarUser & { children?: React.ReactNode; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col bg-ink-1">
      <div className="flex h-topbar shrink-0 items-center border-b border-line px-3">
        <Wordmark onNavigate={onNavigate} />
      </div>

      <nav aria-label="Main" className="shrink-0 px-2 pt-2">
        <ul className="flex flex-col gap-0.5">
          {SHELL_NAV.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-8 items-center rounded-[var(--radius)] px-2 text-[13px] transition-colors ${
                    active
                      ? "bg-ink-2 text-text-0"
                      : "text-text-2 hover:bg-ink-2 hover:text-text-0"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="shrink-0 p-2">
        <Link
          href="/upload"
          onClick={onNavigate}
          className="flex h-8 w-full items-center justify-center rounded-[var(--radius)] bg-accent text-[12px] font-medium text-accent-ink transition-[filter] hover:brightness-110"
        >
          Upload a segment
        </Link>
      </div>

      {children ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line">
          {children}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="shrink-0 border-t border-line p-2">
        <AccountMenu
          authed={authed}
          isPro={isPro}
          isAdmin={isAdmin}
          displayName={displayName}
          email={email}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

/**
 * Below the sidebar breakpoint the same rail lives in a modal drawer.
 *
 * A real <dialog> opened with showModal() is what buys the behaviour for free:
 * Esc closes it, the rest of the page goes inert so focus cannot wander out,
 * and the top layer means no z-index arithmetic. Every close path is routed
 * through el.close() so the native close event is the single place that puts
 * focus back on the button that opened it.
 */
export function SidebarDrawer({
  children,
  className = "",
  authed,
  isPro,
  isAdmin,
  displayName,
  email,
}: SidebarUser & { children?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // A drawer that survives a navigation would cover the page it just opened.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  return (
    <div className={className}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] border border-line bg-ink-1 text-text-1 hover:border-line-strong hover:text-text-0"
      >
        <span aria-hidden className="flex flex-col gap-[3px]">
          <span className="block h-px w-3.5 bg-current" />
          <span className="block h-px w-3.5 bg-current" />
          <span className="block h-px w-3.5 bg-current" />
        </span>
        <span className="sr-only">Menu</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Menu"
        onClose={() => {
          setOpen(false);
          buttonRef.current?.focus();
        }}
        onClick={(event) => {
          // Clicks that land on the dialog box itself are backdrop clicks: the
          // panel fills it edge to edge, so nothing else can be the target.
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-0 h-dvh max-h-none w-[min(var(--sidebar-w),85vw)] max-w-none border-r border-line bg-ink-1 p-0 text-text-0 backdrop:bg-black/70"
      >
        {/*
          Mounted only while the drawer is open. The rail already exists once in
          the layout; rendering a second copy here at all times would mount the
          page's sidebar slot twice on every page — running its effects and its
          fetches twice, forking its state across the breakpoint, and duplicating
          any id inside it. React commits these children before the effect calls
          showModal(), so the dialog is never opened empty.
        */}
        {open ? (
          <AppSidebar
            authed={authed}
            isPro={isPro}
            isAdmin={isAdmin}
            displayName={displayName}
            email={email}
            onNavigate={() => dialogRef.current?.close()}
          >
            {children}
          </AppSidebar>
        ) : null}
      </dialog>
    </div>
  );
}
