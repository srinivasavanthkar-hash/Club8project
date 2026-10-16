"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DocLink } from "@/components/member/DocLink";
import { ErrorText, useCan, useMaster } from "@/components/providers";
import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import type { Member, Payment } from "@/lib/types";

type Schedule = { id: string; emi_amount: string; emi_count: number; generation_warning: string | null; instalments: { id: string; number: number; due_date: string; amount_due: string; amount_paid: string; status: string; version: number }[] } | null;
type AsfYear = { membership_year: number; status: string; receipt_numbers: string[]; charge: { id: string; base_amount: string; gst_amount: string; gst_rate: string; total_amount: string; currency: string; reason: string; raised_on: string } | null };
type Totals = Record<string, Record<string, { base: string; gst: string; total: string }>>;
type Summary = { totals: { collected: Totals; outstanding: Record<string, Record<string, string>>; overdue: Record<string, Record<string, string>> } };
type Notice = { id: string; issued_on: string; deadline: string; amount_overdue: string; status: string; document_id: string | null };

function PaymentDialog({ member, open, onClose, preset }: { member: Member; open: boolean; onClose: () => void; preset?: { type: string; base?: string; asf_charge_id?: string } }) {
  const qc = useQueryClient();
  const types = useMaster("payment-types");
  const methods = useMaster("payment-methods");
  const [v, setV] = useState({ payment_type_code: preset?.type ?? "MEMBERSHIP_EMI", base_amount: preset?.base ?? "", payment_date: todayIso(), payment_method_id: "", transaction_ref: "", cheque_number: "", bank_name: "", card_last4: "", remarks: "", reservation_id: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const method = methods.data?.find((x) => x.id === v.payment_method_id);
  const save = useMutation({
    mutationFn: () => api.post(`/members/${member.id}/payments`, {
      ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "" ? null : x])),
      currency: member.currency, asf_charge_id: preset?.asf_charge_id ?? null,
    }),
    onSuccess: () => { qc.invalidateQueries({ predicate: (q) => String(q.queryKey[1]) === member.id || q.queryKey[0] === "member" }); onClose(); },
  });
  const isAsf = v.payment_type_code === "ASF";
  return (
    <Dialog open={open} onClose={onClose} title="Record payment">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Payment type" htmlFor="pt">
          <Select id="pt" value={v.payment_type_code} onChange={set("payment_type_code")} disabled={!!preset}>
            {types.data?.map((t) => <option key={t.id} value={String(t.code)}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label={isAsf ? "Base amount (GST added automatically)" : "Amount"} htmlFor="pa"><Input id="pa" inputMode="decimal" value={v.base_amount} onChange={set("base_amount")} readOnly={isAsf} /></Field>
        <Field label="Payment date" htmlFor="pd"><Input id="pd" type="date" value={v.payment_date} onChange={set("payment_date")} /></Field>
        <Field label="Method" htmlFor="pm">
          <Select id="pm" value={v.payment_method_id} onChange={set("payment_method_id")}><option value="">Select…</option>{methods.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
        </Field>
        <Field label="Transaction / approval reference" htmlFor="pr"><Input id="pr" value={v.transaction_ref} onChange={set("transaction_ref")} /></Field>
        {method?.code === "CHEQUE" && (<>
          <Field label="Cheque number" htmlFor="pc"><Input id="pc" value={v.cheque_number} onChange={set("cheque_number")} /></Field>
          <Field label="Bank" htmlFor="pb"><Input id="pb" value={v.bank_name} onChange={set("bank_name")} /></Field>
        </>)}
        {method?.code === "CARD" && (
          <Field label="Card last 4 (optional)" htmlFor="p4" hint="Never enter full card numbers"><Input id="p4" maxLength={4} inputMode="numeric" value={v.card_last4} onChange={set("card_last4")} /></Field>
        )}
        {["BOOKING_FEE", "UPGRADE_CHARGE", "ADDITIONAL_NIGHTS"].includes(v.payment_type_code) && (
          <Field label="Reservation ID" htmlFor="prs"><Input id="prs" value={v.reservation_id} onChange={set("reservation_id")} /></Field>
        )}
        <Field label="Remarks" htmlFor="prm" className="md:col-span-2"><Textarea id="prm" value={v.remarks} onChange={set("remarks")} /></Field>
      </div>
      <ErrorText error={save.error} />
      <div className="mt-3 flex justify-end"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save payment & generate receipt</Button></div>
    </Dialog>
  );
}

function CorrectionDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"REVERSAL" | "ADJUSTMENT">("REVERSAL");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => api.post(`/payments/${payment!.id}/corrections`, { kind, reason, amount: kind === "ADJUSTMENT" ? amount : null }),
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
  });
  return (
    <Dialog open={!!payment} onClose={onClose} title={`Correct payment ${payment?.receipt_number ?? ""}`}>
      <p className="mb-2 text-sm text-muted-foreground">Payments are never edited silently. A correction creates a reversal or adjustment entry with a mandatory reason.</p>
      <div className="grid gap-3">
        <Field label="Correction type" htmlFor="ck"><Select id="ck" value={kind} onChange={(e) => setKind(e.target.value as "REVERSAL")}><option value="REVERSAL">Full reversal</option><option value="ADJUSTMENT">Adjustment (signed amount)</option></Select></Field>
        {kind === "ADJUSTMENT" && <Field label="Adjustment base amount (e.g. -100.00)" htmlFor="ca"><Input id="ca" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        <Field label="Reason (required)" htmlFor="cr"><Input id="cr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <ErrorText error={save.error} />
      <div className="mt-3 flex justify-end"><Button variant="destructive" disabled={reason.trim().length < 5} onClick={() => save.mutate()}>Record correction</Button></div>
    </Dialog>
  );
}

