"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Mono } from "@/components/crm/Display";
import { TableSkeleton } from "@/components/crm/States";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { Table, Td, Th, THead, Tr } from "@/components/crm/Table";
import { Alert, Card, Empty } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatNights, todayIso } from "@/lib/format";
import type { Member, YearView } from "@/lib/types";
import { cn } from "@/lib/utils";

type Brief = { id: string; reservation_number: string; check_in: string; check_out: string; status: string; entitlement_nights: string };

const SEGMENTS: { key: keyof YearView; label: string; cls: string }[] = [
  { key: "used", label: "Used", cls: "bg-primary" },
  { key: "used_later", label: "Saved & used later", cls: "bg-primary/60" },
  { key: "on_hold", label: "On hold", cls: "bg-warning-strong" },
  { key: "borrowed_out", label: "Borrowed-out", cls: "bg-secondary" },
  { key: "expired", label: "Expired", cls: "bg-border-strong/50" },
  { key: "remaining", label: "Remaining", cls: "bg-success/70" },
];

/** Mini stacked bar of how a year's nights were used (decorative: the numbers are in the row). */
function YearBar({ y }: { y: YearView }) {
  const parts = SEGMENTS.map((s) => ({ ...s, n: Math.max(0, Number(y[s.key]) || 0) }));
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return <div aria-hidden className="mt-1 h-1.5 w-24 rounded-full bg-surface-sunken" />;
  return (
    <div aria-hidden className="mt-1 flex h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken">
      {parts.filter((p) => p.n > 0).map((p) => <span key={p.key} className={p.cls} style={{ width: `${(p.n / total) * 100}%` }} />)}
    </div>
  );
}

function ReservationList({ items, empty }: { items: Brief[] | undefined; empty: string }) {
  if (!items) return <TableSkeleton rows={2} cols={4} />;
  if (!items.length) return <Empty className="py-4">{empty}</Empty>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((r) => (
        <li key={r.id}>
          <Link href={`/reservations/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-base hover:bg-primary-subtle/40">
            <Mono className="font-medium text-primary">{r.reservation_number}</Mono>
            <span className={cn("tabular-nums", r.status === "CANCELLED" && "text-fg-subtle line-through")}>{formatDate(r.check_in)} → {formatDate(r.check_out)}</span>
            <span className="text-fg-muted">{formatNights(r.entitlement_nights)} nights</span>
            <span className="ml-auto"><StatusBadge status={r.status} size="sm" /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function EntitlementTab({ member }: { member: Member }) {
  const { data } = useQuery({
    queryKey: ["entitlement", member.id],
    queryFn: () => api.get<{ years: YearView[]; past: Brief[]; upcoming: Brief[] }>(`/members/${member.id}/entitlement`),
  });
  const thisYear = Number(todayIso().slice(0, 4));
  const cols: [keyof YearView, string][] = [
    ["allocated", "Allocated"], ["bonus", "Bonus"], ["saved_in", "Saved-in"], ["used", "Used"], ["used_later", "Saved & used later"],
    ["borrowed_out", "Borrowed-out"], ["on_hold", "On hold"], ["credited_back", "Credited back"], ["expired", "Expired"], ["remaining", "Remaining"],
  ];
  return (
    <div className="flex flex-col gap-4 pt-1">
      <Card title="Nights by membership year" description="Unused nights can be saved for up to 2 years; nights can be borrowed from up to the next 2 years (never beyond the last year of use).">
        {member.status === "PENDING_APPROVAL" && <Alert kind="info" className="mb-3">Entitlement is created when the member is approved.</Alert>}
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-hidden>
          {SEGMENTS.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-sm", s.cls)} />{s.label}</span>)}
        </div>
        {!data ? <TableSkeleton rows={5} cols={8} /> : (
          <Table caption="Nights by membership year" stickyFirstColumn>
            <THead>
              <tr><Th>Year</Th>{cols.map(([k, l]) => <Th key={k} align="right" className={k === "remaining" ? "text-fg" : undefined}>{l}</Th>)}</tr>
            </THead>
            <tbody>{data.years.map((y) => {
              const current = y.year === thisYear;
              return (
                <Tr key={y.year} tone={current ? "highlight" : y.year < thisYear ? "muted" : undefined}>
                  <Td className="font-medium">
                    {y.year}
                    {current && <span className="sr-only"> (current year)</span>}
                    <YearBar y={y} />
                  </Td>
                  {cols.map(([k]) => {
                    const n = Number(y[k]);
                    return (
                      <Td key={k} align="right" className={cn(
                        k === "remaining" && "text-md font-semibold",
                        k !== "remaining" && n === 0 && "text-fg-subtle",
                        k === "expired" && n > 0 && "text-danger",
                      )}>
                        {formatNights(String(y[k]))}
                      </Td>
                    );
                  })}
                </Tr>
              );
            })}</tbody>
          </Table>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Upcoming reservations"><ReservationList items={data?.upcoming} empty="No upcoming reservations." /></Card>
        <Card title="Past reservations"><ReservationList items={data?.past} empty="No past reservations." /></Card>
      </div>
    </div>
  );
}
