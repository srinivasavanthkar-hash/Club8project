"use client";
/* Table primitives: one look for every table in the app (sticky header, ~40px rows, hover, tabular figures).
 * Numeric / money columns are right-aligned with align="right". */
import * as React from "react";
import { cn } from "@/lib/utils";

export type Density = "comfortable" | "compact";
const DensityContext = React.createContext<Density>("comfortable");

export function Table({
  children, caption, className, density = "comfortable", stickyFirstColumn, maxHeight,
}: {
  children: React.ReactNode; caption?: string; className?: string; density?: Density; stickyFirstColumn?: boolean;
  maxHeight?: boolean;
}) {
  return (
    <DensityContext.Provider value={density}>
      {/* focusable, labelled region so keyboard users can scroll wide tables (WCAG 2.1.1) */}
      <div
        role="region"
        aria-label={caption}
        tabIndex={0}
        className={cn("scrollbar-thin relative w-full overflow-auto rounded-md border border-border bg-surface", maxHeight && "max-h-[70vh]", className)}
      >
        <table className={cn("w-full border-collapse text-base", stickyFirstColumn && "[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-10 [&_tbody_tr>*:first-child]:bg-surface")}>
          {caption && <caption className="sr-only">{caption}</caption>}
          {children}
        </table>
      </div>
    </DensityContext.Provider>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="sticky top-0 z-10 bg-surface-sunken">{children}</thead>;
}

export function Th({ children, align = "left", className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 whitespace-nowrap border-b border-border px-3 text-sm font-medium text-fg-muted",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function Tr({ children, className, tone, ...props }: React.HTMLAttributes<HTMLTableRowElement> & { tone?: "danger" | "warning" | "muted" | "highlight" }) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-0 transition-colors",
        tone === "danger" && "bg-danger-subtle/70", tone === "warning" && "bg-warning-subtle/60",
        tone === "muted" && "text-fg-subtle", tone === "highlight" && "bg-primary-subtle/60",
        props.onClick && "cursor-pointer hover:bg-primary-subtle/50 focus-visible:bg-primary-subtle/50",
        !props.onClick && !tone && "hover:bg-surface-sunken/50",
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function Td({ children, align = "left", className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  const density = React.useContext(DensityContext);
  return (
    <td
      className={cn(
        "px-3 align-middle text-fg [&_.tabular-nums]:whitespace-nowrap",
        density === "compact" ? "h-8 py-1 text-sm" : "h-10 py-2",
        align === "right" ? "text-right tabular-nums" : align === "center" ? "text-center" : "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}
