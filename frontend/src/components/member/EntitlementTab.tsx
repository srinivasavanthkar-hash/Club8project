"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Member, YearView } from "@/lib/types";

type Brief = { id: string; reservation_number: string; check_in: string; check_out: string; status: string; entitlement_nights: string };

export function EntitlementTab({ member }: { member: Member }) {
  const { data } = useQuery({
    queryKey: ["entitlement", member.id],
    queryFn: () => api.get<{ years: YearView[]; past: Brief[]; upcoming: Brief[] }>(`/members/${member.id}/entitlement`),
  });
  const cols: [keyof YearView, string][] = [
    ["allocated", "Allocated"], ["bonus", "Bonus"], ["saved_in", "Saved-in"], ["used", "Used"], ["used_later", "Saved & used later"],
    ["borrowed_out", "Borrowed-out"], ["on_hold", "On hold"], ["credited_back", "Credited back"], ["expired", "Expired"], ["remaining", "Remaining"],
  ];
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Card title="Nights by membership year">
        <p className="mb-2 text-xs text-muted-foreground">Unused nights can be saved for up to 2 years; nights can be borrowed from up to the next 2 years (never beyond the last year of use).</p>
        {member.status === "PENDING_APPROVAL" && <p className="text-sm">Entitlement is created when the member is approved.</p>}
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left"><th>Year</th>{cols.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
          <tbody>{data?.years.map((y) => (
            <tr key={y.year} className="border-t border-border"><td className="font-medium">{y.year}</td>{cols.map(([k]) => <td key={k} className={k === "remaining" ? "font-semibold" : ""}>{String(y[k])}</td>)}</tr>
          ))}</tbody>
        </table></div>
      </Card>
      {(["upcoming", "past"] as const).map((k) => (
        <Card key={k} title={k === "upcoming" ? "Upcoming reservations" : "Past reservations"}>
          <ul className="text-sm">{data?.[k].map((r) => (
            <li key={r.id}><Link className="underline" href={`/reservations/${r.id}`}>{r.reservation_number}</Link> · {formatDate(r.check_in)} → {formatDate(r.check_out)} · {r.entitlement_nights} nights <Badge>{r.status}</Badge></li>
          ))}</ul>
        </Card>
      ))}
    </div>
  );
}
