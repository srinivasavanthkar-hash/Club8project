"use client";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/DataTable";
import { SavedSearches } from "@/components/SavedSearches";
import { Badge, Field, Input, Select } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Reservation } from "@/lib/types";
import { useListState } from "@/lib/useListState";

const columns: ColumnDef<Reservation, unknown>[] = [
  { header: "No.", accessorKey: "reservation_number", meta: { sortKey: "reservation_number" } },
  { header: "Check-in", accessorKey: "check_in", cell: (c) => formatDate(c.getValue() as string), meta: { sortKey: "check_in" } },
  { header: "Check-out", accessorKey: "check_out", cell: (c) => formatDate(c.getValue() as string) },
  { header: "Nights", accessorKey: "nights" },
  { header: "Entitlement", accessorKey: "entitlement_nights" },
  { header: "Status", accessorKey: "status", cell: (c) => <Badge>{c.getValue() as string}</Badge>, meta: { sortKey: "status" } },
];

export default function ReservationsPage() {
  const router = useRouter();
  const s = useListState("reservations", { status: "", check_in_from: "", check_in_to: "" });
  const { data } = useQuery({
    queryKey: ["reservations-all", s.filters, s.page, s.sort],
    queryFn: () => api.get<Page<Reservation>>("/reservations", { ...s.filters, page: s.page, page_size: 25, sort: s.sort }),
  });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Reservations</h1>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Status" htmlFor="rs">
          <Select id="rs" value={s.filters.status} onChange={(e) => s.update({ status: e.target.value })}>
            <option value="">All</option>{["REQUESTED", "APPROVED", "CONFIRMED", "RESCHEDULED", "DECLINED", "CANCELLED"].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Check-in from" htmlFor="rf"><Input id="rf" type="date" value={s.filters.check_in_from} onChange={(e) => s.update({ check_in_from: e.target.value })} /></Field>
        <Field label="Check-in to" htmlFor="rt"><Input id="rt" type="date" value={s.filters.check_in_to} onChange={(e) => s.update({ check_in_to: e.target.value })} /></Field>
        <SavedSearches saved={s.saved} onApply={s.apply} onSave={s.saveAs} />
      </div>
      <DataTable caption="Reservations" columns={columns} data={data?.items ?? []} total={data?.total ?? 0} page={s.page} pageSize={25}
        sort={s.sort} onSort={s.setSort} onPage={s.setPage} onRowClick={(r) => router.push(`/reservations/${r.id}`)} />
    </div>
  );
}
