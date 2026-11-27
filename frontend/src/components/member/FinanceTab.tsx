"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, FileWarning, Gavel, Plus, Undo2 } from "lucide-react";
import { useState } from "react";
import { Money, Mono, Progress } from "@/components/crm/Display";
import { ConfirmDialog, TableSkeleton } from "@/components/crm/States";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { Table, Td, Th, THead, Tr } from "@/components/crm/Table";
import { useToast } from "@/components/crm/Toast";
import { DocLink } from "@/components/member/DocLink";
import { ErrorText, useCan, useMaster } from "@/components/providers";
import { Alert, Button, Card, Dialog, Empty, Field, Input, PrefixInput, Select, Textarea } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { addMoney, daysFromToday, formatDate, formatMoney, formatRelativeDays, humanize, subMoney, todayIso } from "@/lib/format";
import { SearchSelect } from "@/components/crm/SearchSelect";
import type { Member, Payment, Reservation } from "@/lib/types";
import { DateField } from "@/components/DateField";

type Schedule = { id: string; emi_amount: string; emi_count: number; generation_warning: string | null; instalments: { id: string; number: number; due_date: string; amount_due: string; amount_paid: string; status: string; version: number }[] } | null;
type AsfYear = { membership_year: number; status: string; receipt_numbers: string[]; charge: { id: string; base_amount: string; gst_amount: string; gst_rate: string; total_amount: string; currency: string; reason: string; raised_on: string } | null };
type Totals = Record<string, Record<string, { base: string; gst: string; total: string }>>;
type Summary = { totals: { collected: Totals; outstanding: Record<string, Record<string, string>>; overdue: Record<string, Record<string, string>> } };
type Notice = { id: string; issued_on: string; deadline: string; amount_overdue: string; status: string; document_id: string | null };

/** Payment type: readable label with the code underneath (codes match exports and receipts). */
function TypeCell({ code, extra }: { code: string; extra?: string | number | null }) {
  return (
    <span className="flex flex-col whitespace-nowrap leading-tight">
      <span>{humanize(code)}{extra ? ` ${extra}` : ""}</span>
      <Mono className="text-xs text-fg-subtle">{code}</Mono>
    </span>
  );
}

