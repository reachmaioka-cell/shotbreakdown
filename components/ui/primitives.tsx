import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

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
  tone?: "default" | "muted" | "accent" | "estimated";
  title?: string;
}) {
  const tones = {
    default: "border-line bg-ink-2 text-text-1",
    muted: "border-transparent bg-ink-2 text-text-2",
    accent: "border-accent/40 bg-accent/10 text-accent",
    estimated: "border-dashed border-line-strong bg-transparent text-text-2",
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
