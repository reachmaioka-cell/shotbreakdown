"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type AccountMenuProps = {
  authed: boolean;
  isPro: boolean;
  isAdmin: boolean;
  displayName: string | null;
  email: string | null;
  /** Called when a menu item is followed, so a drawer hosting this can close. */
  onNavigate?: () => void;
};

/**
 * The account control that sits at the foot of the sidebar.
 *
 * Everything it renders arrives as props. The header this replaced fetched
 * /api/me from the client, which meant the avatar and the plan-dependent items
 * popped in a beat after the page did; the shell already knows who the user is
 * on the server, so there is nothing left to wait for.
 */
export function AccountMenu({
  authed,
  isPro,
  isAdmin,
  displayName,
  email,
  onNavigate,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on route change, without waiting for an effect round-trip.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // This menu can sit inside the sidebar drawer's <dialog>. Escape is a
      // close request the platform would otherwise spend on the dialog as
      // well, collapsing both layers at once; cancelling the key event leaves
      // the drawer standing so the next Escape closes it.
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A menu that opens on click should put the caret on its first item.
  useEffect(() => {
    if (!open) return;
    menuItems(menuRef.current)[0]?.focus();
  }, [open]);

  if (!authed) {
    return (
      <Link
        href="/auth/login"
        onClick={onNavigate}
        className="flex h-9 items-center rounded-[var(--radius)] px-2 text-[13px] text-text-1 hover:bg-ink-2 hover:text-text-0"
      >
        Sign in
      </Link>
    );
  }

  const name = displayName?.trim() || email?.trim() || "Account";
  const initial = name.charAt(0).toUpperCase() || "U";

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    const items = menuItems(menuRef.current);
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 text-left hover:bg-ink-2"
      >
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-ink-2 text-[11px] font-medium text-text-0"
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-text-1">{name}</span>
        <span aria-hidden className="text-[10px] text-text-3">
          {open ? "▾" : "▴"}
        </span>
        <span className="sr-only">Account menu</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          // The items are focus-managed (roving tabindex), so Tab walks out of
          // the menu rather than through it. An open menu the caret has already
          // left is a trap of its own kind, so leaving closes it.
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (!next || !containerRef.current?.contains(next)) setOpen(false);
          }}
          className="absolute bottom-full left-0 right-0 z-40 mb-1 rounded-[var(--radius)] border border-line bg-ink-1 py-1 shadow-xl shadow-black/50"
        >
          {email ? (
            <p className="truncate border-b border-line px-3 pb-1.5 pt-0.5 text-[11px] text-text-3">
              {email}
            </p>
          ) : null}
          <MenuLink href="/library?scope=saved" onNavigate={onNavigate}>
            Saved shots
          </MenuLink>
          <MenuLink href="/videos" onNavigate={onNavigate}>
            My segments
          </MenuLink>
          <MenuLink href="/collections" onNavigate={onNavigate}>
            Collections
          </MenuLink>
          <MenuLink href="/settings" onNavigate={onNavigate}>
            Settings
          </MenuLink>
          {isAdmin ? (
            <MenuLink href="/admin/review" onNavigate={onNavigate}>
              Admin
            </MenuLink>
          ) : null}
          {!isPro ? (
            <MenuLink href="/upgrade" onNavigate={onNavigate}>
              Upgrade
            </MenuLink>
          ) : null}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              role="menuitem"
              tabIndex={-1}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-text-2 hover:bg-ink-2 hover:text-text-0"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  onNavigate,
  children,
}: {
  href: string;
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      tabIndex={-1}
      onClick={onNavigate}
      className="block px-3 py-1.5 text-[13px] text-text-1 hover:bg-ink-2 hover:text-text-0"
    >
      {children}
    </Link>
  );
}

function menuItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}
