"use client";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandChip } from "@/components/crm/Brand";
import { DataTable } from "@/components/crm/DataTable";
import { Mono, PageHeader } from "@/components/crm/Display";
import { FilterBar } from "@/components/crm/FilterBar";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { useCan, useMaster } from "@/components/providers";
import { SavedSearches } from "@/components/SavedSearches";
import { buttonClasses, Field, Input, Select } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { formatDate, formatPhoneMasked, humanize } from "@/lib/format";
import { useListState } from "@/lib/useListState";
import { DateField } from "@/components/DateField";

type Row = { id: string; membership_number: string; status: string; company_id?: string | null; applicant_name: string | null; mobile: string | null; email: string; city: string; purchase_date: string };
const STATUSES = ["PENDING_APPROVAL", "ACTIVE", "DEFAULT_NOTICE", "SUSPENDED", "EXPIRED", "TERMINATED"];

const columns: ColumnDef<Row, unknown>[] = [
  { header: "Membership no.", accessorKey: "membership_number", cell: (c) => <Mono className="font-medium text-primary">{c.getValue() as string}</Mono>, meta: { sortKey: "membership_number", mobile: "subtitle", hideable: false } },
  { header: "1st applicant", accessorKey: "applicant_name", cell: (c) => <span className="font-medium">{(c.getValue() as string) ?? "—"}</span>, meta: { mobile: "title", hideable: false } },
  { header: "Brand", accessorKey: "company_id", cell: (c) => <BrandChip companyId={c.getValue() as string} size="sm" />, meta: { mobile: "field" } },
  { header: "Mobile", accessorKey: "mobile", cell: (c) => <span className="tabular-nums">{formatPhoneMasked(c.getValue() as string)}</span>, meta: { mobile: "field" } },
  { header: "Email", accessorKey: "email", meta: { mobile: "hidden" } },
  { header: "City", accessorKey: "city", meta: { sortKey: "city", mobile: "field" } },
  { header: "Purchased", accessorKey: "purchase_date", cell: (c) => formatDate(c.getValue() as string), meta: { sortKey: "purchase_date", mobile: "hidden" } },
  { header: "Status", accessorKey: "status", cell: (c) => <StatusBadge status={c.getValue() as string} />, meta: { sortKey: "status", mobile: "badge", hideable: false } },
];

export default function MembersPage() {
  const router = useRouter();
  const can = useCan();
  const companies = useMaster("companies");
  const s = useListState("members", { q: "", status: "", company_id: "", purchase_from: "", purchase_to: "" });
  const { data, isLoading } = useQuery({
    queryKey: ["members", s.filters, s.page, s.sort],
    queryFn: () => api.get<Page<Row>>("/members", { ...s.filters, page: s.page, page_size: 25, sort: s.sort }),
  });
  const active = ["status", "company_id", "purchase_from", "purchase_to"].filter((k) => s.filters[k as keyof typeof s.filters]).length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Members"
        description="Find a member by number, name, mobile or email."
        actions={can("member.create") && <Link href="/members/new" className={buttonClasses()}><Plus aria-hidden />New member application</Link>}
      />
      <FilterBar
        activeCount={active}
        search={
          <Field label="Search (no., name, mobile, email)" htmlFor="mq">
            <Input id="mq" data-list-filter type="search" placeholder="e.g. MSMC8-9001  ( / )" value={s.filters.q} onChange={(e) => s.update({ q: e.target.value })} />
          </Field>
        }
        footer={<SavedSearches saved={s.saved} onApply={s.apply} onSave={s.saveAs} />}
      >
        <Field label="Status" htmlFor="ms">
          <Select id="ms" value={s.filters.status} onChange={(e) => s.update({ status: e.target.value })}>
            <option value="">All statuses</option>{STATUSES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}
          </Select>
        </Field>
        <Field label="Brand" htmlFor="mc">
          <Select id="mc" value={s.filters.company_id} onChange={(e) => s.update({ company_id: e.target.value })}><option value="">All brands</option>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </Field>
        <Field label="Purchased from" htmlFor="mf"><DateField id="mf" value={s.filters.purchase_from} onChange={(v) => s.update({ purchase_from: v })} /></Field>
        <Field label="Purchased to" htmlFor="mt"><DateField id="mt" value={s.filters.purchase_to} onChange={(v) => s.update({ purchase_to: v })} /></Field>
      </FilterBar>
      <DataTable caption="Members" columns={columns} data={data?.items ?? []} total={data?.total ?? 0} page={s.page} pageSize={25} loading={isLoading}
        sort={s.sort} onSort={s.setSort} onPage={s.setPage} onRowClick={(m) => router.push(`/members/${m.id}`)}
        rowTone={(m) => (m.status === "DEFAULT_NOTICE" ? "danger" : m.status === "TERMINATED" || m.status === "EXPIRED" ? "muted" : undefined)}
        emptyMessage="No members match these filters." />
    </div>
  );
}
