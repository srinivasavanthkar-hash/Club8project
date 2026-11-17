"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Money, Mono, PageHeader, StatTile } from "@/components/crm/Display";
import { ErrorState, TableSkeleton } from "@/components/crm/States";
import { Table, Td, Th, THead, Tr } from "@/components/crm/Table";
import { useMaster, useStaff } from "@/components/providers";
import { Card, Empty, Field, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { daysFromToday, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Dash = {
  overdue_emis: { member_id: string; membership_number: string; instalment: number; due_date: string; amount: string }[];
  reservations_waiting_asf: { reservation_id: string; reservation_number: string; membership_number: string; membership_year: number; amount: string }[];
  default_notices: { member_id: string; membership_number: string; deadline: string; days_remaining: number; amount: string }[];
};

function DaysBadge({ days, kind }: { days: number; kind: "overdue" | "left" }) {
  const urgent = kind === "overdue" ? days > 30 : days <= 3;
  return (
    <span className={cn(
      "inline-flex h-5 items-center rounded-full px-2 text-xs font-semibold tabular-nums ring-1 ring-inset",
      urgent ? "bg-danger text-fg-on-fill ring-danger" : "bg-danger-subtle text-danger ring-danger/25",
    )}>
      {kind === "overdue" ? `${days} ${days === 1 ? "day" : "days"} overdue` : `${days} ${days === 1 ? "day" : "days"} left`}
    </span>
  );
}

export default function FinancePage() {
  const companies = useMaster("companies");
  const staff = useStaff();
  const [f, setF] = useState({ company_id: "", relationship_manager_id: "", team_manager_id: "" });
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["finance-dash", f], queryFn: () => api.get<Dash>("/finance/dashboard", f) });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Finance dashboard" description="Overdue EMIs, reservations waiting on ASF and members in default notice." />
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-3 sm:p-4">
        <Field label="Company" htmlFor="fc"><Select id="fc" value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}><option value="">All companies</option>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Relationship manager" htmlFor="frm"><Select id="frm" value={f.relationship_manager_id} onChange={(e) => setF({ ...f, relationship_manager_id: e.target.value })}><option value="">Anyone</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select></Field>
        <Field label="Team manager" htmlFor="ftm"><Select id="ftm" value={f.team_manager_id} onChange={(e) => setF({ ...f, team_manager_id: e.target.value })}><option value="">Anyone</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select></Field>
      </div>
      {error && <ErrorState message="The finance dashboard could not be loaded." onRetry={() => refetch()} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Overdue EMIs" value={data?.overdue_emis.length ?? "…"} tone={data?.overdue_emis.length ? "danger" : "default"} sub="Instalments past due" />
        <StatTile label="Reservations waiting on ASF" value={data?.reservations_waiting_asf.length ?? "…"} tone={data?.reservations_waiting_asf.length ? "warning" : "default"} sub="Confirmation blocked" />
        <StatTile label="Members in default notice" value={data?.default_notices.length ?? "…"} tone={data?.default_notices.length ? "danger" : "default"} sub="Deadline running" />
      </div>

      <Card title="Overdue EMIs" padding="none">
        {isLoading ? <TableSkeleton rows={3} cols={5} /> : !data?.overdue_emis.length ? <Empty>No overdue EMIs.</Empty> : (
          <Table caption="Overdue EMIs" className="rounded-none border-0">
            <THead><tr><Th>Member</Th><Th align="right">EMI #</Th><Th>Due</Th><Th>Overdue</Th><Th align="right">Amount</Th></tr></THead>
            <tbody>{data.overdue_emis.map((o) => (
              <Tr key={`${o.member_id}-${o.instalment}`}>
                <Td><Link className="font-mono font-medium text-primary hover:underline" href={`/members/${o.member_id}?tab=finance`}>{o.membership_number}</Link></Td>
                <Td align="right">{o.instalment}</Td>
                <Td className="tabular-nums">{formatDate(o.due_date)}</Td>
                <Td><DaysBadge days={-(daysFromToday(o.due_date) ?? 0)} kind="overdue" /></Td>
                <Td align="right"><Money value={o.amount} strong /></Td>
              </Tr>
            ))}</tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Reservations waiting on ASF" padding="none">
          {isLoading ? <TableSkeleton rows={3} cols={4} /> : !data?.reservations_waiting_asf.length ? <Empty>No reservations are waiting on ASF.</Empty> : (
            <Table caption="Reservations waiting on ASF" className="rounded-none border-0">
              <THead><tr><Th>Reservation</Th><Th>Member</Th><Th>ASF year</Th><Th align="right">Amount</Th></tr></THead>
              <tbody>{data.reservations_waiting_asf.map((o) => (
                <Tr key={`${o.reservation_id}-${o.membership_year}`}>
                  <Td><Link className="font-mono font-medium text-primary hover:underline" href={`/reservations/${o.reservation_id}`}>{o.reservation_number}</Link></Td>
                  <Td><Mono>{o.membership_number}</Mono></Td>
                  <Td className="tabular-nums">{o.membership_year}</Td>
                  <Td align="right"><Money value={o.amount} strong /></Td>
                </Tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        <Card title="Members in default notice" padding="none">
          {isLoading ? <TableSkeleton rows={3} cols={4} /> : !data?.default_notices.length ? <Empty>No members are in default notice.</Empty> : (
            <Table caption="Members in default notice" className="rounded-none border-0">
              <THead><tr><Th>Member</Th><Th>Deadline</Th><Th>Time left</Th><Th align="right">Overdue</Th></tr></THead>
              <tbody>{data.default_notices.map((n) => (
                <Tr key={n.member_id} tone={n.days_remaining <= 3 ? "danger" : undefined}>
                  <Td><Link className="font-mono font-medium text-primary hover:underline" href={`/members/${n.member_id}?tab=finance`}>{n.membership_number}</Link></Td>
                  <Td className="tabular-nums">{formatDate(n.deadline)}</Td>
                  <Td><DaysBadge days={n.days_remaining} kind="left" /></Td>
                  <Td align="right"><Money value={n.amount} strong /></Td>
                </Tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
