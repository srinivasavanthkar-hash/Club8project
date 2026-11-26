"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileImage, FileText, Loader2, Mail, Phone, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmDialog, TableSkeleton } from "@/components/crm/States";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { TIMELINE_TYPES, Timeline, TypeChips } from "@/components/crm/Timeline";
import { useToast } from "@/components/crm/Toast";
import { DocLink } from "@/components/member/DocLink";
import { ErrorText, useCan, useMaster } from "@/components/providers";
import { Button, Card, Empty, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatPhone, humanize } from "@/lib/format";
import type { Member } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DateField, DateTimeField } from "@/components/DateField";
import { istToInstant, nowIst } from "@/lib/dates";

type Email = { id: string; direction: string; sent_at: string; sender: string; to: string[]; subject: string; body_text: string };
type Thread = { id: string; subject: string; emails: Email[] };
type Call = { id: string; direction: string; called_at: string; contact_number: string; summary: string; next_action: string | null; next_action_date: string | null };
type Doc = { id: string; file_name: string; content_type: string; created_at: string; document_type_id: string; scan_status: string; description: string | null };
type Item = { type: string; at: string; title: string; id: string };

const TIMELINE_FILTERS = ["email", "call", "document", "payment", "reservation", "entitlement", "status"].filter((t) => TIMELINE_TYPES.includes(t));

function ScanState({ status }: { status: string }) {
  if (status === "PENDING") {
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-full bg-info-subtle px-2 text-xs font-semibold uppercase tracking-wide text-info ring-1 ring-inset ring-info/25">
        <Loader2 aria-hidden className="size-3 animate-spin" />Scanning…
      </span>
    );
  }
  return <StatusBadge status={status} />;
}

