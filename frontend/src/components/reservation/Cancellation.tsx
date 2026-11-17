"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, FileText, Upload } from "lucide-react";
import { useMemo, useRef } from "react";
import { ErrorText, useMaster } from "@/components/providers";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

/** GET /reservations/{id}/cancellation-terms: what cancelling would do (nothing is changed). */
export type CancellationTerms = {
  confirmed: boolean;
  request: { ref: string; kind: "email" | "document"; received_on: string; label: string } | null;
  confirmed_on: string | null;
  default_date: string | null;
  max_date: string;
  cancel_date: string | null;
  date_source: "REQUEST" | "CONFIRMATION" | "STAFF" | null;
  date_reason: string | null;
  notice_days: number | null;
  tier_percent: string | null;
  deducted: string;
  credited: string;
  forfeited: string;
  asf_withdraw_years: number[];
  summary: string | null;
  problems: string[];
};

type Email = { id: string; direction: string; sent_at: string; subject: string };
type Thread = { emails: Email[] };
type Doc = { id: string; file_name: string; created_at: string; is_generated: boolean; voided_at: string | null; description: string | null };
type Option = { ref: string; at: string; text: string };

/** The member's written request: their recent incoming emails and uploaded letters (newest first), or upload one. */
export function WrittenRequestPicker({ memberId, reservationId, value, onChange }: {
  memberId: string; reservationId: string; value: string; onChange: (ref: string) => void;
}) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const types = useMaster("document-types");
  const threads = useQuery({ queryKey: ["threads", memberId], queryFn: () => api.get<Thread[]>(`/members/${memberId}/email-threads`) });
  const docs = useQuery({ queryKey: ["docs", memberId], queryFn: () => api.get<Doc[]>(`/members/${memberId}/documents`) });
  const options = useMemo<Option[]>(() => {
    const emails = (threads.data ?? []).flatMap((t) => t.emails).filter((e) => e.direction === "INCOMING")
      .map((e) => ({ ref: `email:${e.id}`, at: e.sent_at, text: `Email: ${e.subject}` }));
    const letters = (docs.data ?? []).filter((d) => !d.is_generated && !d.voided_at)
      .map((d) => ({ ref: `document:${d.id}`, at: d.created_at, text: `Letter: ${d.file_name}` }));
    return [...emails, ...letters].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25);
  }, [threads.data, docs.data]);
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const typeId = types.data?.find((t) => t.code === "MEMBER_LETTER")?.id;
      if (!typeId) throw new Error("Document type MEMBER_LETTER is not set up");
      const fd = new FormData();
      fd.append("file", f);
      fd.append("document_type_id", typeId);
      fd.append("description", "Member's written request to cancel");
      fd.append("link_type", "RESERVATION");
      fd.append("link_id", reservationId);
      return api.post<{ id: string }>(`/members/${memberId}/documents`, fd);
    },
    onSuccess: async (d) => { await qc.invalidateQueries({ queryKey: ["docs", memberId] }); onChange(`document:${d.id}`); },
  });
  return (
    <div className="flex flex-col gap-2">
      <Field label="Member's written request" htmlFor="wr" hint="Their email or letter asking to cancel. The notice period counts from the day it was received.">
        <Select id="wr" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{threads.isLoading || docs.isLoading ? "Loading…" : options.length ? "Select the email or letter…" : "No emails or letters from this member yet"}</option>
          {options.map((o) => <option key={o.ref} value={o.ref}>{formatDate(o.at)} · {o.text}</option>)}
        </Select>
      </Field>
      <input ref={file} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
      <Button variant="outline" size="sm" className="self-start" onClick={() => file.current?.click()} disabled={upload.isPending}>
        <Upload aria-hidden />{upload.isPending ? "Uploading…" : "Upload letter now"}
      </Button>
      <ErrorText error={upload.error} />
    </div>
  );
}

/** Notice date (defaults to when the request was received) and the outcome, shown before anyone presses Cancel. */
export function CancellationDetails({ terms, cancelDate, onCancelDate, dateReason, onDateReason }: {
  terms: CancellationTerms | undefined; cancelDate: string; onCancelDate: (d: string) => void;
  dateReason: string; onDateReason: (r: string) => void;
}) {
  if (!terms) return null;
  if (!terms.confirmed) return <CancellationOutcome terms={terms} />;
  const changed = !!cancelDate && cancelDate !== terms.default_date;
  return (
    <div className="flex flex-col gap-3">
      {terms.request && (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          {terms.request.kind === "email" ? <Mail aria-hidden className="size-4" /> : <FileText aria-hidden className="size-4" />}
          Received {formatDate(terms.request.received_on)}{terms.date_source === "CONFIRMATION" && terms.confirmed_on ? `, before the booking was confirmed (${formatDate(terms.confirmed_on)}): counted from the confirmation` : ""}
        </p>
      )}
      {terms.default_date && (
        <Field label="Cancellation date" htmlFor="cd" hint={changed ? undefined : "The day the request was received. Change it only with a reason."}>
          <Input id="cd" type="date" value={cancelDate || terms.default_date} min={terms.confirmed_on ?? undefined} max={terms.max_date}
            onChange={(e) => onCancelDate(e.target.value === terms.default_date ? "" : e.target.value)} />
        </Field>
      )}
      {changed && (
        <Field label="Reason for changing the date" htmlFor="cdr"><Input id="cdr" value={dateReason} onChange={(e) => onDateReason(e.target.value)} /></Field>
      )}
      <CancellationOutcome terms={terms} />
    </div>
  );
}

export function CancellationOutcome({ terms }: { terms: CancellationTerms }) {
  const blocking = terms.problems.filter((p) => !p.startsWith("Cancelling a confirmed reservation requires"));
  return (
    <>
      {terms.summary && blocking.length === 0 && (
        <Alert kind="info" title="If cancelled now">
          <span className="tabular-nums">{terms.summary}.</span>
          {terms.asf_withdraw_years.length > 0 && <span className="block">Unpaid ASF {terms.asf_withdraw_years.join(", ")} will be withdrawn.</span>}
        </Alert>
      )}
      {blocking.length > 0 && <Alert kind="warning"><ul className="list-disc pl-4">{blocking.map((p) => <li key={p}>{p}</li>)}</ul></Alert>}
    </>
  );
}
