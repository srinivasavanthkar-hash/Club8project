"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, ShieldAlert, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Fragment, useState } from "react";
import { ClientSuspense } from "@/components/crm/ClientSuspense";
import { Mono, PageHeader } from "@/components/crm/Display";
import { FilterBar } from "@/components/crm/FilterBar";
import { PageSkeleton, TableSkeleton } from "@/components/crm/States";
import { Table, Td, Th, THead, Tr } from "@/components/crm/Table";
import { ChangeList } from "@/components/member/HistoryTab";
import { ErrorText, useCan, useStaff } from "@/components/providers";
import { Alert, Button, buttonClasses, Empty, Field, Input, Select } from "@/components/ui";
import { api, qs, type Page } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = { seq: number; occurred_at: string; username: string | null; action: string; entity_type: string | null; entity_ref: string | null; summary: string; changes: Record<string, [unknown, unknown]> | null; ip: string | null };

function Activity() {
  const sp = useSearchParams();
  const can = useCan();
  const staff = useStaff();
  const [f, setF] = useState({ user_id: "", date_from: "", date_to: "", action: "", entity_type: "", member_id: sp.get("member_id") ?? "" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { data, isLoading } = useQuery({ queryKey: ["activity", f, page], queryFn: () => api.get<Page<Row>>("/activity-log", { ...f, page, page_size: 50 }) });
  const verify = useMutation({ mutationFn: () => api.post<{ ok: boolean; checked: number; message: string; first_broken_seq: number | null }>("/activity-log/verify") });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const toggle = (seq: number) => setOpen((s) => { const n = new Set(s); if (n.has(seq)) n.delete(seq); else n.add(seq); return n; });
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;
  const active = Object.entries(f).filter(([k, v]) => k !== "action" && v).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="User activity log"
        description="Every sign-in, view of sensitive data, change and export, in a tamper-evident hash chain."
        meta={verify.data && (
          verify.data.ok
            ? <span className="inline-flex h-6 items-center gap-1 rounded-full bg-success-subtle px-2.5 text-sm font-medium text-success ring-1 ring-inset ring-success/25"><ShieldCheck aria-hidden className="size-4" />Verified ✓</span>
            : <span className="inline-flex h-6 items-center gap-1 rounded-full bg-danger px-2.5 text-sm font-medium text-fg-on-fill"><ShieldAlert aria-hidden className="size-4" />Integrity check failed</span>
        )}
        actions={
          <>
            {can("auditlog.verify") && <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}><ShieldCheck aria-hidden />{verify.isPending ? "Verifying…" : "Verify integrity"}</Button>}
            {can("export.run") && <a className={buttonClasses({ variant: "outline" })} href={`/api/v1/exports/activity-log?${qs({ ...f, fmt: "xlsx" })}`}><Download aria-hidden />Export Excel</a>}
          </>
        }
      />
      {verify.data && <Alert kind={verify.data.ok ? "success" : "error"}>{verify.data.ok ? `Hash chain intact (${verify.data.checked} entries).` : `Tampering detected at entry #${verify.data.first_broken_seq}: ${verify.data.message}`}</Alert>}
      <ErrorText error={verify.error} />
      <FilterBar
        activeCount={active}
        search={<Field label="Action" htmlFor="aa"><Input id="aa" data-list-filter value={f.action} onChange={set("action")} placeholder="e.g. PAYMENT" className="font-mono" /></Field>}
      >
        <Field label="User" htmlFor="au"><Select id="au" value={f.user_id} onChange={set("user_id")}><option value="">Anyone</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select></Field>
        <Field label="From" htmlFor="af"><Input id="af" type="date" value={f.date_from} onChange={set("date_from")} /></Field>
        <Field label="To" htmlFor="at"><Input id="at" type="date" value={f.date_to} onChange={set("date_to")} /></Field>
        <Field label="Entity" htmlFor="ae"><Input id="ae" value={f.entity_type} onChange={set("entity_type")} placeholder="e.g. members" className="font-mono" /></Field>
        <Field label="Member ID" htmlFor="am"><Input id="am" value={f.member_id} onChange={set("member_id")} className="font-mono" /></Field>
      </FilterBar>

      {isLoading ? <div className="rounded-lg border border-border bg-surface"><TableSkeleton rows={8} cols={6} /></div> : !data?.items.length ? (
        <div className="rounded-lg border border-dashed border-border bg-surface"><Empty>No activity matches these filters.</Empty></div>
      ) : (
        <Table caption="User activity log" density="compact" stickyFirstColumn maxHeight>
          <THead>
            <tr><Th align="right">#</Th><Th>When</Th><Th>User</Th><Th>Action</Th><Th>Entity</Th><Th>Summary</Th><Th>IP</Th><Th><span className="sr-only">Details</span></Th></tr>
          </THead>
          <tbody>{data.items.map((a) => {
            const isOpen = open.has(a.seq);
            const hasChanges = !!a.changes && Object.keys(a.changes).length > 0;
            return (
              <Fragment key={a.seq}>
                <Tr className={cn(isOpen && "bg-primary-subtle/40")}>
                  <Td align="right"><Mono className="text-fg-subtle">{a.seq}</Mono></Td>
                  <Td className="whitespace-nowrap tabular-nums">{formatDate(a.occurred_at)} <span className="text-fg-subtle">{formatTime(a.occurred_at)}</span></Td>
                  <Td className="whitespace-nowrap font-medium">{a.username ?? "system"}</Td>
                  <Td><Mono className="whitespace-nowrap rounded-sm bg-surface-sunken px-1 text-primary">{a.action}</Mono></Td>
                  <Td className="whitespace-nowrap text-fg-muted">{a.entity_type ?? "—"}{a.entity_ref ? <Mono className="ml-1 text-xs">{a.entity_ref.slice(0, 13)}</Mono> : ""}</Td>
                  <Td className="min-w-64">{a.summary}</Td>
                  <Td><Mono className="text-xs text-fg-subtle">{a.ip}</Mono></Td>
                  <Td align="right">
                    {hasChanges && (
                      <Button variant="ghost" size="sm" aria-expanded={isOpen} aria-controls={`chg-${a.seq}`} onClick={() => toggle(a.seq)}>
                        {isOpen ? "Hide changes" : `Changes (${Object.keys(a.changes!).length})`}
                      </Button>
                    )}
                  </Td>
                </Tr>
                {isOpen && (
                  <tr id={`chg-${a.seq}`} className="border-b border-border bg-surface-sunken/40">
                    <td colSpan={8} className="px-3 pb-3"><ChangeList changes={a.changes} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}</tbody>
        </Table>
      )}
      <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="tabular-nums text-fg-muted">{data?.total ?? 0} entries</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft aria-hidden />Previous</Button>
          <span className="tabular-nums text-fg-muted">Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={!data || page * 50 >= data.total} onClick={() => setPage(page + 1)}>Next<ChevronRight aria-hidden /></Button>
        </div>
      </nav>
    </div>
  );
}

export default function ActivityPage() {
  return <ClientSuspense fallback={<PageSkeleton />}><Activity /></ClientSuspense>;
}
