"use client";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/DataTable";
import { useCan, useMaster, useStaff } from "@/components/providers";
import { SavedSearches } from "@/components/SavedSearches";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Lead } from "@/lib/types";
import { useListState } from "@/lib/useListState";

const STATUSES = ["NEW", "CONTACTED", "PRESENTATION_SCHEDULED", "ATTENDED", "NOT_INTERESTED", "CONVERTED"];

const columns: ColumnDef<Lead, unknown>[] = [
  { header: "Lead ID", accessorKey: "lead_number", meta: { sortKey: "lead_number" } },
  { header: "Entry", accessorKey: "entry_date", cell: (c) => formatDate(c.getValue() as string), meta: { sortKey: "entry_date" } },
  { header: "Prospect", accessorKey: "prospect_name", meta: { sortKey: "prospect_name" } },
  { header: "Mobile", accessorKey: "mobile" },
  { header: "City", accessorKey: "city" },
  { header: "OPC", accessorKey: "opc_name" },
  { header: "Follow-up", accessorKey: "follow_up_date", cell: (c) => formatDate(c.getValue() as string), meta: { sortKey: "follow_up_date" } },
  { header: "Status", accessorKey: "status", cell: (c) => <Badge>{c.getValue() as string}</Badge>, meta: { sortKey: "status" } },
];

export default function LeadsPage() {
  const router = useRouter();
  const can = useCan();
  const venues = useMaster("venues");
  const staff = useStaff();
  const s = useListState("leads", { q: "", status: "", venue_id: "", opc: "", salesperson_id: "", date_from: "", date_to: "", follow_up_due: false });
  const { data } = useQuery({
    queryKey: ["leads", s.filters, s.page, s.sort],
    queryFn: () => api.get<Page<Lead>>("/leads", { ...s.filters, follow_up_due: s.filters.follow_up_due || undefined, page: s.page, page_size: 25, sort: s.sort }),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Leads</h1>
        {can("lead.create") && <Link href="/leads/new"><Button>New lead</Button></Link>}
      </div>
      <form className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8" onSubmit={(e) => e.preventDefault()}>
        <Field label="Search" htmlFor="lq"><Input id="lq" value={s.filters.q} onChange={(e) => s.update({ q: e.target.value })} /></Field>
        <Field label="Status" htmlFor="ls">
          <Select id="ls" value={s.filters.status} onChange={(e) => s.update({ status: e.target.value })}>
            <option value="">All</option>{STATUSES.map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Venue" htmlFor="lv">
          <Select id="lv" value={s.filters.venue_id} onChange={(e) => s.update({ venue_id: e.target.value })}>
            <option value="">All</option>{venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="OPC" htmlFor="lo"><Input id="lo" value={s.filters.opc} onChange={(e) => s.update({ opc: e.target.value })} /></Field>
        <Field label="Salesperson" htmlFor="lsp">
          <Select id="lsp" value={s.filters.salesperson_id} onChange={(e) => s.update({ salesperson_id: e.target.value })}>
            <option value="">All</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </Select>
        </Field>
        <Field label="From" htmlFor="lf"><Input id="lf" type="date" value={s.filters.date_from} onChange={(e) => s.update({ date_from: e.target.value })} /></Field>
        <Field label="To" htmlFor="lt"><Input id="lt" type="date" value={s.filters.date_to} onChange={(e) => s.update({ date_to: e.target.value })} /></Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={s.filters.follow_up_due} onChange={(e) => s.update({ follow_up_due: e.target.checked })} /> Follow-up due
        </label>
      </form>
      <SavedSearches saved={s.saved} onApply={s.apply} onSave={s.saveAs} />
      <DataTable caption="Leads" columns={columns} data={data?.items ?? []} total={data?.total ?? 0} page={s.page} pageSize={25}
        sort={s.sort} onSort={s.setSort} onPage={s.setPage} onRowClick={(l) => router.push(`/leads/${l.id}`)} />
    </div>
  );
}
