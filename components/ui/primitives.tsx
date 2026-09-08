import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
/*
 * The hooks below are reached through the namespace instead of imported by
 * name, which is deliberate.
 *
 * This module is shared. Server pages import EmptyState, GridSkeleton and
 * LinkButton from it; client components import the interactive primitives at
 * the foot of the file. React's react-server build exports no useState,
 * useRef or useEffect at all, so naming them in an import would fail to
 * resolve the moment a server component imported anything from this file.
 * Read off the namespace, they are only touched when an interactive primitive
 * actually renders — which can only happen in the client graph, since every
 * one of them requires a callback prop a server component cannot pass.
 * Marking the whole file "use client" would fix the imports and break
 * buttonClass() for server callers instead.
 */
import * as React from "react";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-[3px] text-[13px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none";

const buttonVariants = {
  primary: "bg-text-0 text-ink-0 hover:bg-white",
  accent: "bg-accent text-accent-ink hover:brightness-110",
  ghost: "text-text-1 hover:text-text-0 hover:bg-ink-2",
  outline: "border border-line text-text-0 hover:border-line-strong hover:bg-ink-2",
  danger: "border border-line text-danger hover:bg-danger/10 hover:border-danger/50",
} as const;

const buttonSizes = {
  sm: "h-7 px-2.5 text-[12px]",
  md: "h-9 px-3.5",
  lg: "h-11 px-5 text-sm",
  icon: "h-8 w-8 px-0",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonSize = keyof typeof buttonSizes;

export function buttonClass(
  variant: ButtonVariant = "outline",
  size: ButtonSize = "md",
  extra = ""
): string {
  return `${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${extra}`.trim();
}

export function Button({
  variant = "outline",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function LinkButton({
  variant = "outline",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

/** A metadata chip. Compact by design — the grid is for frames, not prose. */
export function Pill({
  children,
  tone = "default",
  title,
}: {
  children: ReactNode;
  tone?: "default" | "muted" | "accent" | "estimated" | "danger" | "ok";
  title?: string;
}) {
  const tones = {
    default: "border-line bg-ink-2 text-text-1",
    muted: "border-transparent bg-ink-2 text-text-2",
    accent: "border-accent/40 bg-accent/10 text-accent",
    estimated: "border-dashed border-line-strong bg-transparent text-text-2",
    danger: "border-danger/40 bg-danger/10 text-danger",
    ok: "border-ok/40 bg-ok/10 text-ok",
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[11px] leading-4 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  value,
  estimated = false,
}: {
  label: string;
  value: ReactNode;
  estimated?: boolean;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-line/60 last:border-0">
      <span className="eyebrow shrink-0">{label}</span>
      <span className="text-[13px] text-text-0 text-right">
        {value}
        {estimated ? (
          <span className="ml-1.5 text-[10px] uppercase tracking-wider text-text-3">est</span>
        ) : null}
      </span>
    </div>
  );
}

export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 mb-3">
      <h2 className="eyebrow">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-line rounded-[3px] px-6 py-14 text-center">
      <p className="text-sm text-text-0">{title}</p>
      {body ? <p className="mt-1.5 text-[13px] text-text-2 max-w-sm mx-auto">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  body,
  action,
}: {
  title?: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="border border-danger/30 bg-danger/5 rounded-[3px] px-5 py-6 text-center"
    >
      <p className="text-sm text-text-0">{title}</p>
      {body ? <p className="mt-1.5 text-[13px] text-text-1">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-text-2 text-[13px]">
      <span
        aria-hidden
        className="inline-block h-3 w-3 rounded-full border border-line-strong border-t-text-0 animate-spin"
      />
      {label ? <span>{label}</span> : null}
      <span className="sr-only">Loading</span>
    </span>
  );
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="shot-grid" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton aspect-video rounded-[3px]" />
      ))}
    </div>
  );
}

/**
 * A modal built on the platform's <dialog>.
 *
 * showModal() is what makes this small: it puts the panel in the top layer,
 * makes the rest of the document inert so focus cannot escape, and closes on
 * Esc without a key listener. Every way out is funnelled through close(), so
 * the native close event is the one place that hands focus back to whatever
 * opened it — a programmatic close() does not restore focus on its own.
 *
 * Controlled: `open` drives it, `onClose` is called whenever the user or the
 * platform closes it, and the parent is expected to flip `open` in response.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const headingId = React.useId();

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      const active = document.activeElement;
      // <body> is what activeElement reports when nothing is focused — a dialog
      // opened on mount rather than by a click. Focusing it on close is not a
      // restore, it drops a screen reader at the top of the document, so the
      // opener is recorded as "none" instead and focus is left alone.
      openerRef.current =
        active instanceof HTMLElement && active !== document.body ? active : null;
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);

  function handleClose() {
    const opener = openerRef.current;
    openerRef.current = null;
    // Focus first, then tell the parent: the element is only focusable again
    // once the dialog has actually left the top layer, which it has by now.
    if (opener && opener.isConnected) opener.focus();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onClose={handleClose}
      onClick={(event) => {
        // The panel fills the dialog box edge to edge, so the box itself is
        // only ever the target when the click landed on the backdrop.
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="m-auto w-[min(560px,92vw)] rounded-[var(--radius)] border border-line bg-ink-1 p-0 text-text-0 shadow-2xl shadow-black/60 backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5">
        <h2 id={headingId} className="text-[13px] font-medium text-text-0">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius)] text-text-2 hover:bg-ink-2 hover:text-text-0"
        >
          <span aria-hidden>×</span>
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-4 py-4 text-[13px] text-text-1">
        {children}
      </div>
    </dialog>
  );
}

export type TabItem = { key: string; label: ReactNode };

/**
 * A tablist with automatic activation: arrows move the caret and select as
 * they go, which is the expected behaviour when switching a tab is cheap.
 * Only the selected tab is in the tab order, so Tab moves past the whole set
 * rather than through it.
 *
 * Children, when given, are rendered as the panel for the selected tab.
 */
export function Tabs({
  value,
  onChange,
  items,
  label,
  children,
}: {
  value: string;
  onChange: (key: string) => void;
  items: TabItem[];
  label?: string;
  children?: ReactNode;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const base = React.useId();
  const tabId = (key: string) => `${base}tab-${key}`;
  const panelId = (key: string) => `${base}panel-${key}`;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key) || items.length === 0) return;
    event.preventDefault();
    const current = Math.max(
      0,
      items.findIndex((item) => item.key === value)
    );
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowRight"
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
    const target = items[next];
    if (!target) return;
    onChange(target.key);
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }

  return (
    <>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex items-center gap-1 border-b border-line"
      >
        {items.map((item) => {
          const selected = item.key === value;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={tabId(item.key)}
              aria-selected={selected}
              // Only the selected tab's panel is rendered, so only the selected
              // tab may name one. Pointing an unselected tab at panelId(its own
              // key) would be a reference to an element that does not exist,
              // which a screen reader reports as a broken relationship.
              aria-controls={children && selected ? panelId(item.key) : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.key)}
              className={`-mb-px border-b px-2.5 py-1.5 text-[12px] transition-colors ${
                selected
                  ? "border-accent text-text-0"
                  : "border-transparent text-text-2 hover:text-text-0"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {children ? (
        <div
          role="tabpanel"
          id={panelId(value)}
          aria-labelledby={tabId(value)}
          tabIndex={0}
          className="pt-3"
        >
          {children}
        </div>
      ) : null}
    </>
  );
}

/**
 * One row of the filter rail. The label wraps the input, so the whole row is
 * the hit target and the count is read as part of the name — "Wide, 128" is
 * more use to a screen reader than "Wide" with the number stranded beside it.
 */
export function Checkbox({
  label,
  checked,
  onChange,
  count,
  disabled = false,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  count?: number;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 rounded-[var(--radius)] px-2 py-1 text-[12px] ${
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-ink-2"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-accent"
      />
      <span className={`min-w-0 flex-1 truncate ${checked ? "text-text-0" : "text-text-1"}`}>
        {label}
      </span>
      {typeof count === "number" ? (
        <span className="shrink-0 tabular-nums text-[11px] text-text-3">
          {count.toLocaleString()}
        </span>
      ) : null}
    </label>
  );
}
