"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ErrorText, useCan, useMaster, useStaff } from "@/components/providers";
import { Alert, Button, Card, Field, Input, KeyValue, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import type { Member } from "@/lib/types";

type Summary = { purchase_price: string; admin_fees: string; total_price: string; down_payment: string; down_payment_received: string; balance: string; balance_display: string; currency: string; credit_balance: string };

export function ProfileTab({ member: m }: { member: Member }) {
  const qc = useQueryClient();
  const can = useCan();
  const cats = useMaster("resort-categories");
  const seasons = useMaster("seasons");
  const units = useMaster("unit-types");
  const staff = useStaff();
  const name = (rows: { id: string; name: string }[] | undefined, id: string | null) => rows?.find((r) => r.id === id)?.name ?? "—";
  const summary = useQuery({ queryKey: ["fin-summary", m.id], queryFn: () => api.get<Summary>(`/members/${m.id}/finance-summary`), enabled: can("finance.view") });
  const check = useQuery({
    queryKey: ["approval-check", m.id],
    queryFn: () => api.get<{ can_approve: boolean; blockers: string[] }>(`/members/${m.id}/approval-check`),
    enabled: m.status === "PENDING_APPROVAL",
  });
  const approve = useMutation({
    mutationFn: () => api.post(`/members/${m.id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["member", m.id] }),
  });
  const [kyc, setKyc] = useState<Record<string, string>>({});
  const reveal = async (id: string) => {
    const r = await api.post<{ value: string }>(`/kyc/${id}/reveal`);
    setKyc((k) => ({ ...k, [id]: r.value }));
  };
  const [editing, setEditing] = useState(false);
  const [comments, setComments] = useState(m.comments ?? "");
  const [rm, setRm] = useState(m.relationship_manager_id ?? "");
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => api.patch(`/members/${m.id}`, { version: m.version, comments, relationship_manager_id: rm || null, reason: reason || null }),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ["member", m.id] }); },
  });
  const s = summary.data;
  return (
    <div className="flex flex-col gap-4 pt-4">
      {m.status === "PENDING_APPROVAL" && (
        <Card title="Approval">
          {check.data?.blockers.length ? (
            <Alert kind="warning"><p className="font-medium">Activation is blocked:</p><ul className="ml-4 list-disc">{check.data.blockers.map((b) => <li key={b}>{b}</li>)}</ul></Alert>
          ) : <Alert kind="success">All checks passed. The member can be approved.</Alert>}
          {can("member.approve") && (
            <Button className="mt-3" disabled={!check.data?.can_approve || approve.isPending} onClick={() => approve.mutate()}>Approve member</Button>
          )}
          <ErrorText error={approve.error} />
        </Card>
      )}
      <Card title="Purchaser (Member) details" actions={can("member.update") && !editing ? <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button> : null}>
        {m.applicants.map((a) => (
          <div key={a.id} className="mb-4">
            <p className="mb-1 text-sm font-semibold">{a.position === 1 ? "1st" : "2nd"} applicant</p>
            <KeyValue items={[
              ["Name", a.full_name], ["D.O.B", formatDate(a.dob)], ["Mobile", a.mobile], ["Email", a.email],
              ...a.kyc.map((k): [string, React.ReactNode] => [k.id_type, (
                <span key={k.id}>{kyc[k.id] ?? k.masked}{" "}
                  {can("kyc.view_full") && !kyc[k.id] && k.id_type !== "AADHAAR" && (
                    <button className="text-xs underline" onClick={() => reveal(k.id)}>Show (logged)</button>
                  )}
                </span>
              )]),
            ]} />
          </div>
        ))}
        <KeyValue items={[
          ["Address", [m.address_line1, m.address_line2, m.city, m.state, m.postcode, m.country].filter(Boolean).join(", ")],
          ["Email", m.email],
        ]} />
      </Card>
      <Card title="Membership details">
        <KeyValue items={[
          ["Membership number", m.membership_number], ["Purchase date", formatDate(m.purchase_date)], ["Tenure", `${m.tenure_years} years`],
          ["Years of use", `${m.first_year_of_use} – ${m.last_year_of_use}`], ["Category", name(cats.data, m.resort_category_id)],
          ["Season", name(seasons.data, m.season_id)], ["Unit type", name(units.data, m.unit_type_id)], ["Nights per year", m.nights_per_year],
          ["Relationship manager", staff.data?.find((u) => u.id === m.relationship_manager_id)?.full_name ?? "—"],
          ["Team manager", staff.data?.find((u) => u.id === m.team_manager_id)?.full_name ?? "—"],
          ["Approved", m.approved_at ? formatDate(m.approved_at) : "—"],
          ["Source lead", m.source_lead_id ? <Link className="underline" href={`/leads/${m.source_lead_id}`}>Open lead</Link> : "—"],
          ["OPC", m.opc_name],
          ["Agreement signed", [m.agreement_signed_applicant1 && "Applicant 1", m.agreement_signed_applicant2 && "Applicant 2", m.agreement_signed_company && "Company"].filter(Boolean).join(", ") || "—"],
        ]} />
        {m.joining_offers.length > 0 && <p className="mt-2 text-sm">Joining offers: {m.joining_offers.map((o) => `${o.description}${o.nights ? ` (${o.nights} nights)` : ""}`).join("; ")}</p>}
        {Object.keys(m.custom_fields).length > 0 && <KeyValue items={Object.entries(m.custom_fields).map(([k, v]) => [k, String(v)])} />}
        <p className="mt-2 text-sm"><span className="text-muted-foreground">Comments:</span> {m.comments ?? "—"}</p>
      </Card>
      {editing && (
        <Card title="Edit profile">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Relationship manager" htmlFor="erm">
              <Select id="erm" value={rm} onChange={(e) => setRm(e.target.value)}><option value="">—</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select>
            </Field>
            <Field label="Reason for change (recorded in history)" htmlFor="ere"><Input id="ere" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Field label="Comments" htmlFor="eco" className="md:col-span-2"><Textarea id="eco" value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex gap-2"><Button onClick={() => save.mutate()}>Save</Button><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
          <ErrorText error={save.error} />
        </Card>
      )}
      {s && (
        <Card title="Financial summary (live from Finance)" actions={<Link className="text-sm underline" href={`/members/${m.id}?tab=finance`}>Open Finance tab</Link>}>
          <KeyValue items={[
            ["Purchase price", formatMoney(s.purchase_price, s.currency)], ["Admin fees", formatMoney(s.admin_fees, s.currency)],
            ["Total price", formatMoney(s.total_price, s.currency)], ["Down payment", formatMoney(s.down_payment, s.currency)],
            ["Balance", s.balance_display === "NIL" ? "NIL" : formatMoney(s.balance, s.currency)], ["Credit carried forward", formatMoney(s.credit_balance, s.currency)],
          ]} />
        </Card>
      )}
    </div>
  );
}
