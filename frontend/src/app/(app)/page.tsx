"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge, Card, Empty } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";

type Dash = {
  follow_ups?: { salesperson: string; due_today: { id: string; lead_number: string; prospect_name: string }[]; overdue: { id: string; lead_number: string; prospect_name: string; follow_up_date: string }[] }[];
  approvals_pending?: { id: string; membership_number: string; purchase_date: string }[];
  overdue_emis?: { member_id: string; membership_number: string; instalment: number; due_date: string; amount: string }[];
  overdue_asf?: { reservation_id: string; reservation_number: string; membership_year: number; amount: string }[];
  default_notices_expiring?: { member_id: string; membership_number: string; deadline: string; days_remaining: number }[];
  upcoming_check_ins?: { id: string; reservation_number: string; check_in: string; status: string }[];
  pending_reservations?: number;
};

export default function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dash>("/dashboard") });
  if (isLoading || !data) return <p>Loading…</p>;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <h1 className="col-span-full text-xl font-semibold">Dashboard</h1>
      {data.follow_ups && (
        <Card title="Lead follow-ups (today and overdue)">
          {data.follow_ups.length === 0 ? <Empty>No follow-ups due.</Empty> : data.follow_ups.map((b) => (
            <div key={b.salesperson} className="mb-3">
              <p className="text-sm font-medium">{b.salesperson}: {b.due_today.length} today, {b.overdue.length} overdue</p>
              <ul className="ml-4 list-disc text-sm">
                {[...b.overdue, ...b.due_today].slice(0, 8).map((l) => (
                  <li key={l.id}><Link className="underline" href={`/leads/${l.id}`}>{l.lead_number}</Link> {l.prospect_name}</li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      )}
      {data.approvals_pending && (
        <Card title={`Approvals pending (${data.approvals_pending.length})`}>
          {data.approvals_pending.length === 0 ? <Empty>Nothing to approve.</Empty> : (
            <ul className="text-sm">{data.approvals_pending.map((m) => (
              <li key={m.id}><Link className="underline" href={`/members/${m.id}`}>{m.membership_number}</Link> · purchased {formatDate(m.purchase_date)}</li>
            ))}</ul>
          )}
        </Card>
      )}
      {data.overdue_emis && (
        <Card title={`Overdue EMIs (${data.overdue_emis.length})`}>
          {data.overdue_emis.length === 0 ? <Empty>No overdue EMIs.</Empty> : (
            <ul className="text-sm">{data.overdue_emis.slice(0, 15).map((o) => (
              <li key={`${o.member_id}-${o.instalment}`}><Link className="underline" href={`/members/${o.member_id}?tab=finance`}>{o.membership_number}</Link> · EMI {o.instalment} due {formatDate(o.due_date)} · {formatMoney(o.amount)}</li>
            ))}</ul>
          )}
        </Card>
      )}
      {data.overdue_asf && (
        <Card title={`Reservations waiting on ASF (${data.overdue_asf.length})`}>
          {data.overdue_asf.length === 0 ? <Empty>None.</Empty> : (
            <ul className="text-sm">{data.overdue_asf.map((o) => (
              <li key={`${o.reservation_id}-${o.membership_year}`}><Link className="underline" href={`/reservations/${o.reservation_id}`}>{o.reservation_number}</Link> · ASF {o.membership_year} · {formatMoney(o.amount)}</li>
            ))}</ul>
          )}
        </Card>
      )}
      {data.default_notices_expiring && (
        <Card title="Default notices expiring within 7 days">
          {data.default_notices_expiring.length === 0 ? <Empty>None.</Empty> : (
            <ul className="text-sm">{data.default_notices_expiring.map((n) => (
              <li key={n.member_id}><Link className="underline" href={`/members/${n.member_id}?tab=finance`}>{n.membership_number}</Link> · deadline {formatDate(n.deadline)} ({n.days_remaining} days)</li>
            ))}</ul>
          )}
        </Card>
      )}
      {data.upcoming_check_ins && (
        <Card title={`Upcoming check-ins (14 days) · ${data.pending_reservations ?? 0} pending requests`}>
          {data.upcoming_check_ins.length === 0 ? <Empty>No upcoming check-ins.</Empty> : (
            <ul className="text-sm">{data.upcoming_check_ins.map((r) => (
              <li key={r.id}><Link className="underline" href={`/reservations/${r.id}`}>{r.reservation_number}</Link> · {formatDate(r.check_in)} <Badge>{r.status}</Badge></li>
            ))}</ul>
          )}
        </Card>
      )}
    </div>
  );
}
