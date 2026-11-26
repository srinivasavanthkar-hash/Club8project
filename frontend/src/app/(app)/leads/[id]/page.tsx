"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, UserCheck } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { Mono, PageHeader } from "@/components/crm/Display";
import { ErrorState, PageSkeleton } from "@/components/crm/States";
import { StatusStepper } from "@/components/crm/Stepper";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { Timeline } from "@/components/crm/Timeline";
import { useToast } from "@/components/crm/Toast";
import { ErrorText, useCan } from "@/components/providers";
import { Button, buttonClasses, Card, Field, KeyValue, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, formatPhone, formatRelativeDays, humanize } from "@/lib/format";
import type { Lead } from "@/lib/types";
import { DateTimeField } from "@/components/DateField";
import { istToInstant } from "@/lib/dates";

const NEXT: Record<string, string[]> = {
  NEW: ["CONTACTED", "NOT_INTERESTED"],
  CONTACTED: ["PRESENTATION_SCHEDULED", "NOT_INTERESTED"],
  PRESENTATION_SCHEDULED: ["ATTENDED", "PRESENTATION_SCHEDULED", "NOT_INTERESTED", "CONTACTED"],
  ATTENDED: ["NOT_INTERESTED"],
  NOT_INTERESTED: ["CONTACTED"],
  CONVERTED: [],
};
const PATH = ["NEW", "CONTACTED", "PRESENTATION_SCHEDULED", "ATTENDED", "CONVERTED"];

/** Button label for a transition (contains the target status words, except the reschedule). */
function actionLabel(from: string, to: string) {
  if (from === to) return "Reschedule presentation";
  if (PATH.indexOf(to) >= 0 && PATH.indexOf(to) < PATH.indexOf(from)) return `Back to ${humanize(to).toLowerCase()}`;
  if (from === "NOT_INTERESTED") return `Reopen as ${humanize(to).toLowerCase()}`;
  return `Mark ${humanize(to).toLowerCase()}`;
}

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const can = useCan();
  const toast = useToast();
  const lead = useQuery({ queryKey: ["lead", id], queryFn: () => api.get<Lead>(`/leads/${id}`) });
  const history = useQuery({ queryKey: ["lead-history", id], queryFn: () => api.get<{ from_status: string | null; to_status: string; changed_at: string; note: string | null }[]>(`/leads/${id}/status-history`) });
  const [presentationAt, setPresentationAt] = useState("");
  const [note, setNote] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lead", id] });
    qc.invalidateQueries({ queryKey: ["lead-history", id] });
  };
  const status = useMutation({
    mutationFn: (s: string) => api.post<Lead>(`/leads/${id}/status`, { status: s, presentation_at: presentationAt ? istToInstant(presentationAt) : null }),
    onSuccess: async (updated) => {
      // use the server's response directly so an older in-flight refetch cannot overwrite it
      await qc.cancelQueries({ queryKey: ["lead", id] });
      qc.setQueryData(["lead", id], updated);
      qc.invalidateQueries({ queryKey: ["lead-history", id] });
      toast.success(`Status changed to ${humanize(updated.status).toLowerCase()}`);
    },
  });
  const addNote = useMutation({ mutationFn: () => api.post(`/leads/${id}/notes`, { note }), onSuccess: () => { setNote(""); refresh(); toast.success("Note added"); } });
  const l = lead.data;
  if (lead.error) return <ErrorState message="This lead could not be loaded." onRetry={() => lead.refetch()} />;
  if (!l) return <PageSkeleton variant="record" />;
  const next = NEXT[l.status] ?? [];
  const followRel = l.follow_up_date ? formatRelativeDays(l.follow_up_date, "overdue") : "";

  const timeline = [
    ...l.notes.map((n) => ({ key: `n-${n.id}`, type: "note", at: n.created_at, title: n.note })),
    ...(history.data ?? []).map((h, i) => ({
      key: `h-${i}`, type: "status", at: h.changed_at,
      title: <span>{h.from_status ? <>{humanize(h.from_status)} <ArrowRight aria-hidden className="inline size-3.5 text-fg-subtle" /> </> : "Created as "}{humanize(h.to_status)}{h.note ? ` · ${h.note}` : ""}</span>,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`${l.lead_number} · ${l.prospect_name}`}
        meta={<span data-testid="lead-status"><StatusBadge status={l.status} /></span>}
        actions={
          <>
            {l.member_id && <Link className={buttonClasses({ variant: "outline" })} href={`/members/${l.member_id}`}><ExternalLink aria-hidden />Open member</Link>}
            {l.status === "ATTENDED" && can("lead.convert") && (
              <Link href={`/leads/${id}/convert`} className={buttonClasses({ className: "h-10 px-5" })}><UserCheck aria-hidden />Convert to member</Link>
            )}
          </>
        }
      />

      <Card title="Progress">
        <StatusStepper path={PATH} current={l.status} offPath={["NOT_INTERESTED"]} label="Lead status">
          {can("lead.status.change") && next.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              {(next.includes("PRESENTATION_SCHEDULED")) && (
                <Field label="Presentation date & time (for PRESENTATION_SCHEDULED)" htmlFor="pat" className="max-w-md" hint="Set this before scheduling a presentation.">
                  <DateTimeField id="pat" timeLabel="Presentation time" value={presentationAt} onChange={setPresentationAt} />
                </Field>
              )}
              <div className="flex flex-wrap gap-2">
                {next.map((s) => (
                  <Button
                    key={s}
                    variant={s === "NOT_INTERESTED" ? "ghost" : PATH.indexOf(s) > PATH.indexOf(l.status) ? "default" : "outline"}
                    onClick={() => status.mutate(s)}
                    disabled={status.isPending}
                  >
                    {actionLabel(l.status, s)}
                  </Button>
                ))}
              </div>
              <ErrorText error={status.error} />
            </div>
          )}
        </StatusStepper>
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="Lead details" className="lg:col-span-3">
          <KeyValue columns={2} items={[
            ["Entry date", formatDate(l.entry_date)], ["Mobile", <span key="m" className="tabular-nums">{formatPhone(l.mobile)}</span>],
            ["WhatsApp", l.whatsapp_same_as_mobile ? "Same as mobile" : formatPhone(l.whatsapp)], ["Email", l.email],
            ["City", l.city], ["OPC / marketer", l.opc_name],
            ["Follow-up", l.follow_up_date ? <span key="f">{formatDate(l.follow_up_date)} {followRel && <span className={followRel.includes("overdue") ? "text-danger" : "text-fg-subtle"}>· {followRel}</span>}</span> : "—"],
            ["Presentation", formatDateTime(l.presentation_at)],
            ["Lead ID", <Mono key="id">{l.lead_number}</Mono>],
          ]} />
          {l.status === "CONVERTED" && <p className="mt-4 text-sm text-fg-subtle">Converted leads are retained; identity and conversion fields are read-only.</p>}
        </Card>

        <Card title="Notes and history" className="lg:col-span-2">
          {can("lead.update") && (
            <div className="mb-5 flex flex-col gap-2">
              <Textarea aria-label="New note" placeholder="Add a note about this lead…" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button className="self-end" variant="outline" size="sm" onClick={() => addNote.mutate()} disabled={!note.trim() || addNote.isPending}>Add note</Button>
              <ErrorText error={addNote.error} />
            </div>
          )}
          <Timeline items={timeline} empty="No notes yet." />
        </Card>
      </div>
    </div>
  );
}
