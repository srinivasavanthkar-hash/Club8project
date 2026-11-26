"use client";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/crm/DataTable";
import { Mono, PageHeader, SeasonChip } from "@/components/crm/Display";
import { FilterBar } from "@/components/crm/FilterBar";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { SavedSearches } from "@/components/SavedSearches";
import { Field, Select } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { formatDate, formatNights, formatRelativeDays, humanize } from "@/lib/format";
import type { Reservation } from "@/lib/types";
import { useListState } from "@/lib/useListState";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/DateField";

const STATUSES = ["REQUESTED", "APPROVED", "CONFIRMED", "RESCHEDULED", "DECLINED", "CANCELLED"];

const columns: ColumnDef<Reservation, unknown>[] = [
  { header: "No.", accessorKey: "reservation_number", cell: (c) => <Mono className="font-medium text-primary">{c.getValue() as string}</Mono>, meta: { sortKey: "reservation_number", mobile: "title", hideable: false } },
  {
    header: "Check-in", accessorKey: "check_in", meta: { sortKey: "check_in", mobile: "subtitle" },
    cell: (c) => {
      const r = c.row.original;
      const upcoming = r.status === "CONFIRMED" || r.status === "APPROVED";
      return (
        <span className={cn("flex flex-col leading-tight", r.status === "CANCELLED" && "text-fg-subtle line-through")}>
          <span className="tabular-nums">{formatDate(r.check_in)}</span>
          {upcoming && <span className="text-xs text-fg-subtle no-underline">{formatRelativeDays(r.check_in)}</span>}
        </span>
      );
    },
  },
  { header: "Check-out", accessorKey: "check_out", cell: (c) => <span className={cn("tabular-nums", c.row.original.status === "CANCELLED" && "text-fg-subtle line-through")}>{formatDate(c.getValue() as string)}</span>, meta: { mobile: "hidden" } },
  { header: "Nights", accessorKey: "nights", meta: { align: "right", mobile: "field" } },
  { header: "Entitlement", accessorKey: "entitlement_nights", cell: (c) => formatNights(c.getValue() as string), meta: { align: "right", mobile: "field" } },
  { header: "Season", accessorKey: "season_code", cell: (c) => <SeasonChip code={c.getValue() as string} name={humanize(c.getValue() as string)} />, meta: { mobile: "hidden" } },
  { header: "Status", accessorKey: "status", cell: (c) => <StatusBadge status={c.getValue() as string} />, meta: { sortKey: "status", mobile: "badge", hideable: false } },
];

export default function ReservationsPage() {
  const router = useRouter();
  const s = useListState("reservations", { status: "", check_in_from: "", check_in_to: "" });
  const { data, isLoading } = useQuery({
    queryKey: ["reservations-all", s.filters, s.page, s.sort],
    queryFn: () => api.get<Page<Reservation>>("/reservations", { ...s.filters, page: s.page, page_size: 25, sort: s.sort }),
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reservations" description="Requests, approvals and confirmed stays across all members. New requests are made from the member's record." />
      <FilterBar
        activeCount={["check_in_from", "check_in_to"].filter((k) => s.filters[k as keyof typeof s.filters]).length}
        search={
          <Field label="Status" htmlFor="rs">
            <Select id="rs" data-list-filter value={s.filters.status} onChange={(e) => s.update({ status: e.target.value })}>
              <option value="">All statuses</option>{STATUSES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}
            </Select>
          </Field>
        }
        footer={<SavedSearches saved={s.saved} onApply={s.apply} onSave={s.saveAs} />}
      >
        <Field label="Check-in from" htmlFor="rf"><DateField id="rf" value={s.filters.check_in_from} onChange={(v) => s.update({ check_in_from: v })} /></Field>
        <Field label="Check-in to" htmlFor="rt"><DateField id="rt" value={s.filters.check_in_to} onChange={(v) => s.update({ check_in_to: v })} /></Field>
      </FilterBar>
      <DataTable caption="Reservations" columns={columns} data={data?.items ?? []} total={data?.total ?? 0} page={s.page} pageSize={25} loading={isLoading}
        sort={s.sort} onSort={s.setSort} onPage={s.setPage} onRowClick={(r) => router.push(`/reservations/${r.id}`)}
        rowTone={(r) => (r.status === "CANCELLED" || r.status === "DECLINED" ? "muted" : undefined)}
        emptyMessage="No reservations match these filters." />
    </div>
  );
}
