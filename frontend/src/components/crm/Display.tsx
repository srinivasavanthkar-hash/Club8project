"use client";
/* Small display components shared by every screen: money, IDs, domain chips, stat tiles, page headers. */
import { Check, Copy } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { DEFAULT_BRAND } from "@/lib/brand";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Money: tabular, Indian grouping, negatives in danger colour with a minus sign (never brackets). */
export function Money({ value, currency = "INR", className, strong }: { value: string | null | undefined; currency?: string; className?: string; strong?: boolean }) {
  const negative = typeof value === "string" && value.trim().startsWith("-") && Number(value) !== 0;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", negative && "text-danger", strong && "font-semibold", className)}>
      {formatMoney(value, currency)}
    </span>
  );
}

/** IDs and references where character-level clarity matters. */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono tracking-tight", className)}>{children}</span>;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      className="inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-sunken hover:text-fg touch:size-11"
    >
      {done ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
    </button>
  );
}

const chip = "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium";

/** Seasons: Red / White / Blue. White keeps a visible border so it never disappears on white. */
export function SeasonChip({ code, name }: { code: string | null | undefined; name?: string }) {
  if (!code) return null;
  const c = code.toUpperCase();
  const label = name ?? `${c.charAt(0)}${c.slice(1).toLowerCase()} season`;
  return (
    <span
      className={cn(
        chip,
        c === "RED" && "bg-season-red-bg text-season-red",
        c === "BLUE" && "bg-season-blue-bg text-season-blue",
        c !== "RED" && c !== "BLUE" && "bg-surface text-fg ring-1 ring-inset ring-border-strong",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          c === "RED" && "bg-season-red", c === "BLUE" && "bg-season-blue",
          c !== "RED" && c !== "BLUE" && "bg-surface ring-1 ring-border-strong",
        )}
      />
      {label}
    </span>
  );
}

/** Resort categories: Classic -> Premium -> Supreme, increasing visual weight (outline -> subtle fill -> solid primary). */
export function CategoryChip({ code, name }: { code: string | null | undefined; name?: string }) {
  if (!code) return null;
  const c = code.toUpperCase();
  return (
    <span
      className={cn(
        chip,
        c === "SUPREME" ? "bg-primary text-fg-on-fill" : c === "PREMIUM" ? "bg-primary-subtle text-primary ring-1 ring-inset ring-primary/20" : "bg-surface text-fg-muted ring-1 ring-inset ring-border-strong/60",
      )}
    >
      {name ?? `${c.charAt(0)}${c.slice(1).toLowerCase()}`}
    </span>
  );
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn(chip, "bg-surface-sunken text-fg-muted", className)}>{children}</span>;
}

/** Compact stat tile: label, key figure, secondary line. Clickable when href is set. */
export function StatTile({
  label, value, sub, href, tone = "default", icon, className,
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: "default" | "warning" | "danger" | "success";
  icon?: React.ReactNode; className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        {icon && (
          <span aria-hidden className={cn(
            "[&_svg]:size-4",
            tone === "default" && "text-fg-subtle", tone === "warning" && "text-warning",
            tone === "danger" && "text-danger", tone === "success" && "text-success",
          )}>{icon}</span>
        )}
      </div>
      <div className={cn(
        "mt-1 text-xl font-semibold tabular-nums leading-7",
        tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-fg",
      )}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-fg-subtle">{sub}</div>}
    </>
  );
  const cls = cn(
    "relative block min-w-0 rounded-lg border border-border bg-surface px-4 py-3",
    tone === "danger" && "border-danger/30", tone === "warning" && "border-warning/30",
    href && "transition-colors hover:border-primary/40 hover:bg-primary-subtle/40",
    className,
  );
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Page title row: title (+ optional meta) and actions. */
/** Browser tab title "Page · Club8 CRM" (client pages cannot export metadata). */
export function usePageTitle(title: string | null | undefined) {
  React.useEffect(() => {
    if (title) document.title = `${title} · ${DEFAULT_BRAND.appName}`;
  }, [title]);
}

export function PageHeader({ title, meta, actions, description, docTitle }: { title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; description?: React.ReactNode; docTitle?: string }) {
  usePageTitle(docTitle ?? (typeof title === "string" ? title : null));
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold leading-7 sm:text-2xl sm:leading-8">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 text-base text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A link styled consistently (primary colour, underline on hover). */
export function TextLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("font-medium text-primary underline-offset-2 hover:underline", className)}>
      {children}
    </Link>
  );
}

/** Slim progress bar (e.g. EMI amount paid). */
export function Progress({ value, max, label, tone = "primary" }: { value: number; max: number; label: string; tone?: "primary" | "success" }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
      <div className={cn("h-full rounded-full", tone === "primary" ? "bg-primary" : "bg-success")} style={{ width: `${pct}%` }} />
    </div>
  );
}