export function FinanceTab({ member: m }: { member: Member }) {
  const qc = useQueryClient();
  const can = useCan();
  const payments = useQuery({ queryKey: ["payments", m.id], queryFn: () => api.get<Payment[]>(`/members/${m.id}/payments`) });
  const schedule = useQuery({ queryKey: ["schedule", m.id], queryFn: () => api.get<Schedule>(`/members/${m.id}/schedule`) });
  const asf = useQuery({ queryKey: ["asf", m.id], queryFn: () => api.get<AsfYear[]>(`/members/${m.id}/asf`) });
  const summary = useQuery({ queryKey: ["fin-summary", m.id], queryFn: () => api.get<Summary>(`/members/${m.id}/finance-summary`) });
  const notices = useQuery({ queryKey: ["notices", m.id], queryFn: () => api.get<Notice[]>(`/members/${m.id}/default-notices`) });
  const [payOpen, setPayOpen] = useState<null | { type: string; base?: string; asf_charge_id?: string }>(null);
  const [correct, setCorrect] = useState<Payment | null>(null);
  const [terminateReason, setTerminateReason] = useState("");
  const refresh = () => qc.invalidateQueries();
  const gen = useMutation({ mutationFn: () => api.post(`/members/${m.id}/schedule`, {}), onSuccess: refresh });
  const notice = useMutation({ mutationFn: () => api.post(`/members/${m.id}/default-notices`), onSuccess: refresh });
  const terminate = useMutation({ mutationFn: () => api.post(`/members/${m.id}/terminate`, { reason: terminateReason }), onSuccess: refresh });
  const t = summary.data?.totals;
  return (
    <div className="flex flex-col gap-4 pt-4">
      {can("payment.create") && m.status !== "TERMINATED" && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPayOpen({ type: "MEMBERSHIP_EMI" })}>Record payment</Button>
          {!schedule.data && m.balance_mode === "EMI" && can("schedule.manage") && <Button variant="outline" onClick={() => gen.mutate()}>Generate EMI schedule</Button>}
          {m.status === "ACTIVE" && can("finance.default_notice") && <Button variant="destructive" onClick={() => notice.mutate()}>Issue default notice</Button>}
        </div>
      )}
      <ErrorText error={gen.error ?? notice.error} />
      {m.status === "TERMINATED" && <Alert kind="error">Membership terminated. Payments are forfeited (no refund); the outstanding balance remains a liability.</Alert>}
      {t && (
        <Card title="Totals (per currency; GST shown separately)">
          {Object.entries(t.collected).map(([cur, byType]) => (
            <div key={cur} className="overflow-x-auto">
              <table className="w-full text-sm"><caption className="text-left font-medium">Collected ({cur})</caption>
                <thead><tr className="text-left"><th>Type</th><th>Base</th><th>GST</th><th>Total</th></tr></thead>
                <tbody>{Object.entries(byType).map(([ty, x]) => (
                  <tr key={ty}><td>{ty}</td><td>{formatMoney(x.base, cur)}</td><td>{formatMoney(x.gst, cur)}</td><td>{formatMoney(x.total, cur)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ))}
          <p className="mt-2 text-sm">Outstanding EMI: {Object.entries(t.outstanding.MEMBERSHIP_EMI ?? {}).map(([c, v]) => formatMoney(v, c)).join(", ") || "—"} · Overdue EMI: {Object.entries(t.overdue.MEMBERSHIP_EMI ?? {}).map(([c, v]) => formatMoney(v, c)).join(", ") || "—"} · ASF unpaid: {Object.entries(t.outstanding.ASF ?? {}).map(([c, v]) => formatMoney(v, c)).join(", ") || "—"}</p>
        </Card>
      )}
      {notices.data && notices.data.length > 0 && (
        <Card title="Default notices">
          {notices.data.map((n) => (
            <div key={n.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>{n.status}</Badge> Issued {formatDate(n.issued_on)} · deadline {formatDate(n.deadline)} · {formatMoney(n.amount_overdue)}
              {n.document_id && <DocLink id={n.document_id} label="Notice PDF" />}
            </div>
          ))}
          {m.status === "DEFAULT_NOTICE" && can("member.terminate") && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Termination reason" htmlFor="tr"><Input id="tr" value={terminateReason} onChange={(e) => setTerminateReason(e.target.value)} /></Field>
              <Button variant="destructive" disabled={terminateReason.length < 5} onClick={() => terminate.mutate()}>Terminate membership</Button>
            </div>
          )}
          <ErrorText error={terminate.error} />
        </Card>
      )}
      <Card title="ASF by membership year">
        <p className="mb-2 text-xs text-muted-foreground">One flat fee per membership year, raised at the first booking that uses that year&apos;s nights, plus GST.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left"><th>Year</th><th>Status</th><th>Base</th><th>GST</th><th>Total</th><th>Receipts</th><th /></tr></thead>
          <tbody>{asf.data?.map((y) => (
            <tr key={y.membership_year} className="border-t border-border">
              <td>{y.membership_year}</td><td><Badge>{y.status}</Badge></td>
              <td>{y.charge ? formatMoney(y.charge.base_amount, y.charge.currency) : "—"}</td>
              <td>{y.charge ? `${formatMoney(y.charge.gst_amount, y.charge.currency)} @ ${Number(y.charge.gst_rate)}%` : "—"}</td>
              <td>{y.charge ? formatMoney(y.charge.total_amount, y.charge.currency) : "—"}</td>
              <td>{y.receipt_numbers.join(", ")}</td>
              <td>{y.status === "RAISED" && can("payment.create") && y.charge && (
                <Button size="sm" variant="outline" onClick={() => setPayOpen({ type: "ASF", base: y.charge!.base_amount, asf_charge_id: y.charge!.id })}>Pay ASF {y.membership_year}</Button>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <Card title="EMI schedule">
        {!schedule.data ? <p className="text-sm text-muted-foreground">No schedule.</p> : (
          <>
            {schedule.data.generation_warning && <Alert kind="warning">{schedule.data.generation_warning}</Alert>}
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left"><th>#</th><th>Due</th><th>Amount due</th><th>Paid</th><th>Status</th></tr></thead>
              <tbody>{schedule.data.instalments.map((i) => (
                <tr key={i.id} className="border-t border-border"><td>{i.number}</td><td>{formatDate(i.due_date)}</td><td>{formatMoney(i.amount_due)}</td><td>{formatMoney(i.amount_paid)}</td><td><Badge>{i.status}</Badge></td></tr>
              ))}</tbody>
            </table></div>
          </>
        )}
      </Card>
      <Card title="Payment ledger">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left"><th>Date</th><th>Receipt</th><th>Type</th><th>Kind</th><th>Base</th><th>GST</th><th>Total</th><th>Ref</th><th /></tr></thead>
          <tbody>{payments.data?.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td>{formatDate(p.payment_date)}</td><td>{p.receipt_number}</td><td>{p.payment_type_code}{p.asf_year ? ` ${p.asf_year}` : ""}</td>
              <td>{p.entry_kind}{p.is_forfeited ? " (forfeited)" : ""}</td><td>{formatMoney(p.base_amount, p.currency)}</td>
              <td>{Number(p.gst_amount) ? formatMoney(p.gst_amount, p.currency) : "—"}</td><td>{formatMoney(p.total_amount, p.currency)}</td>
              <td>{p.transaction_ref}{p.card_last4 ? ` ••••${p.card_last4}` : ""}</td>
              <td className="flex gap-2">
                {p.receipt_document_id && <DocLink id={p.receipt_document_id} label="Receipt" />}
                {can("payment.correct") && p.entry_kind === "NORMAL" && <button className="text-xs underline" onClick={() => setCorrect(p)}>Correct</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      {payOpen && <PaymentDialog member={m} open onClose={() => setPayOpen(null)} preset={payOpen.type === "ASF" ? payOpen : undefined} />}
      <CorrectionDialog payment={correct} onClose={() => setCorrect(null)} />
    </div>
  );
}
