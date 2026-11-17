"use client";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, BadgeCheck, CalendarClock, CalendarDays, FileWarning, Hourglass, PhoneCall, Receipt } from "lucide-react";
import Link from "next/link";
import { Money, Mono, PageHeader, StatTile } from "@/components/crm/Display";
import { ErrorState, PageSkeleton } from "@/components/crm/States";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { Card, Empty } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatRelativeDays } from "@/lib/format";
import { cn } from "@/lib/utils";

type Dash = {
  follow_ups?: { salesperson: string; due_today: { id: string; lead_number: string; prospect_name: string }[]; overdue: { id: string; lead_number: string; prospect_name: string; follow_up_date: string }[] }[];
  approvals_pending?: { id: string; membership_number: string; purchase_date: string }[];
  overdue_emis?: { member_id: string; membership_number: string; instalment: number; due_date: string; amount: string }[];
  overdue_asf?: { reservation_id: string; reservation_number: string; membership_year: number; amount: string }[];
  default_notices_expiring?: { member_id: string; membership_number: string; deadline: string; days_remaining: number }[];
  upcoming_check_ins?: { id: string; reservation_number: string; check_in: string; status: string }[];
  pending_reservations?: number;
};

/** One row in a dashboard task list: reference (mono), main text, right-hand meta. */
function TaskRow({ href, refText, children, meta, tone }: { href: string; refText: string; children?: React.ReactNode; meta?: React.ReactNode; tone?: "danger" | "warning" }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md px-2 py-1.5 text-base hover:bg-primary-subtle/60 touch:min-h-11"
      >
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-border-strong/60")} />
        <Mono className="shrink-0 text-sm font-medium text-primary">{refText}</Mono>
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-fg">{children}</span>
        {meta && <span className="w-full shrink-0 pl-5 text-sm text-fg-muted sm:w-auto sm:pl-0">{meta}</span>}
      </Link>
    </li>
  );
}

