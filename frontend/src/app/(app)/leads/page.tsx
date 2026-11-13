"use client";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/crm/DataTable";
import { Mono, PageHeader } from "@/components/crm/Display";
import { FilterBar } from "@/components/crm/FilterBar";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { useCan, useMaster, useStaff } from "@/components/providers";
import { SavedSearches } from "@/components/SavedSearches";
import { buttonClasses, Checkbox, Field, Input, Select } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { daysFromToday, formatDate, formatPhoneMasked, formatRelativeDays, humanize } from "@/lib/format";
import type { Lead } from "@/lib/types";
import { useListState } from "@/lib/useListState";
import { cn } from "@/lib/utils";

const STATUSES = ["NEW", "CONTACTED", "PRESENTATION_SCHEDULED", "ATTENDED", "NOT_INTERESTED", "CONVERTED"];
const OPEN_STATUSES = new Set(["NEW", "CONTACTED", "PRESENTATION_SCHEDULED", "ATTENDED"]);

function followUpTone(l: Lead): "danger" | "warning" | undefined {
  if (!l.follow_up_date || !OPEN_STATUSES.has(l.status)) return undefined;
  const d = daysFromToday(l.follow_up_date) ?? 1;
  return d < 0 ? "danger" : d === 0 ? "warning" : undefined;
}

const columns: ColumnDef<Lead, unknown>[] = [
  { header: "Lead ID", accessorKey: "lead_number", cell: (c) => <Mono className="font-medium">{c.getValue() as string}</Mono>, meta: { sortKey: "lead_number", mobile: "subtitle", hideable: false } },
  { header: "Entry", accessorKey: "entry_date", cell: (c) => formatDate(c.getValue() as string), meta: { sortKey: "entry_date", mobile: "hidden" } },
  { header: "Prospect", accessorKey: "prospect_name", cell: (c) => <span className="font-medium">{c.getValue() as string}</span>, meta: { sortKey: "prospect_name", mobile: "title", hideable: false } },
  { header: "Mobile", accessorKey: "mobile", cell: (c) => <span className="tabular-nums">{formatPhoneMasked(c.getValue() as string)}</span>, meta: { mobile: "field" } },
  { header: "City", accessorKey: "city", meta: { mobile: "hidden" } },
  { header: "OPC", accessorKey: "opc_name", meta: { mobile: "hidden" } },
  {
    header: "Follow-up",
    accessorKey: "follow_up_date",
    cell: (c) => {
      const l = c.row.original;
      const tone = followUpTone(l);
      return l.follow_up_date ? (
        <span className="flex flex-col leading-tight">
          <span className="tabular-nums">{formatDate(l.follow_up_date)}</span>
          {tone && <span className={cn("text-xs font-medium", tone === "danger" ? "text-danger" : "text-warning")}>{formatRelativeDays(l.follow_up_date, "overdue")}</span>}
        </span>
      ) : "—";
    },
    meta: { sortKey: "follow_up_date", mobile: "field" },
  },
  { header: "Status", accessorKey: "status", cell: (c) => <StatusBadge status={c.getValue() as string} />, meta: { sortKey: "status", mobile: "badge", hideable: false } },
];

export default function LeadsPage() {
  const router = useRouter();
  const can = useCan();
  const venues = useMaster("venues");
  const staff = useStaff();
  const s = useListState("leads", { q: "", status: "", venue_id: "", opc: "", salesperson_id: "", date_from: "", date_to: "", follow_up_due: false });
  const params = { ...s.filters, follow_up_due: s.filters.follow_up_due || undefined };
  const { data, isLoading } = useQuery({
    queryKey: ["leads", s.filters, s.page, s.sort],
    queryFn: () => api.get<Page<Lead>>("/leads", { ...params, page: s.page, page_size: 25, sort: s.sort }),
  });
  // Status chip counts: same filters, one status each (page_size 1, only `total` is used).
  const counts = useQueries({
    queries: STATUSES.map((st) => ({
      queryKey: ["leads-count", { ...s.filters, status: st }],
      queryFn: () => api.get<Page<Lead>>("/leads", { ...params, status: st, page: 1, page_size: 1 }),
      staleTime: 30_000,
    })),
  });
  const active = ["venue_id", "opc", "salesperson_id", "date_from", "date_to"].filter((k) => s.filters[k as keyof typeof s.filters]).length + (s.filters.follow_up_due ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Leads"
        description="Street leads from venues and OPCs, from first contact to conversion."
        actions={can("lead.create") && <Link href="/leads/new" className={buttonClasses()}><Plus aria-hidden />New lead</Link>}
      />
      <div role="group" aria-label="Filter by status" className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {[{ st: "", label: "All" }, ...STATUSES.map((st) => ({ st, label: humanize(st) }))].map(({ st, label }, i) => {
          const selected = s.filters.status === st;
          const n = st ? counts[i - 1]?.data?.total : undefined;
          return (
            <button
              key={st || "all"}
              type="button"
              aria-pressed={selected}
              onClick={() => s.update({ status: st })}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors touch:h-11",
                selected ? "border-primary bg-primary text-fg-on-fill" : "border-border bg-surface text-fg-muted hover:border-primary/40 hover:text-fg",
              )}
            >
              {label}
              {n !== undefined && <span className={cn("rounded-full px-1.5 text-xs tabular-nums", selected ? "bg-surface/20" : "bg-surface-sunken")}>{n}</span>}
            </button>
          );
        })}
      </div>
      <FilterBar
        activeCount={active}
        search={
          <Field label="Search" htmlFor="lq">
            <Input id="lq" data-list-filter type="search" placeholder="Name, lead ID, mobile…  ( / )" value={s.filters.q} onChange={(e) => s.update({ q: e.target.value })} />
          </Field>
        }
        footer={<SavedSearches saved={s.saved} onApply={s.apply} onSave={s.saveAs} />}
      >
        <Field label="Venue" htmlFor="lv">
          <Select id="lv" value={s.filters.venue_id} onChange={(e) => s.update({ venue_id: e.target.value })}>
            <option value="">All venues</option>{venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="OPC" htmlFor="lo"><Input id="lo" value={s.filters.opc} onChange={(e) => s.update({ opc: e.target.value })} /></Field>
        <Field label="Salesperson" htmlFor="lsp">
          <Select id="lsp" value={s.filters.salesperson_id} onChange={(e) => s.update({ salesperson_id: e.target.value })}>
            <option value="">Anyone</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </Select>
        </Field>
        <Field label="From" htmlFor="lf"><Input id="lf" type="date" value={s.filters.date_from} onChange={(e) => s.update({ date_from: e.target.value })} /></Field>
        <Field label="To" htmlFor="lt"><Input id="lt" type="date" value={s.filters.date_to} onChange={(e) => s.update({ date_to: e.target.value })} /></Field>
        <div className="flex items-end">
          <Checkbox label="Follow-up due" checked={s.filters.follow_up_due} onChange={(e) => s.update({ follow_up_due: e.target.checked })} />
        </div>
      </FilterBar>
      <DataTable caption="Leads" columns={columns} data={data?.items ?? []} total={data?.total ?? 0} page={s.page} pageSize={25} loading={isLoading}
        sort={s.sort} onSort={s.setSort} onPage={s.setPage} onRowClick={(l) => router.push(`/leads/${l.id}`)} rowTone={followUpTone}
        emptyMessage="No leads match these filters."
        emptyAction={can("lead.create") ? <Link href="/leads/new" className={buttonClasses({ variant: "outline", size: "sm" })}><Plus aria-hidden />New lead</Link> : undefined} />
    </div>
  );
}
