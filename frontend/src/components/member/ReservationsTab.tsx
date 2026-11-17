"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, CalendarPlus, Receipt, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Money, Mono, SeasonChip } from "@/components/crm/Display";
import { TableSkeleton } from "@/components/crm/States";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { Table, Td, Th, THead, Tr } from "@/components/crm/Table";
import { useToast } from "@/components/crm/Toast";
import { ErrorText, useCan, useMaster } from "@/components/providers";
import { Alert, Button, Card, Checkbox, Empty, Field, Input, Select, Textarea } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { formatDate, formatMoney, formatNights, humanize } from "@/lib/format";
import type { Member, Quote, Reservation } from "@/lib/types";
import { cn } from "@/lib/utils";

type Form = {
  destination_id: string; property_id: string; unit_type_id: string; rooms: number; adults: number; child_ages: string;
  occupancy_type: "SELF" | "GIFT" | "RENT"; guest_name: string; guest_contact: string; member_communication_ref: string;
  check_in: string; check_out: string; remarks: string; window_override_reason: string; accept_additional_paid_nights: boolean;
  occupancy_resolution: string;
};

function body(f: Form) {
  return {
    ...f,
    child_ages: f.child_ages.split(",").map((s) => s.trim()).filter(Boolean).map(Number),
    guest_name: f.guest_name || null, guest_contact: f.guest_contact || null,
    member_communication_ref: f.member_communication_ref || null, remarks: f.remarks || null,
    window_override_reason: f.window_override_reason || null,
    occupancy_resolution: f.occupancy_resolution || null,
  };
}

