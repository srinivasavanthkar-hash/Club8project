"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { DocLink } from "@/components/member/DocLink";
import { ErrorText, useCan, useMaster } from "@/components/providers";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Member } from "@/lib/types";

type Email = { id: string; direction: string; sent_at: string; sender: string; to: string[]; subject: string; body_text: string };
type Thread = { id: string; subject: string; emails: Email[] };
type Call = { id: string; direction: string; called_at: string; contact_number: string; summary: string; next_action: string | null; next_action_date: string | null };
type Doc = { id: string; file_name: string; content_type: string; created_at: string; document_type_id: string; scan_status: string; description: string | null };
type Item = { type: string; at: string; title: string; id: string };

const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function CorrespondenceTab({ member }: { member: Member }) {
  const qc = useQueryClient();
  const can = useCan();
  const docTypes = useMaster("document-types");
  const outcomes = useMaster("reasons");
  const threads = useQuery({ queryKey: ["threads", member.id], queryFn: () => api.get<Thread[]>(`/members/${member.id}/email-threads`) });
  const calls = useQuery({ queryKey: ["calls", member.id], queryFn: () => api.get<Call[]>(`/members/${member.id}/calls`) });
  const docs = useQuery({ queryKey: ["docs", member.id], queryFn: () => api.get<Doc[]>(`/members/${member.id}/documents`) });
  const [types, setTypes] = useState<string[]>([]);
  const timeline = useQuery({ queryKey: ["timeline", member.id, types], queryFn: () => api.get<Item[]>(`/members/${member.id}/timeline`, { types }) });
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === member.id });

  const [email, setEmail] = useState({ direction: "INCOMING", sent_at: nowLocal(), sender: member.email, to: "", subject: "", body: "" });
  const addEmail = useMutation({
    mutationFn: () => api.post(`/members/${member.id}/emails`, { ...email, sent_at: new Date(email.sent_at).toISOString(), to: email.to.split(",").map((s) => s.trim()).filter(Boolean) }),
    onSuccess: () => { setEmail({ ...email, subject: "", body: "" }); refresh(); },
  });
  const emlRef = useRef<HTMLInputElement>(null);
  const importEml = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); fd.append("direction", "INCOMING"); return api.post(`/members/${member.id}/emails/import`, fd); },
    onSuccess: refresh,
  });
  const [call, setCall] = useState({ direction: "OUTGOING", called_at: nowLocal(), contact_number: member.applicants[0]?.mobile ?? "", summary: "", outcome_id: "", next_action: "", next_action_date: "" });
  const addCall = useMutation({
    mutationFn: () => api.post(`/members/${member.id}/calls`, { ...call, called_at: new Date(call.called_at).toISOString(), outcome_id: call.outcome_id || null, next_action: call.next_action || null, next_action_date: call.next_action_date || null }),
    onSuccess: () => { setCall({ ...call, summary: "" }); refresh(); },
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("");
  const [desc, setDesc] = useState("");
  const upload = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); fd.append("document_type_id", docType); if (desc) fd.append("description", desc); return api.post(`/members/${member.id}/documents`, fd); },
    onSuccess: () => { setDesc(""); if (fileRef.current) fileRef.current.value = ""; refresh(); },
  });
  const [delReason, setDelReason] = useState("");
  const del = useMutation({ mutationFn: (id: string) => api.post(`/documents/${id}/delete`, { reason: delReason }), onSuccess: refresh });
  const typeName = (id: string) => docTypes.data?.find((d) => d.id === id)?.name ?? "";

  return (
    <div className="grid gap-4 pt-4 xl:grid-cols-2">
      <Card title="Emails">
        {can("correspondence.create") && (
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            <Field label="Direction" htmlFor="ed"><Select id="ed" value={email.direction} onChange={(e) => setEmail({ ...email, direction: e.target.value })}><option>INCOMING</option><option>OUTGOING</option></Select></Field>
            <Field label="Date/time" htmlFor="et"><Input id="et" type="datetime-local" value={email.sent_at} onChange={(e) => setEmail({ ...email, sent_at: e.target.value })} /></Field>
            <Field label="From" htmlFor="ef"><Input id="ef" value={email.sender} onChange={(e) => setEmail({ ...email, sender: e.target.value })} /></Field>
            <Field label="To (comma separated)" htmlFor="eto"><Input id="eto" value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })} /></Field>
            <Field label="Subject" htmlFor="es" className="md:col-span-2"><Input id="es" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} /></Field>
            <Field label="Body" htmlFor="eb" className="md:col-span-2"><Textarea id="eb" value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button onClick={() => addEmail.mutate()} disabled={!email.subject}>Add email</Button>
              <input ref={emlRef} type="file" accept=".eml,.msg" className="hidden" aria-label="Import .eml or .msg" onChange={(e) => e.target.files?.[0] && importEml.mutate(e.target.files[0])} />
              <Button variant="outline" onClick={() => emlRef.current?.click()}>Import .eml / .msg</Button>
            </div>
            <div className="md:col-span-2"><ErrorText error={addEmail.error ?? importEml.error} /></div>
          </div>
        )}
        {threads.data?.map((t) => (
          <details key={t.id} className="mb-2 rounded border border-border p-2">
            <summary className="cursor-pointer text-sm font-medium">{t.subject} ({t.emails.length})</summary>
            {t.emails.map((m) => (
              <div key={m.id} className="mt-2 border-t border-border pt-2 text-sm">
                <p className="text-xs text-muted-foreground">{m.direction} · {formatDateTime(m.sent_at)} · {m.sender} → {m.to.join(", ")}</p>
                <p className="whitespace-pre-wrap">{m.body_text}</p>
              </div>
            ))}
          </details>
        ))}
      </Card>

      <Card title="Calls">
        {can("correspondence.create") && (
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            <Field label="Direction" htmlFor="cd"><Select id="cd" value={call.direction} onChange={(e) => setCall({ ...call, direction: e.target.value })}><option>OUTGOING</option><option>INCOMING</option></Select></Field>
            <Field label="Date/time" htmlFor="ct"><Input id="ct" type="datetime-local" value={call.called_at} onChange={(e) => setCall({ ...call, called_at: e.target.value })} /></Field>
            <Field label="Contact number" htmlFor="cn"><Input id="cn" value={call.contact_number} onChange={(e) => setCall({ ...call, contact_number: e.target.value })} /></Field>
            <Field label="Outcome" htmlFor="co"><Select id="co" value={call.outcome_id} onChange={(e) => setCall({ ...call, outcome_id: e.target.value })}><option value="">—</option>{outcomes.data?.filter((r) => r.kind === "CALL_OUTCOME").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
            <Field label="Summary" htmlFor="cs" className="md:col-span-2"><Textarea id="cs" value={call.summary} onChange={(e) => setCall({ ...call, summary: e.target.value })} /></Field>
            <Field label="Next action" htmlFor="cna"><Input id="cna" value={call.next_action} onChange={(e) => setCall({ ...call, next_action: e.target.value })} /></Field>
            <Field label="Next action date" htmlFor="cnd"><Input id="cnd" type="date" value={call.next_action_date} onChange={(e) => setCall({ ...call, next_action_date: e.target.value })} /></Field>
            <Button className="self-start" onClick={() => addCall.mutate()} disabled={!call.summary}>Add call</Button>
            <div className="md:col-span-2"><ErrorText error={addCall.error} /></div>
          </div>
        )}
        <ul className="text-sm">{calls.data?.map((c) => (
          <li key={c.id} className="border-t border-border py-1">{formatDateTime(c.called_at)} · {c.direction} · {c.contact_number}: {c.summary}{c.next_action ? ` → ${c.next_action}` : ""}</li>
        ))}</ul>
      </Card>

      <Card title="Documents">
        {can("document.upload") && (
          <div className="mb-4 grid gap-2 md:grid-cols-3">
            <Field label="Document type" htmlFor="dt"><Select id="dt" value={docType} onChange={(e) => setDocType(e.target.value)}><option value="">Select…</option>{docTypes.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <Field label="Description" htmlFor="ddesc"><Input id="ddesc" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
            <Field label="File (PDF, JPEG, PNG)" htmlFor="dfile"><Input id="dfile" ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" disabled={!docType} onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} /></Field>
            <div className="md:col-span-3"><ErrorText error={upload.error} /></div>
          </div>
        )}
        <ul className="text-sm">{docs.data?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 border-t border-border py-1">
            <span>{d.file_name}</span><span className="text-xs text-muted-foreground">{typeName(d.document_type_id)} · {formatDateTime(d.created_at)}</span>
            {d.scan_status !== "CLEAN" && <Badge>{d.scan_status}</Badge>}
            {d.scan_status === "CLEAN" && <DocLink id={d.id} label="Preview" contentType={d.content_type} />}
            {can("document.delete") && (
              <button className="text-xs text-destructive underline" onClick={() => { const r = prompt("Reason for deleting this document?"); if (r) { setDelReason(r); setTimeout(() => del.mutate(d.id)); } }}>Delete</button>
            )}
          </li>
        ))}</ul>
        <ErrorText error={del.error} />
      </Card>

      <Card title="Timeline">
        <div className="mb-2 flex flex-wrap gap-2 text-xs">
          {["email", "call", "document", "payment", "reservation", "entitlement", "status"].map((t) => (
            <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={types.includes(t)} onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))} /> {t}</label>
          ))}
        </div>
        <ol className="text-sm">{timeline.data?.map((i, n) => (
          <li key={`${i.type}-${i.id}-${n}`} className="border-t border-border py-1"><span className="text-xs text-muted-foreground">{formatDateTime(i.at)} · {i.type}</span> {i.title}</li>
        ))}</ol>
      </Card>
    </div>
  );
}
