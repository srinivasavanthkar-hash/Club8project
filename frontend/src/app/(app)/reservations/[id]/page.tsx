"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarRange, Calculator, ExternalLink, FileDown, Receipt, Users } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { CategoryChip, Chip, Money, Mono, PageHeader, SeasonChip } from "@/components/crm/Display";
import { ConfirmDialog, ErrorState, PageSkeleton } from "@/components/crm/States";
import { StatusStepper } from "@/components/crm/Stepper";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { useToast } from "@/components/crm/Toast";
import { DocLink } from "@/components/member/DocLink";
import { CancellationDetails, CancellationOutcome, WrittenRequestPicker, type CancellationTerms } from "@/components/reservation/Cancellation";
import { ErrorText, useCan, useMaster } from "@/components/providers";
import { Alert, Button, buttonClasses, Card, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, formatNights, humanize } from "@/lib/format";
import type { Reservation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/DateField";

type Detail = {
  reservation: Reservation;
  unpaid_asf_years: number[];
  asf_charges: { id: string; membership_year: number; total: string; status: string; currency: string; withdrawn_on: string | null; withdrawn_reason: string | null }[];
  deduction: { state: string; plan: { lines: { year: number; kind: string; nights: string }[] } } | null;
  payments: { id: string; receipt_number: string; type: string; total: string; currency: string }[];
  documents: { id: string; type: string; file_name: string; created_at: string; voided_at: string | null; void_reason: string | null }[];
};

function creditedBack(data: unknown): string | null {
  const credited = (data as { entitlement?: { credited?: string } } | undefined)?.entitlement?.credited;
  return typeof credited === "string" ? credited : null;
}

const PATH = ["REQUESTED", "APPROVED", "CONFIRMED"];

export default function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const toast = useToast();
  const reasons = useMaster("reasons");
  const { data, error, refetch } = useQuery({ queryKey: ["reservation", id], queryFn: () => api.get<Detail>(`/reservations/${id}`) });
  const [conf, setConf] = useState("");
  const [override, setOverride] = useState("");
  const [reasonId, setReasonId] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [commRef, setCommRef] = useState("");
  const [cancelDate, setCancelDate] = useState(""); // "" = the default (day the written request was received)
  const [dateReason, setDateReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [rs, setRs] = useState({ check_in: "", check_out: "", reason: "", override_reason: "" });
  // the cancellation preview is not refetched: after a cancel it would ask about a closed reservation (it turns
  // itself off once the reservation's new status arrives)
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "cancellation-terms" });
  const change = useMutation({
    mutationFn: (to: string) => api.post(`/reservations/${id}/status`, {
      to_status: to, confirmation_number: conf || null, override_reason: override || null,
      reason_id: reasonId || null, reason_text: reasonText || null, communication_ref: commRef || null,
      cancel_date: cancelDate || null, cancel_date_reason: dateReason || null,
    }),
    onSuccess: (_d, to) => { setConfirmCancel(false); refresh(); toast.success(`Reservation ${humanize(to).toLowerCase()}`); },
  });
  const reschedule = useMutation({ mutationFn: () => api.post(`/reservations/${id}/reschedule`, { ...rs, override_reason: rs.override_reason || null }), onSuccess: () => { refresh(); toast.success("Reservation rescheduled"); } });
  const status = data?.reservation.status ?? "";
  const open = !!data && !["DECLINED", "CANCELLED"].includes(status) && can("reservation.status.change");
  const terms = useQuery({
    queryKey: ["cancellation-terms", id, status, commRef, cancelDate, dateReason],
    queryFn: () => api.get<CancellationTerms>(`/reservations/${id}/cancellation-terms`, {
      communication_ref: commRef || undefined, cancel_date: cancelDate || undefined, cancel_date_reason: dateReason || undefined,
    }),
    enabled: open,
    placeholderData: (prev) => prev,
  });
  const voucher = useMutation({ mutationFn: () => api.post<{ id: string }>(`/reservations/${id}/voucher`), onSuccess: refresh });
  if (error) return <ErrorState message="This reservation could not be loaded." onRetry={() => refetch()} />;
  if (!data) return <PageSkeleton variant="record" />;
  const r = data.reservation;
  const canChange = can("reservation.status.change");
  const kind = (k: string) => reasons.data?.filter((x) => x.kind === k) ?? [];
  const asfBlocked = data.unpaid_asf_years.length > 0;
  const closed = ["DECLINED", "CANCELLED"].includes(r.status);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={<>Reservation <Mono>{r.reservation_number}</Mono></>}
        docTitle={`Reservation ${r.reservation_number}`}
        meta={<StatusBadge status={r.status} />}
        actions={<Link className={buttonClasses({ variant: "outline" })} href={`/members/${r.member_id}?tab=reservations`}><ExternalLink aria-hidden />Open member</Link>}
      />

      <Card>
        <StatusStepper path={PATH} current={r.status} offPath={["DECLINED", "CANCELLED", "RESCHEDULED"]} label="Reservation status" />
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card title="Stay">
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-3">
                <CalendarRange aria-hidden className="size-5 text-fg-subtle" />
                <div>
                  <p className={cn("text-lg font-semibold tabular-nums", r.status === "CANCELLED" && "text-fg-subtle line-through")}>{formatDate(r.check_in)} → {formatDate(r.check_out)}</p>
                  <p className="text-sm text-fg-muted">{r.nights} {r.nights === 1 ? "night" : "nights"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Users aria-hidden className="size-5 text-fg-subtle" />
                <p className="text-base">{r.adults} adult(s), {r.child_ages.length} child(ren)</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <SeasonChip code={r.season_code} />
                <CategoryChip code={r.resort_category_code} />
                <Chip>{humanize(r.occupancy_type)}</Chip>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-4">
              {([
                ["Confirmation no.", r.confirmation_number ? <Mono key="c">{r.confirmation_number}</Mono> : "—"],
                ["Additional paid nights", formatNights(r.additional_paid_nights)],
                ["Reschedules", r.reschedule_count],
                ["Season / category", `${r.season_code} / ${r.resort_category_code}`],
              ] as [string, React.ReactNode][]).map(([k, v]) => (
                <div key={k}><dt className="text-xs font-medium text-fg-subtle">{k}</dt><dd className="text-base">{v}</dd></div>
              ))}
            </dl>
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <section aria-label="Entitlement calculation" className="rounded-lg border border-primary/25 bg-primary-subtle/40 p-4 sm:p-5">
              <h2 className="mb-2 flex items-center gap-2 text-md font-semibold"><Calculator aria-hidden className="size-4 text-primary" />Entitlement</h2>
              <p className="flex items-baseline gap-2"><span className="text-3xl font-semibold tabular-nums text-primary">{formatNights(r.entitlement_nights)}</span><span className="text-base text-fg-muted">nights deducted</span></p>
              <p className="mt-2 rounded-md bg-surface px-3 py-2 font-mono text-sm text-fg-muted">{r.deduction_explanation}</p>
              {data.deduction ? (
                <div className="mt-3">
                  <p className="mb-1 flex items-center gap-2 text-sm text-fg-muted">Entitlement movement <StatusBadge status={data.deduction.state} size="sm" /></p>
                  <ul className="flex flex-col gap-1">
                    {data.deduction.plan.lines.map((l, i) => (
                      <li key={i} className="flex justify-between text-base"><span className="tabular-nums">{l.year} <span className="text-fg-subtle">({humanize(l.kind).toLowerCase()})</span></span><span className="font-medium tabular-nums">{formatNights(l.nights)}</span></li>
                    ))}
                  </ul>
                </div>
              ) : <p className="mt-3 text-sm text-fg-subtle">Nights are deducted when the reservation is approved.</p>}
            </section>

            <section aria-label="ASF for this booking" className={cn("rounded-lg border p-4 sm:p-5", asfBlocked ? "border-warning/40 bg-warning-subtle/50" : "border-border bg-surface")}>
              <h2 className="mb-2 flex items-center gap-2 text-md font-semibold"><Receipt aria-hidden className="size-4 text-fg-subtle" />ASF for this booking</h2>
              {data.asf_charges.length === 0 ? <p className="text-base text-fg-muted">No ASF raised by this booking.</p> : (
                <ul className="flex flex-col gap-1.5">{data.asf_charges.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-base">
                    <span className="tabular-nums">{c.membership_year}</span>
                    <span className="flex items-center gap-2"><Money value={c.total} currency={c.currency} /> <span className="text-xs text-fg-subtle">incl. GST</span> <StatusBadge status={c.status} size="sm" /></span>
                  </li>
                ))}</ul>
              )}
              {data.asf_charges.filter((c) => c.status === "WITHDRAWN").map((c) => (
                <p key={c.id} className="mt-2 text-sm text-fg-muted">ASF {c.membership_year} withdrawn on {formatDate(c.withdrawn_on)}: {c.withdrawn_reason}. A later booking in that year raises it again.</p>
              ))}
              {asfBlocked && <Alert kind="warning" className="mt-3">ASF unpaid for {data.unpaid_asf_years.join(", ")}. Confirmation is blocked until it is paid (agreement: non-payment of ASF results in non-confirmation).</Alert>}
              {data.payments.length > 0 && (
                <p className="mt-3 text-sm text-fg-muted">Linked payments: {data.payments.map((p) => <span key={p.id} className="mr-2 inline-block"><Mono>{p.receipt_number}</Mono> ({humanize(p.type)} <Money value={p.total} currency={p.currency} />)</span>)}</p>
              )}
            </section>
          </div>

          {can("reservation.update") && ["REQUESTED", "APPROVED", "CONFIRMED", "RESCHEDULED"].includes(r.status) && (
            <Card title="Reschedule" description="The original dates are kept in the date history.">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="New check-in" htmlFor="nci"><DateField id="nci" value={rs.check_in} onChange={(v) => setRs({ ...rs, check_in: v })} /></Field>
                <Field label="New check-out" htmlFor="nco"><DateField id="nco" value={rs.check_out} min={rs.check_in || undefined} onChange={(v) => setRs({ ...rs, check_out: v })} /></Field>
                <Field label="Reason" htmlFor="nr"><Input id="nr" value={rs.reason} onChange={(e) => setRs({ ...rs, reason: e.target.value })} /></Field>
                {r.reschedule_count >= 2 && <Field label="Override reason (3rd+ reschedule)" htmlFor="no"><Input id="no" value={rs.override_reason} onChange={(e) => setRs({ ...rs, override_reason: e.target.value })} /></Field>}
              </div>
              <Button className="mt-4" variant="outline" onClick={() => reschedule.mutate()} disabled={reschedule.isPending}>Reschedule</Button>
              <div className="mt-2"><ErrorText error={reschedule.error} /></div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {canChange && !closed && (
            <Card title="Actions">
              <div className="flex flex-col gap-4">
                {["REQUESTED", "RESCHEDULED"].includes(r.status) && (
                  <Button onClick={() => change.mutate("APPROVED")} disabled={change.isPending}><BadgeCheck aria-hidden />Approve (deduct entitlement)</Button>
                )}
                {["APPROVED", "RESCHEDULED"].includes(r.status) && (
                  <div className="flex flex-col gap-3 rounded-md border border-border p-3">
                    <Field label="Property confirmation number" htmlFor="cn"><Input id="cn" className="font-mono" value={conf} onChange={(e) => setConf(e.target.value)} /></Field>
                    {can("reservation.override") && <Field label="Override reason (only to bypass ASF gate)" htmlFor="ov"><Input id="ov" value={override} onChange={(e) => setOverride(e.target.value)} /></Field>}
                    {asfBlocked && (
                      <p id="confirm-blocked" className="flex gap-2 text-sm text-warning">
                        <Receipt aria-hidden className="mt-0.5 size-4 shrink-0" />
                        Blocked: ASF {data.unpaid_asf_years.join(", ")} unpaid. Record the ASF payment first{can("reservation.override") ? ", or give an override reason" : ""}.
                      </p>
                    )}
                    <Button onClick={() => change.mutate("CONFIRMED")} disabled={change.isPending} aria-describedby={asfBlocked ? "confirm-blocked" : undefined}>Confirm</Button>
                  </div>
                )}
                <div className="flex flex-col gap-3 rounded-md border border-border p-3">
                  <Field label="Decline / cancel reason" htmlFor="rr">
                    <Select id="rr" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
                      <option value="">Select…</option>
                      <optgroup label="Decline">{kind("DECLINE").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                      <optgroup label="Cancel">{kind("CANCEL").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                    </Select>
                  </Field>
                  <Field label="Explanation" htmlFor="rt"><Input id="rt" value={reasonText} onChange={(e) => setReasonText(e.target.value)} /></Field>
                  {terms.data?.confirmed && <WrittenRequestPicker memberId={r.member_id} reservationId={r.id} value={commRef} onChange={(v) => { setCommRef(v); setCancelDate(""); setDateReason(""); }} />}
                  <CancellationDetails terms={terms.data} cancelDate={cancelDate} onCancelDate={setCancelDate} dateReason={dateReason} onDateReason={setDateReason} />
                  <div className="flex flex-wrap gap-2">
                    {r.status !== "CONFIRMED" && <Button variant="outline" onClick={() => change.mutate("DECLINED")} disabled={change.isPending}>Decline</Button>}
                    <Button variant="destructive-outline" onClick={() => setConfirmCancel(true)}>Cancel reservation…</Button>
                  </div>
                </div>
                <ErrorText error={change.error} />
                {creditedBack(change.data) !== null && <Alert kind="info">Nights credited back: {creditedBack(change.data)}</Alert>}
              </div>
            </Card>
          )}
          {r.cancellation && (
            <Card title="Cancellation">
              <p className="text-base font-medium tabular-nums">{r.cancellation.summary}</p>
              <dl className="mt-3 flex flex-col gap-1.5 text-sm">
                <div><dt className="inline text-fg-subtle">Cancellation date: </dt><dd className="inline tabular-nums">{formatDate(r.cancellation.cancel_date)}{r.cancellation.date_source === "STAFF" ? ` (changed: ${r.cancellation.date_reason})` : r.cancellation.date_source === "CONFIRMATION" ? " (date of confirmation)" : " (request received)"}</dd></div>
                {r.cancellation.request && <div><dt className="inline text-fg-subtle">Written request: </dt><dd className="inline">{r.cancellation.request.kind === "email" ? "Email" : "Letter"} “{r.cancellation.request.label}”, received {formatDate(r.cancellation.request.received_on)}</dd></div>}
                <div><dt className="inline text-fg-subtle">Reason: </dt><dd className="inline">{r.cancellation.reason}{r.cancellation.reason_text ? `: ${r.cancellation.reason_text}` : ""}</dd></div>
                {r.cancellation.asf_withdrawn.length > 0 && <div><dt className="inline text-fg-subtle">ASF withdrawn: </dt><dd className="inline">{r.cancellation.asf_withdrawn.join(", ")}</dd></div>}
              </dl>
              <p className="mt-3 text-xs text-fg-subtle">Nothing is sent automatically: share the letter with the member and the property.</p>
            </Card>
          )}
          {data.documents.length > 0 && (
            <Card title="Letters and vouchers">
              <ul className="flex flex-col gap-2">{data.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <DocLink id={d.id} label={d.type === "CANCELLATION_LETTER" ? "Cancellation letter" : d.type === "VOUCHER" ? "Voucher" : d.file_name} />
                  {d.voided_at && <StatusBadge status="CANCELLED" size="sm" />}
                  <span className="text-xs text-fg-subtle">{formatDateTime(d.created_at)}</span>
                  {d.void_reason && <span className="basis-full text-xs text-fg-muted">{d.void_reason}. Kept for the record; no longer valid.</span>}
                </li>
              ))}</ul>
            </Card>
          )}
          {r.status === "CONFIRMED" && can("letter.generate") && (
            <Card title="Voucher">
              <Button variant="outline" onClick={() => voucher.mutate()} disabled={voucher.isPending}><FileDown aria-hidden />Generate confirmation / voucher PDF</Button>
              {voucher.data && <div className="mt-2"><DocLink id={voucher.data.id} label="Open voucher" /></div>}
              <ErrorText error={voucher.error} />
            </Card>
          )}
          <Card title="Date history">
            <ol className="flex flex-col gap-2">{r.date_versions.map((v) => (
              <li key={v.version_no} className="text-base">
                <span className="mr-2 rounded-sm bg-surface-sunken px-1.5 text-xs font-medium text-fg-muted">v{v.version_no}</span>
                <span className="tabular-nums">{formatDate(v.check_in)} → {formatDate(v.check_out)}</span> <span className="text-fg-muted">({formatNights(v.entitlement_nights)} nights)</span>
                {v.reason && <span className="block pl-8 text-sm text-fg-subtle">{v.reason}</span>}
              </li>
            ))}</ol>
          </Card>
          <Card title="Status history">
            <ol className="flex flex-col gap-2">{r.status_history.map((h, i) => (
              <li key={i} className="text-base">
                <span className="block text-xs tabular-nums text-fg-subtle">{formatDateTime(h.changed_at)}</span>
                {h.from_status ? humanize(h.from_status) : "—"} → <span className="font-medium">{humanize(h.to_status)}</span>
                {h.override && <span className="ml-1 rounded-sm bg-warning-subtle px-1 text-xs font-medium text-warning">override</span>}
                {h.reason_text && <span className="block text-sm text-fg-muted">{h.reason_text}</span>}
              </li>
            ))}</ol>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel this reservation?"
        description={<>Reservation <Mono>{r.reservation_number}</Mono> will be cancelled using the reason and explanation entered in Actions. Nights are credited back according to the cancellation tiers.</>}
        reasonLabel={null}
        confirmLabel="Cancel reservation"
        pending={change.isPending}
        onConfirm={() => change.mutate("CANCELLED")}
      >
        {!reasonId && <Alert kind="warning">No cancellation reason selected yet.</Alert>}
        {terms.data && <CancellationOutcome terms={terms.data} />}
        <ErrorText error={change.error} />
      </ConfirmDialog>
    </div>
  );
}