/** Live summary of the quote: deduction calculation, years used, ASF, and every warning or block. */
function QuoteSummary({ q, f, set, loading, ready }: { q?: Quote; f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; loading: boolean; ready: boolean }) {
  if (!ready) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-sunken/50 p-5 text-center text-base text-fg-muted">
        <Calculator aria-hidden className="mx-auto mb-2 size-6 text-fg-subtle" />
        Choose a destination, property and dates to see the nights deducted and any ASF due.
      </div>
    );
  }
  if (!q) return <div className="rounded-lg border border-border bg-surface p-4"><TableSkeleton rows={4} cols={2} /></div>;
  const paidNights = q.additional_paid_nights !== "0" && q.additional_paid_nights !== "0.0";
  const newAsf = q.asf.filter((a) => a.new);
  return (
    <div className={cn("flex flex-col gap-3", loading && "opacity-70")} aria-live="polite" aria-busy={loading}>
      <section aria-label="Entitlement calculation" className="rounded-lg border border-primary/25 bg-primary-subtle/40 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold"><Calculator aria-hidden className="size-4 text-primary" />Entitlement calculation</h3>
          {q.season_code && <SeasonChip code={q.season_code} />}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums text-primary">{formatNights(q.entitlement_nights)}</span>
          <span className="text-base text-fg-muted">nights deducted for a {q.stay_nights}-night stay</span>
        </div>
        <p className="mt-2 rounded-md bg-surface px-3 py-2 font-mono text-sm text-fg-muted">{q.explanation}</p>
        <p className="mt-2 text-base">Uses: {q.plan.map((p) => `${p.nights} night(s) from ${p.year} (${p.kind.toLowerCase()})`).join(", ") || "—"}</p>
        <p className="text-base">Entitlement nights: <strong className="tabular-nums">{q.entitlement_nights}</strong>{paidNights ? ` · Additional paid nights: ${q.additional_paid_nights}` : ""}</p>
      </section>

      <section aria-label="Annual Subscription Fee" className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-2 flex items-center gap-2 text-base font-semibold"><Receipt aria-hidden className="size-4 text-fg-subtle" />Annual Subscription Fee (ASF)</h3>
        {q.asf.length > 0 && (
          <ul className="mb-2 flex flex-col gap-1">
            {q.asf.map((a) => (
              <li key={a.membership_year} className="flex items-center justify-between gap-2 text-base">
                <span className="tabular-nums">{a.membership_year}</span>
                <span className="flex items-center gap-2">
                  <Money value={a.total} currency={a.currency} />
                  {a.new ? <StatusBadge status="RAISED" size="sm" /> : a.status ? <StatusBadge status={a.status} size="sm" /> : <span className="text-xs text-fg-subtle">already raised</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-fg-muted">ASF payable: {newAsf.map((a) => `${a.membership_year}: ${formatMoney(a.total, a.currency)} incl. GST`).join(", ") || "none (already raised for these years)"}</p>
        {newAsf.length > 0 && <p className="mt-1 text-xs text-fg-subtle">Confirmation stays blocked until this ASF is paid.</p>}
      </section>

      {q.blocking.map((b) => <Alert key={b} kind="error">{b}</Alert>)}
      {q.window_warnings.length > 0 && (
        <Alert kind="warning" title="Outside the booking window">
          <p>{q.window_warnings.join("; ")}</p>
          <Field label="Override reason" htmlFor="rwo" className="mt-2"><Input id="rwo" value={f.window_override_reason} onChange={(e) => set("window_override_reason", e.target.value)} /></Field>
        </Alert>
      )}
      {q.occupancy_problems.length > 0 && (
        <Alert kind="warning" title="Occupancy check">
          <p>{q.occupancy_problems.join("; ")}. Choose a larger unit type, or</p>
          <Checkbox label="add an upgrade charge" checked={f.occupancy_resolution === "UPGRADE_CHARGE"} onChange={(e) => set("occupancy_resolution", e.target.checked ? "UPGRADE_CHARGE" : "")} />
        </Alert>
      )}
      {q.gift_rent_problems.map((g) => <Alert key={g} kind="warning">{g}</Alert>)}
      {paidNights && (
        <Alert kind="info">
          <Checkbox label={`Book ${q.additional_paid_nights} night(s) as paid additional nights`} checked={f.accept_additional_paid_nights} onChange={(e) => set("accept_additional_paid_nights", e.target.checked)} />
        </Alert>
      )}
      {!q.blocking.length && !q.window_warnings.length && !q.occupancy_problems.length && !q.gift_rent_problems.length && (
        <Alert kind="success">No problems found. The request can be submitted.</Alert>
      )}
    </div>
  );
}

export function ReservationForm({ member, onCreated, onCancel }: { member: Member; onCreated: () => void; onCancel?: () => void }) {
  const destinations = useMaster("destinations");
  const properties = useMaster("properties");
  const units = useMaster("unit-types");
  const toast = useToast();
  const [f, setF] = useState<Form>({
    destination_id: "", property_id: "", unit_type_id: member.unit_type_id, rooms: 1, adults: 2, child_ages: "",
    occupancy_type: "SELF", guest_name: "", guest_contact: "", member_communication_ref: "", check_in: "", check_out: "",
    remarks: "", window_override_reason: "", accept_additional_paid_nights: false, occupancy_resolution: "",
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const ready = f.destination_id && f.property_id && f.check_in && f.check_out && f.check_out > f.check_in;
  const quoteKey = useMemo(() => JSON.stringify(body(f)), [f]);
  const quote = useQuery({
    queryKey: ["quote", member.id, quoteKey],
    queryFn: () => api.post<Quote>(`/members/${member.id}/reservations/quote`, body(f)),
    enabled: !!ready,
    placeholderData: (prev) => prev,
  });
  useEffect(() => { if (f.destination_id && !properties.data?.some((p) => p.id === f.property_id && p.destination_id === f.destination_id)) set("property_id", ""); }, [f.destination_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useMutation({ mutationFn: () => api.post(`/members/${member.id}/reservations`, body(f)), onSuccess: () => { toast.success("Reservation requested"); onCreated(); } });
  const q = ready ? quote.data : undefined;
  return (
    <Card title="New reservation request" description={<>For <Mono>{member.membership_number}</Mono>. Fields update the summary as you type.</>}>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-3">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Where</legend>
            <Field label="Destination" htmlFor="rd" required><Select id="rd" value={f.destination_id} onChange={(e) => set("destination_id", e.target.value)}><option value="">Select…</option>{destinations.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <Field label="Property" htmlFor="rp" required><Select id="rp" value={f.property_id} onChange={(e) => set("property_id", e.target.value)} disabled={!f.destination_id}><option value="">{f.destination_id ? "Select…" : "Choose a destination first"}</option>{properties.data?.filter((p) => p.destination_id === f.destination_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Unit type" htmlFor="ru"><Select id="ru" value={f.unit_type_id} onChange={(e) => set("unit_type_id", e.target.value)}>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.code} {u.name}</option>)}</Select></Field>
            <Field label="Rooms" htmlFor="rr"><Input id="rr" type="number" min={1} className="w-24" value={f.rooms} onChange={(e) => set("rooms", Number(e.target.value))} /></Field>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">When</legend>
            <Field label="Check-in" htmlFor="rci" required><Input id="rci" type="date" value={f.check_in} onChange={(e) => set("check_in", e.target.value)} /></Field>
            <Field label="Check-out" htmlFor="rco" required error={f.check_in && f.check_out && f.check_out <= f.check_in ? "Check-out must be after check-in" : undefined}><Input id="rco" type="date" min={f.check_in || undefined} value={f.check_out} onChange={(e) => set("check_out", e.target.value)} /></Field>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-subtle"><Users aria-hidden className="size-3.5" />Who</legend>
            <Field label="Adults" htmlFor="ra"><Input id="ra" type="number" min={1} className="w-24" value={f.adults} onChange={(e) => set("adults", Number(e.target.value))} /></Field>
            <Field label="Children's ages (comma separated)" htmlFor="rc"><Input id="rc" value={f.child_ages} onChange={(e) => set("child_ages", e.target.value)} placeholder="e.g. 6, 9" /></Field>
            <Field label="Occupancy" htmlFor="ro"><Select id="ro" value={f.occupancy_type} onChange={(e) => set("occupancy_type", e.target.value as Form["occupancy_type"])}><option value="SELF">Self</option><option value="GIFT">Gift</option><option value="RENT">Rent</option></Select></Field>
            {f.occupancy_type !== "SELF" && (<>
              <Field label="Lead guest name" htmlFor="rg"><Input id="rg" value={f.guest_name} onChange={(e) => set("guest_name", e.target.value)} /></Field>
              <Field label="Lead guest contact" htmlFor="rgc"><Input id="rgc" value={f.guest_contact} onChange={(e) => set("guest_contact", e.target.value)} /></Field>
              <Field label="Member's email/call ref (email:<id> or call:<id>)" htmlFor="rmc"><Input id="rmc" className="font-mono" value={f.member_communication_ref} onChange={(e) => set("member_communication_ref", e.target.value)} /></Field>
            </>)}
            <Field label="Remarks" htmlFor="rrm" className="sm:col-span-2"><Textarea id="rrm" rows={2} value={f.remarks} onChange={(e) => set("remarks", e.target.value)} /></Field>
          </fieldset>
        </div>
        <aside aria-label="Reservation summary" className="lg:col-span-2">
          <div className="flex flex-col gap-3 lg:sticky lg:top-24">
            <QuoteSummary q={q} f={f} set={set} loading={quote.isFetching} ready={!!ready} />
            <ErrorText error={quote.error ?? create.error} />
            <div className="flex justify-end gap-2">
              {onCancel && <Button variant="ghost" onClick={onCancel}>Discard</Button>}
              <Button disabled={!q || q.blocking.length > 0 || create.isPending || quote.isFetching} onClick={() => create.mutate()}>
                <CalendarPlus aria-hidden />{create.isPending ? "Submitting…" : "Submit request"}
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </Card>
  );
}

export function ReservationsTab({ member }: { member: Member }) {
  const qc = useQueryClient();
  const can = useCan();
  const [showForm, setShowForm] = useState(false);
  const list = useQuery({ queryKey: ["reservations", member.id], queryFn: () => api.get<Page<Reservation>>("/reservations", { member_id: member.id, page_size: 100 }) });
  const canCreate = can("reservation.create") && member.status === "ACTIVE";
  return (
    <div className="flex flex-col gap-4 pt-1">
      {member.status !== "ACTIVE" && <Alert kind="warning">Reservations are only allowed for ACTIVE members.</Alert>}
      {canCreate && !showForm && <Button className="self-start" onClick={() => setShowForm(true)}><CalendarPlus aria-hidden />New reservation</Button>}
      {showForm && <ReservationForm member={member} onCancel={() => setShowForm(false)} onCreated={() => { setShowForm(false); qc.invalidateQueries(); }} />}
      <Card title="Reservations">
        {!list.data ? <TableSkeleton rows={3} cols={6} /> : list.data.items.length === 0 ? (
          <Empty>{canCreate ? "No reservations yet. Use New reservation to request a stay." : "No reservations yet."}</Empty>
        ) : (
          <Table caption="Reservations">
            <THead><tr><Th>No.</Th><Th>Check-in</Th><Th>Check-out</Th><Th align="right">Nights</Th><Th align="right">Entitlement</Th><Th>Season</Th><Th>Status</Th></tr></THead>
            <tbody>{list.data.items.map((r) => {
              const off = r.status === "CANCELLED" || r.status === "DECLINED";
              return (
                <Tr key={r.id} tone={off ? "muted" : undefined}>
                  <Td><Link className="font-mono font-medium text-primary hover:underline" href={`/reservations/${r.id}`}>{r.reservation_number}</Link></Td>
                  <Td className={cn("tabular-nums", r.status === "CANCELLED" && "line-through")}>{formatDate(r.check_in)}</Td>
                  <Td className={cn("tabular-nums", r.status === "CANCELLED" && "line-through")}>{formatDate(r.check_out)}</Td>
                  <Td align="right">{r.nights}</Td><Td align="right">{formatNights(r.entitlement_nights)}</Td>
                  <Td><SeasonChip code={r.season_code} name={humanize(r.season_code)} /></Td><Td><StatusBadge status={r.status} /></Td>
                </Tr>
              );
            })}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
