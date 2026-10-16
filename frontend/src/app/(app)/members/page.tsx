"use client";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/DataTable";
import { useCan, useMaster } from "@/components/providers";
import { SavedSearches } from "@/components/SavedSearches";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useListState } from "@/lib/useListState";

type Row = { id: string; membership_number: string; status: string; applicant_name: string | null; mobile: string | null; email: string; city: string; purchase_date: string };
const STATUSES = ["PENDING_APPROVAL", "ACTIVE", "DEFAULT_NOTICE", "SUSPENDED", "EXPIRED", "TERMINATED"];

const columns: ColumnDef<Row, unknown>[] = [
  { header: "Membership no.", accessorKey: "membership_number", meta: { sortKey: "membership_number" } },
  { header: "1st applicant", accessorKey: "applicant_name" },
  { header: "Mobile", accessorKey: "mobile" },
  { header: "Email", accessorKey: "email" },
  { header: "City", accessorKey: "city", meta: { sortKey: "city" } },
  { header: "Purchased", accessorKey: "purchase_date", cell: (c) => formatDate(c.getValue() as string), meta: { sortKey: "purchase_date" } },
  { header: "Status", accessorKey: "status", cell: (c) => <Badge>{c.getValue() as string}</Badge>, meta: { sortKey: "status" } },
];

export default function MembersPage() {
  const router = useRouter();
  const can = useCan();
  const companies = useMaster("companies");
  const s = useListState("members", { q: "", status: "", company_id: "", purchase_from: "", purchase_to: "" });
  const { data } = useQuery({
    queryKey: ["members", s.filters, s.page, s.sort],
    queryFn: () => api.get<Page<Row>>("/members", { ...s.filters, page: s.page, page_size: 25, sort: s.sort }),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Members</h1>
        {can("member.create") && <Link href="/members/new"><Button>New member application</Button></Link>}
      </div>
      <form className="grid grid-cols-2 gap-2 md:grid-cols-5" onSubmit={(e) => e.preventDefault()}>
        <Field label="Search (no., name, mobile, email)" htmlFor="mq"><Input id="mq" value={s.filters.q} onChange={(e) => s.update({ q: e.target.value })} /></Field>
        <Field label="Status" htmlFor="ms">
          <Select id="ms" value={s.filters.status} onChange={(e) => s.update({ status: e.target.value })}><option value="">All</option>{STATUSES.map((x) => <option key={x}>{x}</option>)}</Select>
        </Field>
        <Field label="Company" htmlFor="mc">
          <Select id="mc" value={s.filters.company_id} onChange={(e) => s.update({ company_id: e.target.value })}><option value="">All</option>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </Field>
        <Field label="Purchased from" htmlFor="mf"><Input id="mf" type="date" value={s.filters.purchase_from} onChange={(e) => s.update({ purchase_from: e.target.value })} /></Field>
        <Field label="Purchased to" htmlFor="mt"><Input id="mt" type="date" value={s.filters.purchase_to} onChange={(e) => s.update({ purchase_to: e.target.value })} /></Field>
      </form>
      <SavedSearches saved={s.saved} onApply={s.apply} onSave={s.saveAs} />
      <DataTable caption="Members" columns={columns} data={data?.items ?? []} total={data?.total ?? 0} page={s.page} pageSize={25}
        sort={s.sort} onSort={s.setSort} onPage={s.setPage} onRowClick={(m) => router.push(`/members/${m.id}`)} />
    </div>
  );
}
