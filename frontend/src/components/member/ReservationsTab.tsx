"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ErrorText, useCan, useMaster } from "@/components/providers";
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import type { Member, Quote, Reservation } from "@/lib/types";

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

export function ReservationForm({ member, onCreated }: { member: Member; onCreated: () => void }) {
  const destinations = useMaster("destinations");
  const properties = useMaster("properties");
  const units = useMaster("unit-types");
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
  });
  useEffect(() => { if (f.destination_id && !properties.data?.some((p) => p.id === f.property_id && p.destination_id === f.destination_id)) set("property_id", ""); }, [f.destination_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useMutation({ mutationFn: () => api.post(`/members/${member.id}/reservations`, body(f)), onSuccess: onCreated });
  const q = quote.data;
  return (
    <Card title="New reservation request">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Destination" htmlFor="rd"><Select id="rd" value={f.destination_id} onChange={(e) => set("destination_id", e.target.value)}><option value="">Select…</option>{destinations.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Property" htmlFor="rp"><Select id="rp" value={f.property_id} onChange={(e) => set("property_id", e.target.value)}><option value="">Select…</option>{properties.data?.filter((p) => p.destination_id === f.destination_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Unit type" htmlFor="ru"><Select id="ru" value={f.unit_type_id} onChange={(e) => set("unit_type_id", e.target.value)}>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.code} {u.name}</option>)}</Select></Field>
        <Field label="Check-in" htmlFor="rci"><Input id="rci" type="date" value={f.check_in} onChange={(e) => set("check_in", e.target.value)} /></Field>
        <Field label="Check-out" htmlFor="rco"><Input id="rco" type="date" value={f.check_out} onChange={(e) => set("check_out", e.target.value)} /></Field>
        <Field label="Rooms" htmlFor="rr"><Input id="rr" type="number" min={1} value={f.rooms} onChange={(e) => set("rooms", Number(e.target.value))} /></Field>
        <Field label="Adults" htmlFor="ra"><Input id="ra" type="number" min={1} value={f.adults} onChange={(e) => set("adults", Number(e.target.value))} /></Field>
        <Field label="Children's ages (comma separated)" htmlFor="rc"><Input id="rc" value={f.child_ages} onChange={(e) => set("child_ages", e.target.value)} placeholder="e.g. 6, 9" /></Field>
        <Field label="Occupancy" htmlFor="ro"><Select id="ro" value={f.occupancy_type} onChange={(e) => set("occupancy_type", e.target.value as Form["occupancy_type"])}><option>SELF</option><option>GIFT</option><option>RENT</option></Select></Field>
        {f.occupancy_type !== "SELF" && (<>
          <Field label="Lead guest name" htmlFor="rg"><Input id="rg" value={f.guest_name} onChange={(e) => set("guest_name", e.target.value)} /></Field>
          <Field label="Lead guest contact" htmlFor="rgc"><Input id="rgc" value={f.guest_contact} onChange={(e) => set("guest_contact", e.target.value)} /></Field>
          <Field label="Member's email/call ref (email:<id> or call:<id>)" htmlFor="rmc"><Input id="rmc" value={f.member_communication_ref} onChange={(e) => set("member_communication_ref", e.target.value)} /></Field>
        </>)}
        <Field label="Remarks" htmlFor="rrm" className="md:col-span-3"><Textarea id="rrm" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} /></Field>
      </div>
      {q && (
        <div className="mt-4 flex flex-col gap-2" aria-live="polite">
          <Alert kind="info">
            <p className="font-medium">Entitlement calculation</p>
            <p>{q.explanation}</p>
            <p>Uses: {q.plan.map((p) => `${p.nights} night(s) from ${p.year} (${p.kind.toLowerCase()})`).join(", ") || "—"}</p>
            <p>Entitlement nights: <strong>{q.entitlement_nights}</strong>{q.additional_paid_nights !== "0" && q.additional_paid_nights !== "0.0" ? ` · Additional paid nights: ${q.additional_paid_nights}` : ""}</p>
            <p>ASF payable: {q.asf.filter((a) => a.new).map((a) => `${a.membership_year}: ${formatMoney(a.total, a.currency)} incl. GST`).join(", ") || "none (already raised for these years)"}</p>
          </Alert>
          {q.blocking.map((b) => <Alert key={b} kind="error">{b}</Alert>)}
          {q.window_warnings.length > 0 && (
            <Alert kind="warning">{q.window_warnings.join("; ")}
              <Field label="Override reason" htmlFor="rwo" className="mt-2"><Input id="rwo" value={f.window_override_reason} onChange={(e) => set("window_override_reason", e.target.value)} /></Field>
            </Alert>
          )}
          {q.occupancy_problems.length > 0 && (
            <Alert kind="warning">{q.occupancy_problems.join("; ")}. Choose a larger unit type, or
              <label className="ml-2"><input type="checkbox" checked={f.occupancy_resolution === "UPGRADE_CHARGE"} onChange={(e) => set("occupancy_resolution", e.target.checked ? "UPGRADE_CHARGE" : "")} /> add an upgrade charge</label>
            </Alert>
          )}
          {q.gift_rent_problems.map((g) => <Alert key={g} kind="warning">{g}</Alert>)}
          {q.additional_paid_nights !== "0" && q.additional_paid_nights !== "0.0" && (
            <label className="text-sm"><input type="checkbox" checked={f.accept_additional_paid_nights} onChange={(e) => set("accept_additional_paid_nights", e.target.checked)} /> Book {q.additional_paid_nights} night(s) as paid additional nights</label>
          )}
        </div>
      )}
      <ErrorText error={quote.error ?? create.error} />
      <div className="mt-3 flex justify-end"><Button disabled={!q || q.blocking.length > 0 || create.isPending} onClick={() => create.mutate()}>Submit request</Button></div>
    </Card>
  );
}

export function ReservationsTab({ member }: { member: Member }) {
  const qc = useQueryClient();
  const can = useCan();
  const [showForm, setShowForm] = useState(false);
  const list = useQuery({ queryKey: ["reservations", member.id], queryFn: () => api.get<Page<Reservation>>("/reservations", { member_id: member.id, page_size: 100 }) });
  return (
    <div className="flex flex-col gap-4 pt-4">
      {member.status !== "ACTIVE" && <Alert kind="warning">Reservations are only allowed for ACTIVE members.</Alert>}
      {can("reservation.create") && member.status === "ACTIVE" && !showForm && <Button className="self-start" onClick={() => setShowForm(true)}>New reservation</Button>}
      {showForm && <ReservationForm member={member} onCreated={() => { setShowForm(false); qc.invalidateQueries(); }} />}
      <Card title="Reservations">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left"><th>No.</th><th>Check-in</th><th>Check-out</th><th>Nights</th><th>Entitlement</th><th>Season</th><th>Status</th></tr></thead>
          <tbody>{list.data?.items.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td><Link className="underline" href={`/reservations/${r.id}`}>{r.reservation_number}</Link></td>
              <td>{formatDate(r.check_in)}</td><td>{formatDate(r.check_out)}</td><td>{r.nights}</td><td>{r.entitlement_nights}</td><td>{r.season_code}</td><td><Badge>{r.status}</Badge></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
    </div>
  );
}
