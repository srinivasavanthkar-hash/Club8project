"use client";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Mono } from "@/components/crm/Display";
import { TableSkeleton } from "@/components/crm/States";
import { useCan } from "@/components/providers";
import { Card, Empty } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Member } from "@/lib/types";
import { cn } from "@/lib/utils";

type Version = { table: string; operation: string; changed_at: string; changed_by: string | null; reason: string | null; old: Record<string, unknown> | null; new: Record<string, unknown> | null };
type Activity = { seq: number; occurred_at: string; username: string | null; action: string; summary: string; changes: Record<string, [unknown, unknown]> | null; ip: string | null };

function DiffValue({ value, tone }: { value: unknown; tone: "old" | "new" }) {
  const [open, setOpen] = useState(false);
  const text = value === null || value === undefined ? "—" : JSON.stringify(value);
  const long = text.length > 80;
  return (
    <span className={cn("block rounded-sm px-1.5 py-0.5 font-mono text-xs", tone === "old" ? "bg-danger-subtle text-fg" : "bg-success-subtle text-fg")}>
      <span className={cn("break-all", long && !open && "line-clamp-2")}>{text}</span>
      {long && <button type="button" onClick={() => setOpen(!open)} className="ml-1 font-sans font-medium text-primary hover:underline">{open ? "less" : "more"}</button>}
    </span>
  );
}

/** Audit diff: field / old / new. Old values on danger-subtle, new on success-subtle. Values are shown as stored (JSON). */
export function ChangeList({ changes }: { changes: Record<string, [unknown, unknown]> | null }) {
  if (!changes || !Object.keys(changes).length) return null;
  return (
    <div role="region" aria-label="Changed fields" tabIndex={0} className="mt-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-sunken">
          <tr>
            <th scope="col" className="w-40 px-2 py-1 text-left text-xs font-medium text-fg-muted">Field</th>
            <th scope="col" className="px-2 py-1 text-left text-xs font-medium text-fg-muted">Old</th>
            <th scope="col" className="px-2 py-1 text-left text-xs font-medium text-fg-muted">New</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(changes).map(([k, v]) => (
            <tr key={k} className="border-t border-border align-top">
              <th scope="row" className="px-2 py-1 text-left font-mono text-xs font-medium text-fg">{k}</th>
              <td className="px-2 py-1"><DiffValue value={Array.isArray(v) ? v[0] : null} tone="old" /></td>
              <td className="px-2 py-1"><DiffValue value={Array.isArray(v) ? v[1] : v} tone="new" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One audit line; the text keeps the "time · user · ACTION · summary" shape used in exports and support tickets. */
export function ActivityLine({ a }: { a: { occurred_at: string; username: string | null; action: string; summary: string; ip?: string | null } }) {
  return (
    <p className="text-base">
      <span className="tabular-nums text-fg-subtle">{formatDateTime(a.occurred_at)}</span>
      {" · "}<span className="font-medium text-fg">{a.username ?? "system"}</span>
      {" · "}<Mono className="rounded-sm bg-surface-sunken px-1 text-sm text-primary">{a.action}</Mono>
      {" · "}<span className="text-fg">{a.summary}</span>
      {a.ip && <span className="ml-1 text-xs text-fg-subtle">{a.ip}</span>}
    </p>
  );
}

export function HistoryTab({ member }: { member: Member }) {
  const can = useCan();
  const versions = useQuery({ queryKey: ["history", member.id], queryFn: () => api.get<Version[]>(`/members/${member.id}/history`) });
  const trail = useQuery({
    queryKey: ["trail", member.id],
    queryFn: () => api.get<Page<Activity>>("/activity-log", { member_id: member.id, page_size: 200 }),
    enabled: can("auditlog.view"),
  });
  return (
    <div className="grid gap-4 pt-1 xl:grid-cols-2">
      <Card title="Correction history" description="Old and new values for every change to this membership record.">
        {!versions.data ? <TableSkeleton rows={3} cols={2} /> : versions.data.length === 0 ? <Empty>No changes recorded.</Empty> : (
          <ol className="flex flex-col divide-y divide-border">{versions.data.map((v, i) => (
            <li key={i} className="py-3 first:pt-0">
              <p className="text-base">
                <span className="tabular-nums text-fg-subtle">{formatDateTime(v.changed_at)}</span> · <span className="font-medium">{v.operation}</span> <Mono className="text-sm text-fg-muted">{v.table}</Mono>
                {v.reason && <span className="text-fg-muted"> · reason: {v.reason}</span>}
              </p>
              {v.operation !== "INSERT" && v.new && (
                <ChangeList changes={Object.fromEntries(Object.keys(v.new).map((k) => [k, [v.old?.[k] ?? null, v.new?.[k]]])) as Record<string, [unknown, unknown]>} />
              )}
            </li>
          ))}</ol>
        )}
      </Card>
      {can("auditlog.view") && (
        <Card
          title="Activity trail"
          actions={<Link className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={`/activity?member_id=${member.id}`}>Full activity log<ExternalLink aria-hidden className="size-3.5" /></Link>}
        >
          {!trail.data ? <TableSkeleton rows={4} cols={2} /> : trail.data.items.length === 0 ? <Empty>No activity recorded.</Empty> : (
            <ol className="flex flex-col divide-y divide-border">{trail.data.items.map((a) => (
              <li key={a.seq} className="py-2.5 first:pt-0">
                <ActivityLine a={a} />
                <ChangeList changes={a.changes} />
              </li>
            ))}</ol>
          )}
        </Card>
      )}
    </div>
  );
}