export function CorrespondenceTab({ member }: { member: Member }) {
  const qc = useQueryClient();
  const can = useCan();
  const toast = useToast();
  const docTypes = useMaster("document-types");
  const outcomes = useMaster("reasons");
  const threads = useQuery({ queryKey: ["threads", member.id], queryFn: () => api.get<Thread[]>(`/members/${member.id}/email-threads`) });
  const calls = useQuery({ queryKey: ["calls", member.id], queryFn: () => api.get<Call[]>(`/members/${member.id}/calls`) });
  const docs = useQuery({ queryKey: ["docs", member.id], queryFn: () => api.get<Doc[]>(`/members/${member.id}/documents`) });
  const [types, setTypes] = useState<string[]>([]);
  const timeline = useQuery({ queryKey: ["timeline", member.id, types], queryFn: () => api.get<Item[]>(`/members/${member.id}/timeline`, { types }) });
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === member.id });

  const [email, setEmail] = useState({ direction: "INCOMING", sent_at: nowIst(), sender: member.email, to: "", subject: "", body: "" });
  const addEmail = useMutation({
    mutationFn: () => api.post(`/members/${member.id}/emails`, { ...email, sent_at: istToInstant(email.sent_at), to: email.to.split(",").map((s) => s.trim()).filter(Boolean) }),
    onSuccess: () => { setEmail({ ...email, subject: "", body: "" }); refresh(); toast.success("Email added"); },
  });
  const emlRef = useRef<HTMLInputElement>(null);
  const importEml = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); fd.append("direction", "INCOMING"); return api.post(`/members/${member.id}/emails/import`, fd); },
    onSuccess: () => { refresh(); toast.success("Email imported"); },
  });
  const [call, setCall] = useState({ direction: "OUTGOING", called_at: nowIst(), contact_number: member.applicants[0]?.mobile ?? "", summary: "", outcome_id: "", next_action: "", next_action_date: "" });
  const addCall = useMutation({
    mutationFn: () => api.post(`/members/${member.id}/calls`, { ...call, called_at: istToInstant(call.called_at), outcome_id: call.outcome_id || null, next_action: call.next_action || null, next_action_date: call.next_action_date || null }),
    onSuccess: () => { setCall({ ...call, summary: "" }); refresh(); toast.success("Call logged"); },
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("");
  const [desc, setDesc] = useState("");
  const [dragging, setDragging] = useState(false);
  const upload = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); fd.append("document_type_id", docType); if (desc) fd.append("description", desc); return api.post(`/members/${member.id}/documents`, fd); },
    onSuccess: () => { setDesc(""); if (fileRef.current) fileRef.current.value = ""; refresh(); toast.success("Document uploaded"); },
  });
  const [deleting, setDeleting] = useState<Doc | null>(null);
  const del = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/documents/${id}/delete`, { reason }),
    onSuccess: () => { setDeleting(null); refresh(); toast.success("Document deleted"); },
  });
  const typeName = (id: string) => docTypes.data?.find((d) => d.id === id)?.name ?? "";

  return (
    <div className="grid gap-4 pt-1 xl:grid-cols-5">
      <div className="flex flex-col gap-4 xl:col-span-3">
        <Card title="Documents" description="PDF, JPEG or PNG. Files are virus-scanned before they can be opened.">
          {can("document.upload") && (
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              <Field label="Document type" htmlFor="dt" required><Select id="dt" value={docType} onChange={(e) => setDocType(e.target.value)}><option value="">Select…</option>{docTypes.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
              <Field label="Description" htmlFor="ddesc"><Input id="ddesc" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
              <div
                className={cn(
                  "relative flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors md:col-span-2",
                  !docType ? "border-border bg-surface-sunken/50 text-fg-subtle" : dragging ? "border-primary bg-primary-subtle" : "border-border-strong/50 bg-surface hover:border-primary/50",
                )}
                onDragOver={(e) => { if (docType) { e.preventDefault(); setDragging(true); } }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f && docType) upload.mutate(f); }}
              >
                {upload.isPending ? <Loader2 aria-hidden className="size-6 animate-spin text-primary" /> : <Upload aria-hidden className="size-6 text-fg-subtle" />}
                <p className="text-base text-fg">
                  {upload.isPending ? "Uploading…" : docType ? <>Drag a file here or <button type="button" onClick={() => fileRef.current?.click()} className="font-medium text-primary underline">choose a file</button></> : "Choose a document type first"}
                </p>
                <p className="text-xs text-fg-subtle">PDF, JPEG or PNG · size limit set by your administrator (15 MB by default)</p>
                <label htmlFor="dfile" className="sr-only">File (PDF, JPEG, PNG)</label>
                <input id="dfile" ref={fileRef} type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png" disabled={!docType}
                  onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
              </div>
              <div className="md:col-span-2"><ErrorText error={upload.error} /></div>
            </div>
          )}
          {!docs.data ? <TableSkeleton rows={2} cols={3} /> : docs.data.length === 0 ? <Empty>No documents yet.</Empty> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {docs.data.map((d) => {
                const Icon = d.content_type.startsWith("image/") ? FileImage : FileText;
                return (
                  <li key={d.id} className="flex gap-3 rounded-lg border border-border bg-surface p-3">
                    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted"><Icon className="size-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-fg" title={d.file_name}>{d.file_name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {typeName(d.document_type_id) && <span className="rounded-full bg-primary-subtle px-2 text-xs font-medium text-primary">{typeName(d.document_type_id)}</span>}
                        {d.scan_status !== "CLEAN" && <ScanState status={d.scan_status} />}
                      </div>
                      <p className="mt-1 text-xs text-fg-subtle">{formatDateTime(d.created_at)}{d.description ? ` · ${d.description}` : ""}</p>
                      <div className="-ml-3 mt-1 flex flex-wrap items-center gap-1">
                        {d.scan_status === "CLEAN" && <DocLink id={d.id} label="Preview" contentType={d.content_type} />}
                        {can("document.delete") && (
                          <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => setDeleting(d)} aria-label={`Delete ${d.file_name}`}>
                            <Trash2 aria-hidden />Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {can("correspondence.create") && (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Card title="Log an email">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Direction" htmlFor="ed"><Select id="ed" value={email.direction} onChange={(e) => setEmail({ ...email, direction: e.target.value })}><option value="INCOMING">Incoming</option><option value="OUTGOING">Outgoing</option></Select></Field>
            <Field label="Date/time" htmlFor="et"><DateTimeField id="et" timeLabel="Time (email)" value={email.sent_at} onChange={(v) => setEmail({ ...email, sent_at: v })} /></Field>
            <Field label="From" htmlFor="ef"><Input id="ef" type="email" value={email.sender} onChange={(e) => setEmail({ ...email, sender: e.target.value })} /></Field>
            <Field label="To (comma separated)" htmlFor="eto"><Input id="eto" value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })} /></Field>
            <Field label="Subject" htmlFor="es" className="md:col-span-2" required><Input id="es" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} /></Field>
            <Field label="Body" htmlFor="eb" className="md:col-span-2"><Textarea id="eb" value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button onClick={() => addEmail.mutate()} disabled={!email.subject || addEmail.isPending}><Mail aria-hidden />Add email</Button>
              <input ref={emlRef} type="file" accept=".eml,.msg" className="sr-only" aria-label="Import .eml or .msg" onChange={(e) => e.target.files?.[0] && importEml.mutate(e.target.files[0])} />
              <Button variant="outline" onClick={() => emlRef.current?.click()}><Upload aria-hidden />Import .eml / .msg</Button>
            </div>
            <div className="md:col-span-2"><ErrorText error={addEmail.error ?? importEml.error} /></div>
          </div>
            </Card>
            <Card title="Log a call">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Direction" htmlFor="cd"><Select id="cd" value={call.direction} onChange={(e) => setCall({ ...call, direction: e.target.value })}><option value="OUTGOING">Outgoing</option><option value="INCOMING">Incoming</option></Select></Field>
            <Field label="Date/time" htmlFor="ct"><DateTimeField id="ct" timeLabel="Time (call)" value={call.called_at} onChange={(v) => setCall({ ...call, called_at: v })} /></Field>
            <Field label="Contact number" htmlFor="cn"><Input id="cn" type="tel" value={call.contact_number} onChange={(e) => setCall({ ...call, contact_number: e.target.value })} /></Field>
            <Field label="Outcome" htmlFor="co"><Select id="co" value={call.outcome_id} onChange={(e) => setCall({ ...call, outcome_id: e.target.value })}><option value="">—</option>{outcomes.data?.filter((r) => r.kind === "CALL_OUTCOME").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
            <Field label="Summary" htmlFor="cs" className="md:col-span-2" required><Textarea id="cs" value={call.summary} onChange={(e) => setCall({ ...call, summary: e.target.value })} /></Field>
            <Field label="Next action" htmlFor="cna"><Input id="cna" value={call.next_action} onChange={(e) => setCall({ ...call, next_action: e.target.value })} /></Field>
            <Field label="Next action date" htmlFor="cnd"><DateField id="cnd" value={call.next_action_date} onChange={(v) => setCall({ ...call, next_action_date: v })} /></Field>
            <div className="md:col-span-2"><Button onClick={() => addCall.mutate()} disabled={!call.summary || addCall.isPending}><Phone aria-hidden />Add call</Button></div>
            <div className="md:col-span-2"><ErrorText error={addCall.error} /></div>
          </div>
            </Card>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 xl:col-span-2">
        <Card title="Timeline">
          <div className="mb-4"><TypeChips types={TIMELINE_FILTERS} selected={types} onChange={setTypes} /></div>
          {!timeline.data ? <TableSkeleton rows={4} cols={2} /> : (
            <Timeline items={timeline.data.map((i, n) => ({ key: `${i.type}-${i.id}-${n}`, type: i.type, at: i.at, title: i.title }))} empty="Nothing recorded for these types." />
          )}
        </Card>

        <Card title="Email threads">
          {!threads.data ? <TableSkeleton rows={2} cols={2} /> : threads.data.length === 0 ? <Empty>No emails yet.</Empty> : (
            <ul className="flex flex-col gap-2">{threads.data.map((t) => (
              <li key={t.id}>
                <details className="group rounded-md border border-border">
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-base font-medium hover:bg-surface-sunken">
                    <Mail aria-hidden className="size-4 shrink-0 text-info" /><span className="min-w-0 flex-1 truncate">{t.subject} ({t.emails.length})</span>
                  </summary>
                  {t.emails.map((m) => (
                    <div key={m.id} className="border-t border-border px-3 py-2 text-base">
                      <p className="text-xs text-fg-subtle">{humanize(m.direction)} · {formatDateTime(m.sent_at)} · {m.sender} → {m.to.join(", ")}</p>
                      <p className="mt-1 whitespace-pre-wrap text-fg">{m.body_text}</p>
                    </div>
                  ))}
                </details>
              </li>
            ))}</ul>
          )}
        </Card>

        <Card title="Calls">
          {!calls.data ? <TableSkeleton rows={2} cols={2} /> : calls.data.length === 0 ? <Empty>No calls logged yet.</Empty> : (
            <ul className="flex flex-col divide-y divide-border">{calls.data.map((c) => (
              <li key={c.id} className="py-2 text-base">
                <p className="text-xs text-fg-subtle">{formatDateTime(c.called_at)} · {humanize(c.direction)} · <span className="tabular-nums">{formatPhone(c.contact_number)}</span></p>
                <p className="text-fg">{c.summary}{c.next_action ? <span className="text-fg-muted"> → {c.next_action}</span> : ""}</p>
              </li>
            ))}</ul>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete document?"
        description={<>“{deleting?.file_name}” will be removed from this member’s record. The deletion and your reason are logged.</>}
        reasonLabel="Reason for deleting this document"
        minReason={1}
        confirmLabel="Delete document"
        pending={del.isPending}
        onConfirm={(reason) => deleting && del.mutate({ id: deleting.id, reason })}
      >
        <ErrorText error={del.error} />
      </ConfirmDialog>
    </div>
  );
}
