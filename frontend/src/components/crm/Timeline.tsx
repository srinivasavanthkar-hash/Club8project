"use client";
/* Vertical timeline: type icon on a coloured dot, timestamp, actor, one-line summary that expands. */
import { CalendarCheck, CircleDot, FileText, Flag, IndianRupee, Mail, MoonStar, Phone, StickyNote } from "lucide-react";
import * as React from "react";
import { formatDateTime, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimelineItem = { key: string; type: string; at: string; title: React.ReactNode; actor?: string | null; detail?: React.ReactNode };

const TYPES: Record<string, { icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; dot: string }> = {
  email: { icon: Mail, dot: "bg-info-subtle text-info" },
  call: { icon: Phone, dot: "bg-primary-subtle text-primary" },
  document: { icon: FileText, dot: "bg-surface-sunken text-fg-muted" },
  payment: { icon: IndianRupee, dot: "bg-success-subtle text-success" },
  reservation: { icon: CalendarCheck, dot: "bg-secondary/10 text-secondary" },
  entitlement: { icon: MoonStar, dot: "bg-primary-subtle text-primary" },
  status: { icon: Flag, dot: "bg-warning-subtle text-warning" },
  note: { icon: StickyNote, dot: "bg-surface-sunken text-fg-muted" },
};

export const TIMELINE_TYPES = Object.keys(TYPES);

export function Timeline({ items, empty = "Nothing recorded yet." }: { items: TimelineItem[]; empty?: string }) {
  if (!items.length) return <p className="py-4 text-center text-base text-fg-muted">{empty}</p>;
  return (
    <ol className="relative flex flex-col">
      {items.map((i, n) => {
        const t = TYPES[i.type] ?? { icon: CircleDot, dot: "bg-surface-sunken text-fg-muted" };
        const Icon = t.icon;
        return (
          <li key={i.key} className="relative flex gap-3 pb-4 last:pb-0">
            {n < items.length - 1 && <span aria-hidden className="absolute bottom-0 left-3.5 top-8 w-px bg-border" />}
            <span className={cn("relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full", t.dot)}>
              <Icon aria-hidden className="size-3.5" />
              <span className="sr-only">{humanize(i.type)}</span>
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-xs text-fg-subtle">
                <time dateTime={i.at} className="tabular-nums">{formatDateTime(i.at)}</time>
                {i.actor && <> · <span className="font-medium text-fg-muted">{i.actor}</span></>}
              </p>
              {i.detail ? (
                <details className="group">
                  <summary className="cursor-pointer list-none text-base text-fg marker:hidden [&::-webkit-details-marker]:hidden">
                    <span className="group-open:font-medium">{i.title}</span>
                    <span className="ml-1 text-xs text-primary group-open:hidden">Show</span>
                  </summary>
                  <div className="mt-1.5 text-sm text-fg-muted">{i.detail}</div>
                </details>
              ) : (
                <p className="break-words text-base text-fg">{i.title}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Filter chips for timeline types (multi-select). */
export function TypeChips({ types, selected, onChange }: { types: string[]; selected: string[]; onChange: (s: string[]) => void }) {
  return (
    <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1.5">
      {types.map((t) => {
        const on = selected.includes(t);
        const def = TYPES[t];
        const Icon = def?.icon ?? CircleDot;
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((x) => x !== t) : [...selected, t])}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-sm transition-colors touch:h-11",
              on ? "border-primary bg-primary-subtle font-medium text-primary" : "border-border bg-surface text-fg-muted hover:text-fg",
            )}
          >
            <Icon aria-hidden className="size-3.5" />{humanize(t)}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="h-7 px-2 text-sm text-primary hover:underline touch:h-11">Clear</button>
      )}
    </div>
  );
}
