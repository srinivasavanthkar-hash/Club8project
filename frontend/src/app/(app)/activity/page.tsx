"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChangeList } from "@/components/member/HistoryTab";
import { ErrorText, useCan, useStaff } from "@/components/providers";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { api, qs, type Page } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Row = { seq: number; occurred_at: string; username: string | null; action: string; entity_type: string | null; entity_ref: string | null; summary: string; changes: Record<string, [unknown, unknown]> | null; ip: string | null };

function Activity() {
  const sp = useSearchParams();
  const can = useCan();
  const staff = useStaff();
  const [f, setF] = useState({ user_id: "", date_from: "", date_to: "", action: "", entity_type: "", member_id: sp.get("member_id") ?? "" });
  const [page, setPage] = useState(1);
  const { data } = useQuery({ queryKey: ["activity", f, page], queryFn: () => api.get<Page<Row>>("/activity-log", { ...f, page, page_size: 50 }) });
  const verify = useMutation({ mutationFn: () => api.post<{ ok: boolean; checked: number; message: string; first_broken_seq: number | null }>("/activity-log/verify") });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">User activity log</h1>
        <div className="flex gap-2">
          {can("auditlog.verify") && <Button variant="outline" onClick={() => verify.mutate()}>Verify integrity</Button>}
          {can("export.run") && <a className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm" href={`/api/v1/exports/activity-log?${qs({ ...f, fmt: "xlsx" })}`}>Export Excel</a>}
        </div>
      </div>
      {verify.data && <Alert kind={verify.data.ok ? "success" : "error"}>{verify.data.ok ? `Hash chain intact (${verify.data.checked} entries).` : `Tampering detected at entry #${verify.data.first_broken_seq}: ${verify.data.message}`}</Alert>}
      <ErrorText error={verify.error} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <Field label="User" htmlFor="au"><Select id="au" value={f.user_id} onChange={set("user_id")}><option value="">All</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select></Field>
        <Field label="From" htmlFor="af"><Input id="af" type="date" value={f.date_from} onChange={set("date_from")} /></Field>
        <Field label="To" htmlFor="at"><Input id="at" type="date" value={f.date_to} onChange={set("date_to")} /></Field>
        <Field label="Action" htmlFor="aa"><Input id="aa" value={f.action} onChange={set("action")} placeholder="e.g. PAYMENT" /></Field>
        <Field label="Entity" htmlFor="ae"><Input id="ae" value={f.entity_type} onChange={set("entity_type")} placeholder="e.g. members" /></Field>
        <Field label="Member ID" htmlFor="am"><Input id="am" value={f.member_id} onChange={set("member_id")} /></Field>
      </div>
      <Card>
        <ol className="text-sm">{data?.items.map((a) => (
          <li key={a.seq} className="border-t border-border py-2">
            <p><span className="text-muted-foreground">#{a.seq} {formatDateTime(a.occurred_at)}</span> · <span className="font-medium">{a.username ?? "system"}</span> · {a.action} · {a.summary} <span className="text-xs text-muted-foreground">{a.ip}</span></p>
            <ChangeList changes={a.changes} />
          </li>
        ))}</ol>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} · {data?.total ?? 0} entries</span>
          <Button size="sm" variant="outline" disabled={!data || page * 50 >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </Card>
    </div>
  );
}

export default function ActivityPage() {
  return <Suspense><Activity /></Suspense>;
}