function PaymentDialog({ member, open, onClose, preset }: { member: Member; open: boolean; onClose: () => void; preset?: { type: string; base?: string; asf_charge_id?: string } }) {
  const qc = useQueryClient();
  const toast = useToast();
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
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[1]) === member.id || q.queryKey[0] === "member" });
      toast.success("Payment recorded", "The receipt PDF has been generated.");
      onClose();
    },
  });
  const isAsf = v.payment_type_code === "ASF";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record payment"
      description={<>For <Mono>{member.membership_number}</Mono> · amounts in {member.currency}</>}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save payment & generate receipt"}</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Payment type" htmlFor="pt">
          <Select id="pt" value={v.payment_type_code} onChange={set("payment_type_code")} disabled={!!preset}>
            {types.data?.map((t) => <option key={t.id} value={String(t.code)}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label={isAsf ? "Base amount (GST added automatically)" : "Amount"} htmlFor="pa" tag={isAsf ? <span className="rounded-sm bg-primary-subtle px-1.5 text-xs font-medium uppercase text-primary">auto</span> : undefined}>
          <PrefixInput prefix={member.currency === "INR" ? "₹" : member.currency} id="pa" inputMode="decimal" className="text-right" value={v.base_amount} onChange={set("base_amount")} readOnly={isAsf} />
        </Field>
        <Field label="Payment date" htmlFor="pd"><DateField id="pd" value={v.payment_date} onChange={(d) => setV({ ...v, payment_date: d })} /></Field>
        <Field label="Method" htmlFor="pm">
          <Select id="pm" value={v.payment_method_id} onChange={set("payment_method_id")}><option value="">Select…</option>{methods.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
        </Field>
        <Field label="Transaction / approval reference" htmlFor="pr" className="md:col-span-2"><Input id="pr" className="font-mono" value={v.transaction_ref} onChange={set("transaction_ref")} /></Field>
        {method?.code === "CHEQUE" && (<>
          <Field label="Cheque number" htmlFor="pc"><Input id="pc" value={v.cheque_number} onChange={set("cheque_number")} /></Field>
          <Field label="Bank" htmlFor="pb"><Input id="pb" value={v.bank_name} onChange={set("bank_name")} /></Field>
        </>)}
        {method?.code === "CARD" && (
          <Field label="Card last 4 (optional)" htmlFor="p4" hint="Never enter full card numbers"><Input id="p4" maxLength={4} inputMode="numeric" className="w-28 font-mono" value={v.card_last4} onChange={set("card_last4")} /></Field>
        )}
        {["BOOKING_FEE", "UPGRADE_CHARGE", "ADDITIONAL_NIGHTS"].includes(v.payment_type_code) && (
          <Field label="Reservation" htmlFor="prs" className="md:col-span-2" hint="Type a reservation number, resort or status to search">
            <ReservationPicker memberId={member.id} value={v.reservation_id} onChange={(id) => setV({ ...v, reservation_id: id })} />
          </Field>
        )}
        <Field label="Remarks" htmlFor="prm" className="md:col-span-2"><Textarea id="prm" rows={2} value={v.remarks} onChange={set("remarks")} /></Field>
      </div>
      <div className="mt-4"><ErrorText error={save.error} /></div>
    </Dialog>
  );
}

/** The member's reservations by number, resort, dates and status (newest stay first); "none" is allowed. */
function ReservationPicker({ memberId, value, onChange }: { memberId: string; value: string; onChange: (id: string) => void }) {
  const list = useQuery({ queryKey: ["reservations", memberId], queryFn: () => api.get<Page<Reservation>>("/reservations", { member_id: memberId, page_size: 100 }) });
  const properties = useMaster("properties");
  const name = (pid: string) => String(properties.data?.find((p) => p.id === pid)?.name ?? "Resort");
  const options = [...(list.data?.items ?? [])]
    .sort((a, b) => b.check_in.localeCompare(a.check_in))
    .map((r) => ({
      value: r.id,
      label: `${r.reservation_number} · ${name(r.property_id)}`,
      description: `${formatDate(r.check_in)} to ${formatDate(r.check_out)} · ${r.nights} night${r.nights === 1 ? "" : "s"} · ${humanize(r.status)}`,
    }));
  return (
    <SearchSelect
      id="prs"
      options={options}
      value={value}
      onChange={onChange}
      noneLabel="None (not linked to a reservation)"
      placeholder={list.isLoading ? "Loading reservations…" : "Search reservations…"}
      emptyText={list.data && !list.data.items.length ? "This member has no reservations" : "No reservation matches"}
    />
  );
}

function CorrectionDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<"REVERSAL" | "ADJUSTMENT">("REVERSAL");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => api.post(`/payments/${payment!.id}/corrections`, { kind, reason, amount: kind === "ADJUSTMENT" ? amount : null }),
    onSuccess: () => { qc.invalidateQueries(); toast.success("Correction recorded"); onClose(); },
  });
  return (
    <Dialog
      open={!!payment}
      onClose={onClose}
      size="sm"
      title={`Correct payment ${payment?.receipt_number ?? ""}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Keep as is</Button>
          <Button variant="destructive" disabled={reason.trim().length < 5 || save.isPending} onClick={() => save.mutate()}>Record correction</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert kind="warning">Payments are never edited silently. A correction creates a reversal or adjustment entry with a mandatory reason.</Alert>
        {payment && (
          <p className="text-base text-fg-muted">Original: <Mono>{payment.receipt_number}</Mono> · {humanize(payment.payment_type_code)} · <Money value={payment.total_amount} currency={payment.currency} strong /></p>
        )}
        <Field label="Correction type" htmlFor="ck"><Select id="ck" value={kind} onChange={(e) => setKind(e.target.value as "REVERSAL")}><option value="REVERSAL">Full reversal</option><option value="ADJUSTMENT">Adjustment (signed amount)</option></Select></Field>
        {kind === "ADJUSTMENT" && <Field label="Adjustment base amount (e.g. -100.00)" htmlFor="ca"><Input id="ca" inputMode="decimal" className="text-right tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        <Field label="Reason (required)" htmlFor="cr" required hint="At least 5 characters. Recorded in the activity log."><Textarea id="cr" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorText error={save.error} />
      </div>
    </Dialog>
  );
}

/** Per-currency summary. Different currencies are never added together. */
function MoneySummary({ totals }: { totals: Summary["totals"] }) {
  const currencies = [...new Set([...Object.keys(totals.collected), ...Object.values(totals.outstanding).flatMap(Object.keys), ...Object.values(totals.overdue).flatMap(Object.keys)])];
  const pick = (m: Record<string, Record<string, string>>, type: string, cur: string) => m[type]?.[cur];
  if (!currencies.length) return <Empty>No payments recorded yet.</Empty>;
  return (
    <div className="flex flex-col gap-5">
      {currencies.map((cur) => {
        const outEmi = pick(totals.outstanding, "MEMBERSHIP_EMI", cur);
        const overEmi = pick(totals.overdue, "MEMBERSHIP_EMI", cur);
        const outAsf = pick(totals.outstanding, "ASF", cur);
        const byType = totals.collected[cur] ?? {};
        return (
          <div key={cur} className="flex flex-col gap-3">
            {currencies.length > 1 && <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{cur}</p>}
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-primary/25 bg-primary-subtle/50 px-4 py-3">
                <dt className="text-xs font-medium text-fg-muted">Outstanding EMI</dt>
                <dd className="mt-0.5 text-xl font-semibold"><Money value={outEmi ?? "0.00"} currency={cur} /></dd>
              </div>
              <div className={`rounded-md border px-4 py-3 ${overEmi && Number(overEmi) > 0 ? "border-danger/30 bg-danger-subtle" : "border-border"}`}>
                <dt className="text-xs font-medium text-fg-muted">Overdue EMI</dt>
                <dd className={`mt-0.5 text-xl font-semibold ${overEmi && Number(overEmi) > 0 ? "text-danger" : ""}`}>{overEmi ? <Money value={overEmi} currency={cur} /> : "—"}</dd>
              </div>
              <div className={`rounded-md border px-4 py-3 ${outAsf && Number(outAsf) > 0 ? "border-warning/30 bg-warning-subtle" : "border-border"}`}>
                <dt className="text-xs font-medium text-fg-muted">ASF unpaid</dt>
                <dd className="mt-0.5 text-xl font-semibold">{outAsf ? <Money value={outAsf} currency={cur} /> : "—"}</dd>
              </div>
            </dl>
            {Object.keys(byType).length > 0 && (
              <Table caption={`Collected (${cur})`}>
                <THead><tr><Th>Collected ({cur})</Th><Th align="right">Base</Th><Th align="right">GST</Th><Th align="right">Total</Th></tr></THead>
                <tbody>{Object.entries(byType).map(([ty, x]) => (
                  <Tr key={ty}><Td><TypeCell code={ty} /></Td><Td align="right"><Money value={x.base} currency={cur} /></Td><Td align="right" className="text-fg-muted"><Money value={x.gst} currency={cur} /></Td><Td align="right"><Money value={x.total} currency={cur} strong /></Td></Tr>
                ))}</tbody>
              </Table>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FinanceTab({ member: m }: { member: Member }) {
  const qc = useQueryClient();
  const can = useCan();
  const toast = useToast();
  const payments = useQuery({ queryKey: ["payments", m.id], queryFn: () => api.get<Payment[]>(`/members/${m.id}/payments`) });
  const schedule = useQuery({ queryKey: ["schedule", m.id], queryFn: () => api.get<Schedule>(`/members/${m.id}/schedule`) });
  const asf = useQuery({ queryKey: ["asf", m.id], queryFn: () => api.get<AsfYear[]>(`/members/${m.id}/asf`) });
  const summary = useQuery({ queryKey: ["fin-summary", m.id], queryFn: () => api.get<Summary>(`/members/${m.id}/finance-summary`) });
  const notices = useQuery({ queryKey: ["notices", m.id], queryFn: () => api.get<Notice[]>(`/members/${m.id}/default-notices`) });
  const [payOpen, setPayOpen] = useState<null | { type: string; base?: string; asf_charge_id?: string }>(null);
  const [correct, setCorrect] = useState<Payment | null>(null);
  const [confirmNotice, setConfirmNotice] = useState(false);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const refresh = () => qc.invalidateQueries();
  const gen = useMutation({ mutationFn: () => api.post(`/members/${m.id}/schedule`, {}), onSuccess: () => { refresh(); toast.success("EMI schedule generated"); } });
  const notice = useMutation({ mutationFn: () => api.post(`/members/${m.id}/default-notices`), onSuccess: () => { setConfirmNotice(false); refresh(); toast.success("Default notice issued"); } });
  const terminate = useMutation({ mutationFn: (reason: string) => api.post(`/members/${m.id}/terminate`, { reason }), onSuccess: () => { setConfirmTerminate(false); refresh(); toast.success("Membership terminated"); } });
  const t = summary.data?.totals;
  const inst = schedule.data?.instalments ?? [];
  const due = addMoney(...inst.map((i) => i.amount_due));
  const paid = addMoney(...inst.map((i) => i.amount_paid));
  const asfVisible = asf.data?.filter((y, i, all) => y.status !== "NOT_YET_DUE" || i === all.findIndex((z) => z.status === "NOT_YET_DUE")) ?? [];
  const [showAllAsf, setShowAllAsf] = useState(false);

  return (
    <div className="flex flex-col gap-4 pt-1">
      {can("payment.create") && m.status !== "TERMINATED" && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPayOpen({ type: "MEMBERSHIP_EMI" })}><Plus aria-hidden />Record payment</Button>
          {!schedule.data && !schedule.isLoading && m.balance_mode === "EMI" && can("schedule.manage") && <Button variant="outline" onClick={() => gen.mutate()} disabled={gen.isPending}><CalendarPlus aria-hidden />Generate EMI schedule</Button>}
          {m.status === "ACTIVE" && can("finance.default_notice") && <Button variant="destructive-outline" className="sm:ml-auto" onClick={() => setConfirmNotice(true)}><FileWarning aria-hidden />Issue default notice</Button>}
        </div>
      )}
      <ErrorText error={gen.error} />

      <Card title="Money summary" description="Per currency. GST is shown separately and different currencies are never added together.">
        {t ? <MoneySummary totals={t} /> : <TableSkeleton rows={3} cols={4} />}
      </Card>

      {notices.data && notices.data.length > 0 && (
        <Card title="Default notices" actions={m.status === "DEFAULT_NOTICE" && can("member.terminate") ? (
          <Button variant="destructive" size="sm" onClick={() => setConfirmTerminate(true)}><Gavel aria-hidden />Terminate membership…</Button>
        ) : undefined}>
          <ul className="flex flex-col gap-2">
            {notices.data.map((n) => {
              const left = daysFromToday(n.deadline);
              return (
                <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-base">
                  <StatusBadge status={n.status} />
                  <span>Issued {formatDate(n.issued_on)}</span>
                  <span>Deadline <strong className="font-medium">{formatDate(n.deadline)}</strong>
                    {n.status === "OPEN" && left !== null && <span className={left < 0 ? "text-danger" : "text-fg-muted"}> ({left >= 0 ? `${left} days left` : `${-left} days past`})</span>}
                  </span>
                  <Money value={n.amount_overdue} strong />
                  {n.document_id && <span className="ml-auto"><DocLink id={n.document_id} label="Notice PDF" /></span>}
                </li>
              );
            })}
          </ul>
          <div className="mt-2"><ErrorText error={notice.error} /></div>
        </Card>
      )}

      <div className="grid gap-4 2xl:grid-cols-2">
        <Card title="EMI schedule" description={schedule.data ? `${schedule.data.emi_count} instalments of ${formatMoney(schedule.data.emi_amount)}` : undefined}>
          {schedule.isLoading ? <TableSkeleton rows={4} cols={5} /> : !schedule.data ? (
            <Empty>{m.balance_mode === "EMI" ? "No EMI schedule yet." : "This membership is not paid by EMI."}</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {schedule.data.generation_warning && <Alert kind="warning">{schedule.data.generation_warning}</Alert>}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-sm"><span className="text-fg-muted">Paid <Money value={paid} strong className="text-fg" /> of <Money value={due} /></span><span className="tabular-nums text-fg-muted">{inst.filter((i) => i.status === "PAID").length}/{inst.length} paid</span></div>
                <Progress value={Number(paid)} max={Number(due)} label="EMI amount paid" />
              </div>
              <Table caption="EMI schedule">
                <THead><tr><Th align="right">#</Th><Th>Due</Th><Th align="right">Amount due</Th><Th align="right">Paid</Th><Th align="right">Balance</Th><Th>Status</Th></tr></THead>
                <tbody>{inst.map((i) => {
                  const overdue = i.status === "OVERDUE";
                  return (
                    <Tr key={i.id} tone={overdue ? "danger" : i.status === "PAID" ? "muted" : undefined}>
                      <Td align="right">{i.number}</Td>
                      <Td className="whitespace-nowrap"><span className="tabular-nums">{formatDate(i.due_date)}</span>{overdue && <span className="block text-xs font-medium text-danger">{formatRelativeDays(i.due_date, "overdue")}</span>}</Td>
                      <Td align="right"><Money value={i.amount_due} /></Td>
                      <Td align="right"><Money value={i.amount_paid} /></Td>
                      <Td align="right"><Money value={subMoney(i.amount_due, i.amount_paid)} /></Td>
                      <Td><StatusBadge status={i.status} /></Td>
                    </Tr>
                  );
                })}</tbody>
              </Table>
            </div>
          )}
        </Card>

        <Card title="ASF by membership year" description="One flat fee per membership year, raised at the first booking that uses that year’s nights, plus GST.">
          {!asf.data ? <TableSkeleton rows={4} cols={4} /> : (
            <>
              <Table caption="ASF by membership year">
                <THead><tr><Th>Year</Th><Th>Status</Th><Th align="right">Base</Th><Th align="right">GST</Th><Th align="right">Total</Th><Th>Receipts</Th><Th><span className="sr-only">Action</span></Th></tr></THead>
                <tbody>{(showAllAsf ? asf.data : asfVisible).map((y) => (
                  <Tr key={y.membership_year} tone={y.status === "RAISED" ? "warning" : undefined}>
                    <Td className="font-medium tabular-nums">{y.membership_year}</Td><Td><StatusBadge status={y.status} /></Td>
                    <Td align="right">{y.charge ? <Money value={y.charge.base_amount} currency={y.charge.currency} /> : "—"}</Td>
                    <Td align="right">{y.charge ? <span className="whitespace-nowrap text-fg-muted"><Money value={y.charge.gst_amount} currency={y.charge.currency} /> <span className="text-xs">@ {Number(y.charge.gst_rate)}%</span></span> : "—"}</Td>
                    <Td align="right">{y.charge ? <Money value={y.charge.total_amount} currency={y.charge.currency} strong /> : "—"}</Td>
                    <Td><Mono className="whitespace-nowrap text-sm">{y.receipt_numbers.join(", ")}</Mono></Td>
                    <Td align="right">{y.status === "RAISED" && can("payment.create") && y.charge && (
                      <Button size="sm" onClick={() => setPayOpen({ type: "ASF", base: y.charge!.base_amount, asf_charge_id: y.charge!.id })}>Pay ASF {y.membership_year}</Button>
                    )}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
              {asf.data.length > asfVisible.length && (
                <Button variant="link" size="sm" className="mt-2" onClick={() => setShowAllAsf(!showAllAsf)}>
                  {showAllAsf ? "Show fewer years" : `Show all ${asf.data.length} years`}
                </Button>
              )}
            </>
          )}
        </Card>
      </div>

      <Card title="Payment ledger" description="Every receipt, with reversals and adjustments as separate entries.">
        {!payments.data ? <TableSkeleton rows={4} cols={7} /> : payments.data.length === 0 ? <Empty>No payments recorded yet.</Empty> : (
          <Table caption="Payment ledger">
            <THead><tr><Th>Date</Th><Th>Receipt</Th><Th>Type</Th><Th>Kind</Th><Th align="right">Base</Th><Th align="right">GST</Th><Th align="right">Total</Th><Th>Ref</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
            <tbody>{payments.data.map((p) => (
              <Tr key={p.id} tone={p.entry_kind === "REVERSAL" ? "danger" : undefined}>
                <Td className="whitespace-nowrap tabular-nums">{formatDate(p.payment_date)}</Td>
                <Td><Mono className="whitespace-nowrap">{p.receipt_number}</Mono></Td>
                <Td><TypeCell code={p.payment_type_code} extra={p.asf_year} /></Td>
                <Td>{p.entry_kind === "NORMAL" ? <span className="text-fg-muted">{humanize(p.entry_kind)}</span> : <StatusBadge status={p.entry_kind} />}{p.is_forfeited ? <span className="ml-1 text-xs text-danger">(forfeited)</span> : ""}</Td>
                <Td align="right"><Money value={p.base_amount} currency={p.currency} /></Td>
                <Td align="right" className="text-fg-muted">{Number(p.gst_amount) ? <Money value={p.gst_amount} currency={p.currency} /> : "—"}</Td>
                <Td align="right"><Money value={p.total_amount} currency={p.currency} strong /></Td>
                <Td><Mono className="text-sm text-fg-muted">{p.transaction_ref}{p.card_last4 ? ` ••••${p.card_last4}` : ""}</Mono></Td>
                <Td>
                  <span className="flex items-center justify-end gap-1">
                    {p.receipt_document_id && <DocLink id={p.receipt_document_id} label="Receipt" />}
                    {can("payment.correct") && p.entry_kind === "NORMAL" && (
                      <Button variant="ghost" size="sm" onClick={() => setCorrect(p)} aria-label={`Correct payment ${p.receipt_number}`}><Undo2 aria-hidden />Correct</Button>
                    )}
                  </span>
                </Td>
              </Tr>
            ))}</tbody>
          </Table>
        )}
      </Card>

      {payOpen && <PaymentDialog member={m} open onClose={() => setPayOpen(null)} preset={payOpen.type === "ASF" ? payOpen : undefined} />}
      <CorrectionDialog payment={correct} onClose={() => setCorrect(null)} />
      <ConfirmDialog
        open={confirmNotice}
        onClose={() => setConfirmNotice(false)}
        title="Issue default notice?"
        description={<>This sets <Mono>{m.membership_number}</Mono> to Default Notice, generates the notice PDF and starts the deadline. The member must pay the overdue amount before the deadline.</>}
        reasonLabel={null}
        confirmLabel="Issue default notice"
        pending={notice.isPending}
        onConfirm={() => notice.mutate()}
      >
        <ErrorText error={notice.error} />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmTerminate}
        onClose={() => setConfirmTerminate(false)}
        title="Terminate membership?"
        description={<>Payments made are forfeited (no refund) and the outstanding balance remains a liability. <strong className="text-fg">This cannot be undone here.</strong></>}
        reasonLabel="Termination reason"
        typeToConfirm={m.membership_number}
        confirmLabel="Terminate membership"
        pending={terminate.isPending}
        onConfirm={(reason) => terminate.mutate(reason)}
      >
        <ErrorText error={terminate.error} />
      </ConfirmDialog>
    </div>
  );
}
