"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { ErrorText, useCan } from "@/components/providers";
import { Badge, Button, Card, Field, Input, KeyValue, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Lead } from "@/lib/types";

const NEXT: Record<string, string[]> = {
  NEW: ["CONTACTED", "NOT_INTERESTED"],
  CONTACTED: ["PRESENTATION_SCHEDULED", "NOT_INTERESTED"],
  PRESENTATION_SCHEDULED: ["ATTENDED", "PRESENTATION_SCHEDULED", "NOT_INTERESTED", "CONTACTED"],
  ATTENDED: ["NOT_INTERESTED"],
  NOT_INTERESTED: ["CONTACTED"],
  CONVERTED: [],
};

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const lead = useQuery({ queryKey: ["lead", id], queryFn: () => api.get<Lead>(`/leads/${id}`) });
  const history = useQuery({ queryKey: ["lead-history", id], queryFn: () => api.get<{ from_status: string | null; to_status: string; changed_at: string; note: string | null }[]>(`/leads/${id}/status-history`) });
  const [presentationAt, setPresentationAt] = useState("");
  const [note, setNote] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lead", id] });
    qc.invalidateQueries({ queryKey: ["lead-history", id] });
  };
  const status = useMutation({
    mutationFn: (s: string) => api.post<Lead>(`/leads/${id}/status`, { status: s, presentation_at: presentationAt ? new Date(presentationAt).toISOString() : null }),
    onSuccess: async (updated) => {
      // use the server's response directly so an older in-flight refetch cannot overwrite it
      await qc.cancelQueries({ queryKey: ["lead", id] });
      qc.setQueryData(["lead", id], updated);
      qc.invalidateQueries({ queryKey: ["lead-history", id] });
    },
  });
  const addNote = useMutation({ mutationFn: () => api.post(`/leads/${id}/notes`, { note }), onSuccess: () => { setNote(""); refresh(); } });
  const l = lead.data;
  if (!l) return <p>Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{l.lead_number} · {l.prospect_name}</h1>
        <span data-testid="lead-status"><Badge>{l.status}</Badge></span>
        {l.member_id && <Link className="underline" href={`/members/${l.member_id}`}>Open member</Link>}
        {l.status === "ATTENDED" && can("lead.convert") && (
          <Link href={`/leads/${id}/convert`}><Button>Convert to member</Button></Link>
        )}
      </div>
      <Card title="Lead details">
        <KeyValue items={[
          ["Entry date", formatDate(l.entry_date)], ["Mobile", l.mobile], ["WhatsApp", l.whatsapp], ["Email", l.email],
          ["City", l.city], ["OPC / marketer", l.opc_name], ["Follow-up", formatDate(l.follow_up_date)],
          ["Presentation", formatDateTime(l.presentation_at)],
        ]} />
        {l.status === "CONVERTED" && <p className="mt-2 text-xs text-muted-foreground">Converted leads are retained; identity and conversion fields are read-only.</p>}
      </Card>
      {can("lead.status.change") && (NEXT[l.status] ?? []).length > 0 && (
        <Card title="Change status">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Presentation date & time (for PRESENTATION_SCHEDULED)" htmlFor="pat">
              <Input id="pat" type="datetime-local" value={presentationAt} onChange={(e) => setPresentationAt(e.target.value)} />
            </Field>
            {(NEXT[l.status] ?? []).map((s) => (
              <Button key={s} variant="outline" onClick={() => status.mutate(s)} disabled={status.isPending}>{s.replaceAll("_", " ")}</Button>
            ))}
          </div>
          <ErrorText error={status.error} />
        </Card>
      )}
      <Card title="Notes">
        <ul className="mb-3 flex flex-col gap-2 text-sm">
          {l.notes.map((n) => <li key={n.id}><span className="text-muted-foreground">{formatDateTime(n.created_at)}:</span> {n.note}</li>)}
        </ul>
        {can("lead.update") && (
          <div className="flex flex-col gap-2">
            <Textarea aria-label="New note" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button className="self-start" variant="outline" onClick={() => addNote.mutate()} disabled={!note.trim()}>Add note</Button>
          </div>
        )}
      </Card>
      <Card title="Status history">
        <ol className="text-sm">
          {history.data?.map((h, i) => <li key={i}>{formatDateTime(h.changed_at)} · {h.from_status ?? "—"} → {h.to_status} {h.note ? `(${h.note})` : ""}</li>)}
        </ol>
      </Card>
    </div>
  );
}
