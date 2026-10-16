"use client";
import { useQuery } from "@tanstack/react-query";
import { useCan } from "@/components/providers";
import { Card } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Member } from "@/lib/types";

type Version = { table: string; operation: string; changed_at: string; changed_by: string | null; reason: string | null; old: Record<string, unknown> | null; new: Record<string, unknown> | null };
type Activity = { seq: number; occurred_at: string; username: string | null; action: string; summary: string; changes: Record<string, [unknown, unknown]> | null; ip: string | null };

export function ChangeList({ changes }: { changes: Record<string, [unknown, unknown]> | null }) {
  if (!changes) return null;
  return (
    <ul className="ml-4 text-xs">
      {Object.entries(changes).map(([k, v]) => (
        <li key={k}><span className="font-medium">{k}</span>: <s className="text-muted-foreground">{JSON.stringify(Array.isArray(v) ? v[0] : null)}</s> → {JSON.stringify(Array.isArray(v) ? v[1] : v)}</li>
      ))}
    </ul>
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
    <div className="flex flex-col gap-4 pt-4">
      <Card title="Correction history (old → new values)">
        <ol className="text-sm">{versions.data?.map((v, i) => (
          <li key={i} className="border-t border-border py-2">
            <p>{formatDateTime(v.changed_at)} · {v.operation} {v.table}{v.reason ? ` · reason: ${v.reason}` : ""}</p>
            {v.operation !== "INSERT" && v.new && (
              <ChangeList changes={Object.fromEntries(Object.keys(v.new).map((k) => [k, [v.old?.[k] ?? null, v.new?.[k]]])) as Record<string, [unknown, unknown]>} />
            )}
          </li>
        ))}</ol>
      </Card>
      {can("auditlog.view") && (
        <Card title="Activity trail">
          <ol className="text-sm">{trail.data?.items.map((a) => (
            <li key={a.seq} className="border-t border-border py-2">
              <p>{formatDateTime(a.occurred_at)} · <span className="font-medium">{a.username ?? "system"}</span> · {a.action} · {a.summary}</p>
              <ChangeList changes={a.changes} />
            </li>
          ))}</ol>
        </Card>
      )}
    </div>
  );
}
