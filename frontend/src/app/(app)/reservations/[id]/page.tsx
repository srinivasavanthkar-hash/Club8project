"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { DocLink } from "@/components/member/DocLink";
import { ErrorText, useCan, useMaster } from "@/components/providers";
import { Alert, Badge, Button, Card, Field, Input, KeyValue, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { Reservation } from "@/lib/types";

type Detail = {
  reservation: Reservation;
  unpaid_asf_years: number[];
  asf_charges: { id: string; membership_year: number; total: string; status: string; currency: string }[];
  deduction: { state: string; plan: { lines: { year: number; kind: string; nights: string }[] } } | null;
  payments: { id: string; receipt_number: string; type: string; total: string; currency: string }[];
};

function creditedBack(data: unknown): string | null {
  const credited = (data as { entitlement?: { credited?: string } } | undefined)?.entitlement?.credited;
  return typeof credited === "string" ? credited : null;
}

export default function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const reasons = useMaster("reasons");
  const { data } = useQuery({ queryKey: ["reservation", id], queryFn: () => api.get<Detail>(`/reservations/${id}`) });
  const [conf, setConf] = useState("");
  const [override, setOverride] = useState("");
  const [reasonId, setReasonId] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [commRef, setCommRef] = useState("");
  const [rs, setRs] = useState({ check_in: "", check_out: "", reason: "", override_reason: "" });
  const refresh = () => qc.invalidateQueries();
  const change = useMutation({
    mutationFn: (to: string) => api.post(`/reservations/${id}/status`, {
      to_status: to, confirmation_number: conf || null, override_reason: override || null,
      reason_id: reasonId || null, reason_text: reasonText || null, communication_ref: commRef || null,
    }),
    onSuccess: refresh,
  });
  const reschedule = useMutation({ mutationFn: () => api.post(`/reservations/${id}/reschedule`, { ...rs, override_reason: rs.override_reason || null }), onSuccess: refresh });
  const voucher = useMutation({ mutationFn: () => api.post<{ id: string }>(`/reservations/${id}/voucher`), onSuccess: refresh });
  if (!data) return <p>Loading…</p>;
  const r = data.reservation;
  const canChange = can("reservation.status.change");
  const kind = (k: string) => reasons.data?.filter((x) => x.kind === k) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Reservation {r.reservation_number}</h1><Badge>{r.status}</Badge>
        <Link className="underline" href={`/members/${r.member_id}?tab=reservations`}>Open member</Link>
      </div>
      <Card title="Stay">
        <KeyValue items={[
          ["Check-in", formatDate(r.check_in)], ["Check-out", formatDate(r.check_out)], ["Nights", r.nights],
          ["Entitlement nights deducted", r.entitlement_nights], ["Additional paid nights", r.additional_paid_nights],
          ["Season / category", `${r.season_code} / ${r.resort_category_code}`], ["Guests", `${r.adults} adult(s), ${r.child_ages.length} child(ren)`],
          ["Occupancy", r.occupancy_type], ["Confirmation no.", r.confirmation_number], ["Reschedules", r.reschedule_count],
          ["Entitlement movement", data.deduction ? `${data.deduction.state}: ${data.deduction.plan.lines.map((l) => `${l.nights} from ${l.year} (${l.kind})`).join(", ")}` : "—"],
        ]} />
        <p className="mt-2 text-xs text-muted-foreground">{r.deduction_explanation}</p>
      </Card>
      <Card title="ASF for this booking">
        {data.unpaid_asf_years.length > 0 && <Alert kind="warning">ASF unpaid for {data.unpaid_asf_years.join(", ")}. Confirmation is blocked until it is paid (agreement: non-payment of ASF results in non-confirmation).</Alert>}
        <ul className="text-sm">{data.asf_charges.map((c) => <li key={c.id}>{c.membership_year}: {formatMoney(c.total, c.currency)} incl. GST <Badge>{c.status}</Badge></li>)}</ul>
        {data.payments.length > 0 && <p className="mt-2 text-sm">Linked payments: {data.payments.map((p) => `${p.receipt_number} (${p.type} ${formatMoney(p.total, p.currency)})`).join(", ")}</p>}
      </Card>
      {canChange && !["DECLINED", "CANCELLED"].includes(r.status) && (
        <Card title="Actions">
          <div className="grid gap-3 md:grid-cols-3">
            {["REQUESTED", "RESCHEDULED"].includes(r.status) && <Button onClick={() => change.mutate("APPROVED")}>Approve (deduct entitlement)</Button>}
            {["APPROVED", "RESCHEDULED"].includes(r.status) && (
              <div className="flex flex-col gap-2">
                <Field label="Property confirmation number" htmlFor="cn"><Input id="cn" value={conf} onChange={(e) => setConf(e.target.value)} /></Field>
                {can("reservation.override") && <Field label="Override reason (only to bypass ASF gate)" htmlFor="ov"><Input id="ov" value={override} onChange={(e) => setOverride(e.target.value)} /></Field>}
                <Button onClick={() => change.mutate("CONFIRMED")}>Confirm</Button>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Field label="Decline / cancel reason" htmlFor="rr">
                <Select id="rr" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
                  <option value="">Select…</option>
                  <optgroup label="Decline">{kind("DECLINE").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                  <optgroup label="Cancel">{kind("CANCEL").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                </Select>
              </Field>
              <Field label="Explanation" htmlFor="rt"><Input id="rt" value={reasonText} onChange={(e) => setReasonText(e.target.value)} /></Field>
              {r.status === "CONFIRMED" && <Field label="Member's written request (email:<id> or document:<id>)" htmlFor="cr"><Input id="cr" value={commRef} onChange={(e) => setCommRef(e.target.value)} /></Field>}
              <div className="flex gap-2">
                {r.status !== "CONFIRMED" && <Button variant="outline" onClick={() => change.mutate("DECLINED")}>Decline</Button>}
                <Button variant="destructive" onClick={() => change.mutate("CANCELLED")}>Cancel</Button>
              </div>
            </div>
          </div>
          <ErrorText error={change.error} />
          {creditedBack(change.data) !== null && <Alert kind="info">Nights credited back: {creditedBack(change.data)}</Alert>}
        </Card>
      )}
      {can("reservation.update") && ["REQUESTED", "APPROVED", "CONFIRMED", "RESCHEDULED"].includes(r.status) && (
        <Card title="Reschedule (original dates are kept)">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="New check-in" htmlFor="nci"><Input id="nci" type="date" value={rs.check_in} onChange={(e) => setRs({ ...rs, check_in: e.target.value })} /></Field>
            <Field label="New check-out" htmlFor="nco"><Input id="nco" type="date" value={rs.check_out} onChange={(e) => setRs({ ...rs, check_out: e.target.value })} /></Field>
            <Field label="Reason" htmlFor="nr"><Input id="nr" value={rs.reason} onChange={(e) => setRs({ ...rs, reason: e.target.value })} /></Field>
            {r.reschedule_count >= 2 && <Field label="Override reason (3rd+ reschedule)" htmlFor="no"><Input id="no" value={rs.override_reason} onChange={(e) => setRs({ ...rs, override_reason: e.target.value })} /></Field>}
          </div>
          <Button className="mt-2" variant="outline" onClick={() => reschedule.mutate()}>Reschedule</Button>
          <ErrorText error={reschedule.error} />
        </Card>
      )}
      {r.status === "CONFIRMED" && can("letter.generate") && (
        <Card title="Voucher">
          <Button variant="outline" onClick={() => voucher.mutate()}>Generate confirmation / voucher PDF</Button>
          {voucher.data && <span className="ml-2"><DocLink id={voucher.data.id} label="Open voucher" /></span>}
          <ErrorText error={voucher.error} />
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Date history">
          <ol className="text-sm">{r.date_versions.map((v) => <li key={v.version_no}>v{v.version_no}: {formatDate(v.check_in)} → {formatDate(v.check_out)} ({v.entitlement_nights} nights) {v.reason ? `· ${v.reason}` : ""}</li>)}</ol>
        </Card>
        <Card title="Status history">
          <ol className="text-sm">{r.status_history.map((h, i) => <li key={i}>{formatDateTime(h.changed_at)} · {h.from_status ?? "—"} → {h.to_status}{h.override ? " (override)" : ""}{h.reason_text ? ` · ${h.reason_text}` : ""}</li>)}</ol>
        </Card>
      </div>
    </div>
  );
}
