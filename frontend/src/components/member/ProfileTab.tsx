"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CategoryChip, Money, Mono, SeasonChip } from "@/components/crm/Display";
import { MaskedValue } from "@/components/crm/States";
import { useToast } from "@/components/crm/Toast";
import { ErrorText, useCan, useMaster, useStaff } from "@/components/providers";
import { Alert, Button, Card, Field, Input, Kbd, KeyValue, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatNights, formatPhone, humanize } from "@/lib/format";
import type { Member } from "@/lib/types";
import { useSaveShortcut } from "@/lib/useShortcut";

type Summary = { purchase_price: string; admin_fees: string; total_price: string; down_payment: string; down_payment_received: string; balance: string; balance_display: string; currency: string; credit_balance: string };

export function ProfileTab({ member: m }: { member: Member }) {
  const qc = useQueryClient();
  const can = useCan();
  const toast = useToast();
  const cats = useMaster("resort-categories");
  const seasons = useMaster("seasons");
  const units = useMaster("unit-types");
  const venues = useMaster("venues", true);
  const properties = useMaster("properties", true);
  const staff = useStaff();
  const row = (rows: { id: string; name: string; code: string }[] | undefined, id: string | null) => rows?.find((r) => r.id === id);
  const summary = useQuery({ queryKey: ["fin-summary", m.id], queryFn: () => api.get<Summary>(`/members/${m.id}/finance-summary`), enabled: can("finance.view") });
  const check = useQuery({
    queryKey: ["approval-check", m.id],
    queryFn: () => api.get<{ can_approve: boolean; blockers: string[] }>(`/members/${m.id}/approval-check`),
    enabled: m.status === "PENDING_APPROVAL",
  });
  const approve = useMutation({
    mutationFn: () => api.post(`/members/${m.id}/approve`, {}),
    // approval creates the entitlement rows and changes the money position: refresh everything about this member
    // (header nights, Entitlement tab, finance summary), not just the member record
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[1]) === m.id || q.queryKey[0] === "member" });
      toast.success("Member approved", "Entitlement has been created for each membership year.");
    },
  });
  const reveal = async (id: string) => (await api.post<{ value: string }>(`/kyc/${id}/reveal`)).value;
  const [editing, setEditing] = useState(false);
  const [comments, setComments] = useState(m.comments ?? "");
  const [rm, setRm] = useState(m.relationship_manager_id ?? "");
  const [homeProperty, setHomeProperty] = useState(m.home_property_id ?? "");
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => api.patch(`/members/${m.id}`, { version: m.version, comments, relationship_manager_id: rm || null, home_property_id: homeProperty || null, reason: reason || null }),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ["member", m.id] }); toast.success("Profile saved"); },
  });
  useSaveShortcut(() => save.mutate(), editing);
  const s = summary.data;
  const cat = row(cats.data, m.resort_category_id);
  const season = row(seasons.data, m.season_id);
  const unit = row(units.data, m.unit_type_id);
  const staffName = (id: string | null) => staff.data?.find((u) => u.id === id)?.full_name ?? "—";
  return (
    <div className="flex flex-col gap-4 pt-1">
      {m.status === "PENDING_APPROVAL" && (
        <Card title="Approval" description="A manager approves the application once the agreement and KYC are complete.">
          {check.data?.blockers.length ? (
            <Alert kind="warning" title="Activation is blocked:"><ul className="mt-1 list-disc pl-4">{check.data.blockers.map((b) => <li key={b}>{b}</li>)}</ul></Alert>
          ) : check.data ? <Alert kind="success">All checks passed. The member can be approved.</Alert> : null}
          {can("member.approve") && (
            <Button className="mt-3" disabled={!check.data?.can_approve || approve.isPending} onClick={() => approve.mutate()}>
              <BadgeCheck aria-hidden />Approve member
            </Button>
          )}
          <ErrorText error={approve.error} />
        </Card>
      )}

      <Card title="Purchaser (Member) details">
        <div className="flex flex-col gap-5">
          {m.applicants.map((a) => (
            <div key={a.id}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">{a.position === 1 ? "1st" : "2nd"} applicant</p>
              <KeyValue items={[
                ["Name", a.full_name], ["D.O.B", formatDate(a.dob)], ["Mobile", <span key="m" className="tabular-nums">{formatPhone(a.mobile)}</span>], ["Email", a.email],
                ...a.kyc.map((k): [string, React.ReactNode] => [humanize(k.id_type), (
                  <MaskedValue key={k.id} masked={k.masked} label={`${humanize(k.id_type)} number`}
                    canReveal={can("kyc.view_full") && k.id_type !== "AADHAAR"} onReveal={() => reveal(k.id)} />
                )]),
              ]} />
            </div>
          ))}
          <div className="border-t border-border pt-4">
            <KeyValue items={[
              ["Address", [m.address_line1, m.address_line2, m.city, m.state, m.postcode, m.country].filter(Boolean).join(", ")],
              ["Email", m.email],
            ]} />
          </div>
        </div>
      </Card>

      <Card
        title="Membership details"
        actions={can("member.update") && !editing ? <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil aria-hidden />Edit</Button> : null}
      >
        <KeyValue items={[
          ["Membership number", <Mono key="n">{m.membership_number}</Mono>], ["Purchase date", formatDate(m.purchase_date)], ["Tenure", `${m.tenure_years} years`],
          ["Years of use", `${m.first_year_of_use} – ${m.last_year_of_use}`],
          ["Category", cat ? <CategoryChip key="c" code={cat.code} name={cat.name} /> : "—"],
          ["Season", season ? <SeasonChip key="s" code={season.code} name={season.name} /> : "—"],
          ["Unit type", unit?.name ?? "—"], ["Nights per year", formatNights(m.nights_per_year)],
          ...(editing ? [] : [["Relationship manager", staffName(m.relationship_manager_id)] as [string, React.ReactNode]]),
          ["Team manager", staffName(m.team_manager_id)],
          ["Approved", m.approved_at ? formatDate(m.approved_at) : "—"],
          ["Source lead", m.source_lead_id ? <Link key="l" className="font-medium text-primary hover:underline" href={`/leads/${m.source_lead_id}`}>Open lead</Link> : "—"],
          ["OPC", m.opc_name],
          ["Sales venue", row(venues.data, m.venue_id)?.name ?? "—"],
          ...(editing ? [] : [["Home property", row(properties.data, m.home_property_id)?.name ?? "—"] as [string, React.ReactNode]]),
          ["Agreement signed", [m.agreement_signed_applicant1 && "Applicant 1", m.agreement_signed_applicant2 && "Applicant 2", m.agreement_signed_company && "Company"].filter(Boolean).join(", ") || "—"],
        ]} />
        {m.joining_offers.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-fg-subtle">Joining offers</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">{m.joining_offers.map((o) => (
              <li key={o.id} className="rounded-md bg-surface-sunken px-2 py-0.5 text-sm text-fg">{o.description}{o.nights ? ` (${formatNights(o.nights)} nights)` : ""}</li>
            ))}</ul>
          </div>
        )}
        {Object.keys(m.custom_fields).length > 0 && <div className="mt-4"><KeyValue items={Object.entries(m.custom_fields).map(([k, v]) => [k, String(v)])} /></div>}
        {editing ? (
          <div className="mt-5 rounded-md border border-primary/30 bg-primary-subtle/40 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Relationship manager" htmlFor="erm">
                <Select id="erm" value={rm} onChange={(e) => setRm(e.target.value)}><option value="">—</option>{staff.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</Select>
              </Field>
              <Field label="Home property" htmlFor="ehp" hint="Does not change the membership number.">
                <Select id="ehp" value={homeProperty} onChange={(e) => setHomeProperty(e.target.value)}>
                  <option value="">None</option>
                  {properties.data?.filter((x) => x.is_active !== false || x.id === m.home_property_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              </Field>
              <Field label="Reason for change (recorded in history)" htmlFor="ere"><Input id="ere" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <Field label="Comments" htmlFor="eco" className="md:col-span-2"><Textarea id="eco" value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <span className="ml-auto hidden items-center gap-1 text-xs text-fg-subtle sm:flex"><Kbd>Ctrl</Kbd><Kbd>S</Kbd></span>
            </div>
            <div className="mt-2"><ErrorText error={save.error} /></div>
          </div>
        ) : (
          <div className="mt-4 rounded-md bg-surface-sunken px-3 py-2 text-base">
            <span className="text-xs font-medium text-fg-subtle">Comments</span>
            <p className="whitespace-pre-wrap text-fg">{m.comments ?? "—"}</p>
          </div>
        )}
      </Card>

      {s && (
        <Card title="Financial summary" description="Live from Finance." actions={<Link className="text-sm font-medium text-primary hover:underline" href={`/members/${m.id}?tab=finance`}>Open Finance tab</Link>}>
          <KeyValue items={[
            ["Purchase price", <Money key="a" value={s.purchase_price} currency={s.currency} />], ["Admin fees", <Money key="b" value={s.admin_fees} currency={s.currency} />],
            ["Total price", <Money key="c" value={s.total_price} currency={s.currency} strong />], ["Down payment", <Money key="d" value={s.down_payment} currency={s.currency} />],
            ["Balance", s.balance_display === "NIL" ? "NIL" : <Money key="e" value={s.balance} currency={s.currency} strong />], ["Credit carried forward", <Money key="f" value={s.credit_balance} currency={s.currency} />],
          ]} />
        </Card>
      )}
    </div>
  );
}