function TaskList({ title, count, children, empty, href }: { title: string; count?: number; children: React.ReactNode; empty: string; href?: string }) {
  const hasItems = (count ?? 0) > 0;
  return (
    <Card
      title={<span className="flex items-center gap-2">{title}{count !== undefined && <span className="rounded-full bg-surface-sunken px-2 text-sm font-medium tabular-nums text-fg-muted">{count}</span>}</span>}
      actions={href && hasItems ? <Link href={href} className="text-sm font-medium text-primary hover:underline">View all</Link> : undefined}
    >
      {hasItems ? <ul className="-mx-2 flex flex-col">{children}</ul> : <Empty className="py-4">{empty}</Empty>}
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dash>("/dashboard") });
  if (error) return <div className="flex flex-col gap-4"><h1 className="text-2xl font-semibold">Dashboard</h1><ErrorState message="The dashboard could not be loaded." onRetry={() => refetch()} /></div>;
  if (isLoading || !data) return <PageSkeleton variant="dashboard" />;

  const followToday = data.follow_ups?.reduce((n, b) => n + b.due_today.length, 0);
  const followOverdue = data.follow_ups?.reduce((n, b) => n + b.overdue.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description="What needs attention today." />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {followToday !== undefined && (
          <StatTile label="Follow-ups due today" value={followToday} icon={<PhoneCall />} href="/leads?follow_up_due=1"
            sub={followOverdue ? `${followOverdue} overdue` : "None overdue"} tone={followOverdue ? "warning" : "default"} />
        )}
        {data.approvals_pending && (
          <StatTile label="Approvals pending" value={data.approvals_pending.length} icon={<BadgeCheck />} href="/members?status=PENDING_APPROVAL"
            sub="Membership applications" tone={data.approvals_pending.length ? "warning" : "default"} />
        )}
        {data.overdue_emis && (
          <StatTile label="Overdue EMIs" value={data.overdue_emis.length} icon={<AlarmClock />} href="/finance"
            sub={data.overdue_emis.length ? "Needs follow-up" : "All up to date"} tone={data.overdue_emis.length ? "danger" : "default"} />
        )}
        {data.overdue_asf && (
          <StatTile label="Reservations awaiting ASF" value={data.overdue_asf.length} icon={<Receipt />} href="/finance"
            sub="Confirmation blocked" tone={data.overdue_asf.length ? "warning" : "default"} />
        )}
        {data.default_notices_expiring && (
          <StatTile label="Default notices expiring" value={data.default_notices_expiring.length} icon={<FileWarning />} href="/finance"
            sub="Within 7 days" tone={data.default_notices_expiring.length ? "danger" : "default"} />
        )}
        {data.upcoming_check_ins && (
          <StatTile label="Upcoming check-ins" value={data.upcoming_check_ins.length} icon={<CalendarDays />} href="/reservations?status=CONFIRMED"
            sub={`Next 14 days · ${data.pending_reservations ?? 0} pending`} />
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.follow_ups && (
          <TaskList title="Lead follow-ups" count={(followToday ?? 0) + (followOverdue ?? 0)} empty="No follow-ups due today." href="/leads?follow_up_due=1">
            {data.follow_ups.flatMap((b) => [
              ...b.overdue.map((l) => (
                <TaskRow key={l.id} href={`/leads/${l.id}`} refText={l.lead_number} tone="danger"
                  meta={<span className="text-danger">{formatRelativeDays(l.follow_up_date, "overdue")}</span>}>
                  {l.prospect_name} <span className="text-fg-subtle">· {b.salesperson}</span>
                </TaskRow>
              )),
              ...b.due_today.map((l) => (
                <TaskRow key={l.id} href={`/leads/${l.id}`} refText={l.lead_number} tone="warning" meta="today">
                  {l.prospect_name} <span className="text-fg-subtle">· {b.salesperson}</span>
                </TaskRow>
              )),
            ]).slice(0, 10)}
          </TaskList>
        )}
        {data.approvals_pending && (
          <TaskList title="Pending approvals" count={data.approvals_pending.length} empty="Nothing waiting for approval." href="/members?status=PENDING_APPROVAL">
            {data.approvals_pending.map((m) => (
              <TaskRow key={m.id} href={`/members/${m.id}`} refText={m.membership_number} meta={`purchased ${formatDate(m.purchase_date)}`}>
                <StatusBadge status="PENDING_APPROVAL" size="sm" />
              </TaskRow>
            ))}
          </TaskList>
        )}
        {data.upcoming_check_ins && (
          <TaskList title="Upcoming check-ins" count={data.upcoming_check_ins.length} empty="No check-ins in the next 14 days." href="/reservations">
            {data.upcoming_check_ins.map((r) => (
              <TaskRow key={r.id} href={`/reservations/${r.id}`} refText={r.reservation_number}
                meta={<span className="inline-flex items-center gap-1"><CalendarClock aria-hidden className="size-3.5" />{formatDate(r.check_in)} · {formatRelativeDays(r.check_in)}</span>}>
                <StatusBadge status={r.status} size="sm" />
              </TaskRow>
            ))}
          </TaskList>
        )}
        {data.overdue_emis && (
          <TaskList title="Overdue EMIs" count={data.overdue_emis.length} empty="No overdue EMIs." href="/finance">
            {data.overdue_emis.slice(0, 10).map((o) => (
              <TaskRow key={`${o.member_id}-${o.instalment}`} href={`/members/${o.member_id}?tab=finance`} refText={o.membership_number} tone="danger"
                meta={<span className="text-danger">{formatRelativeDays(o.due_date, "overdue")}</span>}>
                EMI {o.instalment} · <Money value={o.amount} />
              </TaskRow>
            ))}
          </TaskList>
        )}
        {data.overdue_asf && (
          <TaskList title="Reservations waiting on ASF" count={data.overdue_asf.length} empty="No reservations are waiting on ASF." href="/finance">
            {data.overdue_asf.map((o) => (
              <TaskRow key={`${o.reservation_id}-${o.membership_year}`} href={`/reservations/${o.reservation_id}`} refText={o.reservation_number} tone="warning">
                ASF {o.membership_year} · <Money value={o.amount} />
              </TaskRow>
            ))}
          </TaskList>
        )}
        {data.default_notices_expiring && (
          <TaskList title="Default notices expiring this week" count={data.default_notices_expiring.length} empty="No default notices expire in the next 7 days." href="/finance">
            {data.default_notices_expiring.map((n) => (
              <TaskRow key={n.member_id} href={`/members/${n.member_id}?tab=finance`} refText={n.membership_number} tone="danger"
                meta={<span className="font-medium text-danger">{n.days_remaining} {n.days_remaining === 1 ? "day" : "days"} left</span>}>
                deadline {formatDate(n.deadline)}
              </TaskRow>
            ))}
          </TaskList>
        )}
      </div>
      {!(data.follow_ups || data.approvals_pending || data.overdue_emis || data.upcoming_check_ins) && (
        <Empty icon={<Hourglass />}>Nothing on your dashboard for your role yet.</Empty>
      )}
    </div>
  );
}
