"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useMaster, useStaff } from "@/components/providers";
import { Card, Empty, Field, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";

type Dash = {
  overdue_emis: { member_id: string; membership_number: string; instalment: number; due_date: string; amount: string }[];
  reservations_waiting_asf: { reservation_id: string; reservation_number: string; membership_number: string; membership_year: number; amount: string }[];
  default_notices: { member_id: string; membership_number: string; deadline: string; days_remaining: number; amount: string }[];
};

export default function FinancePage() {
  const companies = useMaster("companies");
  const staff = useStaff();
  const [f, setF] = useState({ company_id: "", relationship_manager_id: "", team_manager_id: "" });
  const { data } = useQuery({ queryKey: ["finance-dash", f], queryFn: () => api.get<Dash>("/finance/dashboard", f) });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Finance dashboard</h1>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <Field label="Company" htmlFor="fc"><Select id="fc" value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}><option value="">All</option>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Relationship manager" htmlFor="frm"><Select id="frm" value={f.relationship_manager_id} onChange={(e) => setF({ ...f, relationship_manager_id: e.target.value })}><option value="">All</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select></Field>
        <Field label="Team manager" htmlFor="ftm"><Select id="ftm" value={f.team_manager_id} onChange={(e) => setF({ ...f, team_manager_id: e.target.value })}><option value="">All</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select></Field>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`Overdue EMIs (${data?.overdue_emis.length ?? 0})`}>
          {!data?.overdue_emis.length ? <Empty>None</Empty> : <ul className="text-sm">{data.overdue_emis.map((o) => (
            <li key={`${o.member_id}-${o.instalment}`}><Link className="underline" href={`/members/${o.member_id}?tab=finance`}>{o.membership_number}</Link> · #{o.instalment} due {formatDate(o.due_date)} · {formatMoney(o.amount)}</li>
          ))}</ul>}
        </Card>
        <Card title={`Reservations waiting on ASF (${data?.reservations_waiting_asf.length ?? 0})`}>
          {!data?.reservations_waiting_asf.length ? <Empty>None</Empty> : <ul className="text-sm">{data.reservations_waiting_asf.map((o) => (
            <li key={`${o.reservation_id}-${o.membership_year}`}><Link className="underline" href={`/reservations/${o.reservation_id}`}>{o.reservation_number}</Link> · {o.membership_number} · ASF {o.membership_year} · {formatMoney(o.amount)}</li>
          ))}</ul>}
        </Card>
        <Card title={`Members in default notice (${data?.default_notices.length ?? 0})`}>
          {!data?.default_notices.length ? <Empty>None</Empty> : <ul className="text-sm">{data.default_notices.map((n) => (
            <li key={n.member_id}><Link className="underline" href={`/members/${n.member_id}?tab=finance`}>{n.membership_number}</Link> · {n.days_remaining} day(s) left (deadline {formatDate(n.deadline)}) · {formatMoney(n.amount)}</li>
          ))}</ul>}
        </Card>
      </div>
    </div>
  );
}
