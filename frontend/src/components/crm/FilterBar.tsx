"use client";
/* Filter bar above lists: the free-text search is always visible; the other filters sit beside it on desktop and
 * fold into a "Filters" disclosure on phones so results come first. */
import { SlidersHorizontal } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export function FilterBar({
  search, children, activeCount = 0, footer, className,
}: { search?: React.ReactNode; children?: React.ReactNode; activeCount?: number; footer?: React.ReactNode; className?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-3 sm:p-4", className)}>
      <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()} role="search">
        <div className="flex items-end gap-2">
          {search && <div className="min-w-0 flex-1 lg:max-w-sm">{search}</div>}
          {children && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-border-strong/60 px-3 text-base text-fg hover:bg-surface-sunken sm:hidden"
            >
              <SlidersHorizontal aria-hidden className="size-4" />Filters
              {activeCount > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-fg-on-fill">{activeCount}</span>}
            </button>
          )}
        </div>
        {children && (
          <div className={cn("grid grid-cols-1 gap-3 sm:grid sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6", open ? "grid" : "hidden")}>{children}</div>
        )}
      </form>
      {footer && <div className="mt-3 border-t border-border pt-3">{footer}</div>}
    </div>
  );
}
