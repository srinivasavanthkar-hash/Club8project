"use client";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Braces, Eye, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { SearchSelect } from "@/components/crm/SearchSelect";
import { TableSkeleton } from "@/components/crm/States";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { Table, Td, Th, THead, Tr } from "@/components/crm/Table";
import { useToast } from "@/components/crm/Toast";
import { ErrorText, useMe } from "@/components/providers";
import { Alert, Button, Checkbox, Drawer, Empty, Field, Input, Select, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { todayIso } from "@/lib/format";
import {
  cellText, emptyValues, type FieldSpec, type FormSpec, payload, refOptions, type RefRows, type Row, serverFieldErrors,
  settingKind, toValues, validate, type Values,
} from "@/lib/masterForm";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/DateField";

export function useMasterForms() {
  return useQuery({ queryKey: ["master-forms"], queryFn: () => api.get<Record<string, FormSpec>>("/admin/master-forms"), staleTime: 30 * 60_000 });
}

/** Every table referenced by this form, including inactive rows (so old records still show a name). */
function useRefs(spec: FormSpec | undefined): RefRows {
  const slugs = useMemo(() => [...new Set((spec?.fields ?? []).flatMap((f) => (f.ref ? [f.ref.slug] : [])))], [spec]);
  const results = useQueries({
    queries: slugs.map((s) => ({ queryKey: ["master", s, true], queryFn: () => api.get<Row[]>(`/admin/master/${s}`, { include_inactive: true }), staleTime: 60_000 })),
  });
  return Object.fromEntries(slugs.map((s, i) => [s, results[i]?.data ?? []]));
}

function isCurrent(r: Row) {
  const today = todayIso();
  return String(r.effective_from) <= today && (!r.effective_to || String(r.effective_to) >= today);
}

function FieldInput({ f, value, onChange, refs, original, locked, error, settingKey = "" }: {
  f: FieldSpec; value: string | boolean; onChange: (v: string | boolean) => void; refs: RefRows; original?: unknown; locked: boolean; error?: string;
  settingKey?: string;
}) {
  const id = `mf-${f.name}`;
  const hint = locked ? f.locked_on_edit : f.help;
  const s = typeof value === "string" ? value : "";
  if (f.kind === "bool" || (f.kind === "setting_value" && settingKind(original) === "bool")) {
    return (
      <div className="flex flex-col gap-1">
        <Checkbox label={f.label} checked={Boolean(value)} disabled={locked} onChange={(e) => onChange(e.target.checked)} />
        {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
      </div>
    );
  }
  const required = f.required && f.kind !== "setting_value";
  let control: React.ReactElement;
  switch (f.kind) {
    case "ref":
      control = (
        <SearchSelect id={id} value={s} onChange={onChange} disabled={locked} invalid={!!error}
          options={refOptions(f, refs[f.ref!.slug], s)} noneLabel={f.ref?.none_label} placeholder="Search…" />
      );
      break;
    case "choice":
      control = (
        <Select id={id} value={s} disabled={locked} onChange={(e) => onChange(e.target.value)}>
          <option value="">{required ? "Select…" : "None"}</option>
          {f.choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      );
      break;
    case "date":
      control = <DateField id={id} value={s} disabled={locked} onChange={(v) => onChange(v)} />;
      break;
    case "int": case "decimal":
      control = <Input id={id} inputMode={f.kind === "int" ? "numeric" : "decimal"} className="text-right tabular-nums" value={s} disabled={locked} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "colour":
      control = (
        <div className="flex items-center gap-2">
          <Input id={id} className="font-mono" value={s} disabled={locked} placeholder="#RRGGBB" onChange={(e) => onChange(e.target.value)} />
          <span aria-hidden className="size-8 shrink-0 rounded-md border border-border" style={{ background: /^#[0-9a-fA-F]{6}$/.test(s) ? s : "transparent" }} /> {/* design-tokens-allow: shows the brand colour being entered */}
        </div>
      );
      break;
    case "textarea": case "str_list":
      control = <Textarea id={id} rows={f.kind === "str_list" ? 4 : 3} value={s} disabled={locked} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "setting_value": {
      const k = settingKind(original);
      const fixed = f.setting_choices?.[settingKey];
      control = fixed
        ? <Select id={id} value={s} disabled={locked} onChange={(e) => onChange(e.target.value)}>{fixed.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>
        : k === "text_list"
        ? <Textarea id={id} rows={3} value={s} disabled={locked} onChange={(e) => onChange(e.target.value)} />
        : <Input id={id} inputMode={k === "number" ? "numeric" : undefined} value={s} disabled={locked} onChange={(e) => onChange(e.target.value)} />;
      break;
    }
    default:
      control = <Input id={id} maxLength={f.max_length} value={s} disabled={locked} onChange={(e) => onChange(e.target.value)} />;
  }
  const listHint = f.kind === "setting_value" ? (settingKind(original) === "text_list" ? "One per line." : settingKind(original) === "number_list" ? "Numbers separated by commas." : undefined) : undefined;
  return <Field label={f.label} htmlFor={id} required={required} hint={[hint, listHint].filter(Boolean).join(" ") || undefined} error={error}>{control}</Field>;
}

/** Letter text with a preview filled with fictitious sample data (nothing is saved by previewing). */
function LetterField({ code, value, onChange, error }: { code: string; value: string; onChange: (v: string) => void; error?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const preview = useMutation({
    mutationFn: () => api.post<{ html: string }>("/admin/letter-templates/preview", { code: code || "RECEIPT", body_html: value }),
    onSuccess: (r) => setHtml(r.html),
  });
  return (
    <div className="flex flex-col gap-2">
      <Field label="Letter text" htmlFor="mf-body_html" required error={error}
        hint={<>Placeholders such as <code>{"{{ name }}"}</code>, <code>{"{{ m.membership_number }}"}</code> or <code>{"{{ p.total_amount|money(p.currency) }}"}</code> are filled in when the letter is generated. The logo, company name and address are added automatically.</>}>
        <Textarea id="mf-body_html" rows={16} className="font-mono text-sm" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <div><Button variant="outline" size="sm" onClick={() => preview.mutate()} disabled={preview.isPending}><Eye aria-hidden />{preview.isPending ? "Preparing preview…" : "Preview with sample data"}</Button></div>
      <ErrorText error={preview.error} />
      {html && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-fg-subtle">Preview with FICTITIOUS sample data. The printed PDF uses the same layout.</p>
          <iframe title="Letter preview" sandbox="" srcDoc={html} className="h-[70vh] w-full rounded-md border border-border bg-white" data-testid="letter-preview" /> {/* design-tokens-allow: a letter is printed on white paper */}
        </div>
      )}
    </div>
  );
}

function MasterFormDrawer({ spec, label, row, onClose }: { spec: FormSpec; label: string; row: Row | null | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const refs = useRefs(spec);
  const editing = !!row;
  const [values, setValues] = useState<Values>(() => (row ? toValues(spec, row) : emptyValues(spec)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [override, setOverride] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState("");
  const isAdmin = !!me.data?.roles.includes("ADMIN");

  const save = useMutation({
    mutationFn: (body: Row) => editing
      ? api.patch<Row>(`/admin/master/${spec.slug}/${row!.id}`, body, { headers: { "If-Match": String(row!.version) } })
      : api.post<Row & { _warnings?: string[] }>(`/admin/master/${spec.slug}`, body, override ? { headers: { "X-Override-Reason": override } } : undefined),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["master", spec.slug] });
      const w = (r as { _warnings?: string[] })._warnings ?? [];
      setWarn(w);
      toast.success(editing ? "Changes saved" : "Entry added");
      if (!w.length) onClose();
    },
    onError: (e) => { if (e instanceof ApiError) setErrors(serverFieldErrors(spec, e.problem.errors)); },
  });

  const submit = () => {
    if (advanced) {
      try { save.mutate(JSON.parse(json) as Row); } catch { setErrors({ _json: "This is not valid JSON." }); }
      return;
    }
    const found = validate(spec, values, editing);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = payload(spec, values, row ?? undefined);
    if (editing && !Object.keys(body).length) { onClose(); return; }
    save.mutate(body);
  };
  const set = (name: string) => (v: string | boolean) => setValues((cur) => ({ ...cur, [name]: v }));
  const errorCount = Object.keys(errors).length;

  return (
    <Drawer
      open
      onClose={onClose}
      title={editing ? `Edit ${label.toLowerCase()} entry` : `Add to ${label}`}
      description={spec.effective_dated && !editing ? "Effective-dated: the entry applies from its first day; the previous entry for the same item is closed automatically." : undefined}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save changes" : "Add entry"}</Button></>}
    >
      <div className="flex flex-col gap-4">
        {errorCount > 0 && <Alert kind="error" title={errorCount === 1 ? "Please correct the highlighted field." : `Please correct the ${errorCount} highlighted fields.`} />}
        {!advanced && (
          <div className="grid gap-4 md:grid-cols-2">
            {spec.fields.map((f) => f.kind === "letter" ? (
              <div key={f.name} className="md:col-span-2">
                <LetterField code={String(values.code ?? "")} value={String(values[f.name] ?? "")} onChange={set(f.name)} error={errors[f.name]} />
              </div>
            ) : (
              <div key={f.name} className={cn((["textarea", "str_list", "ref"].includes(f.kind) || f.name === "description") && "md:col-span-2")}>
                <FieldInput f={f} value={values[f.name] ?? ""} onChange={set(f.name)} refs={refs} original={row?.[f.name]} settingKey={String(row?.key ?? values.key ?? "")}
                  locked={editing && !!f.locked_on_edit} error={errors[f.name]} />
              </div>
            ))}
          </div>
        )}
        {spec.slug === "asf-rates" && !editing && (
          <Field label="Override reason (only if the increase is above the agreement cap)" htmlFor="mf-override" hint="Recorded in the activity log.">
            <Input id="mf-override" value={override} onChange={(e) => setOverride(e.target.value)} />
          </Field>
        )}
        {warn.map((w) => <Alert key={w} kind="warning">{w}</Alert>)}
        <ErrorText error={save.error} />
        {isAdmin && (
          <details className="rounded-md border border-dashed border-border p-3 text-sm" onToggle={(e) => {
            const open = (e.target as HTMLDetailsElement).open;
            setAdvanced(open);
            if (open) setJson(JSON.stringify(payload(spec, values, row ?? undefined), null, 2));
          }}>
            <summary className="cursor-pointer text-fg-muted"><Braces aria-hidden className="mr-1 inline size-4" />Advanced (JSON), administrators only</summary>
            <p className="mt-2 text-xs text-fg-subtle">A fallback for unusual cases. The form above is the normal way to enter data; while this is open, the JSON below is sent instead.</p>
            <Textarea aria-label="Entry as JSON" className="mt-2 font-mono text-xs" rows={10} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} />
            {errors._json && <p className="mt-1 text-xs font-medium text-danger">{errors._json}</p>}
          </details>
        )}
      </div>
    </Drawer>
  );
}

export function MasterEditor({ slug, label }: { slug: string; label: string }) {
  const qc = useQueryClient();
  const forms = useMasterForms();
  const spec = forms.data?.[slug];
  const refs = useRefs(spec);
  const rows = useQuery({ queryKey: ["master", slug, true], queryFn: () => api.get<Row[]>(`/admin/master/${slug}`, { include_inactive: true }) });
  const [editing, setEditing] = useState<Row | null | undefined>(undefined); // undefined = closed, null = new
  const toggle = useMutation({
    mutationFn: (r: Row) => api.patch(`/admin/master/${slug}/${r.id}`, { is_active: !r.is_active }, { headers: { "If-Match": String(r.version) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["master", slug] }),
  });
  if (forms.error) return <ErrorText error={forms.error} />;
  if (!spec) return <div className="rounded-md border border-border bg-surface"><TableSkeleton rows={5} cols={5} /></div>;
  const cols = spec.columns.map((c) => spec.fields.find((f) => f.name === c)!).filter(Boolean);
  const canAdd = slug !== "settings"; // settings are fixed keys: change their values
  return (
    <div className="flex flex-col gap-3">
      {spec.intro && <p className="max-w-3xl text-base text-fg-muted">{spec.intro}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base text-fg-muted">
          {rows.data ? `${rows.data.length} ${rows.data.length === 1 ? "entry" : "entries"}` : "Loading…"}
          {spec.effective_dated && <span className="ml-2 inline-flex items-center gap-1 text-sm"><span aria-hidden className="size-2.5 rounded-sm bg-primary-subtle ring-1 ring-primary/30" />current entry highlighted</span>}
        </p>
        {canAdd && <Button onClick={() => setEditing(null)}><Plus aria-hidden />Add entry</Button>}
      </div>
      {!rows.data ? <div className="rounded-md border border-border bg-surface"><TableSkeleton rows={5} cols={5} /></div> : rows.data.length === 0 ? <Empty>No entries yet.</Empty> : (
        <Table caption={label} density="compact" stickyFirstColumn maxHeight>
          <THead><tr>{spec.effective_dated && <Th><span className="sr-only">Current</span></Th>}{cols.map((f) => <Th key={f.name}>{f.label}</Th>)}<Th><span className="sr-only">Actions</span></Th></tr></THead>
          <tbody>{rows.data.map((r) => {
            const current = spec.effective_dated && isCurrent(r);
            return (
              <Tr key={String(r.id)} tone={current ? "highlight" : r.is_active === false ? "muted" : undefined}>
                {spec.effective_dated && <Td>{current && <span className="rounded-full bg-primary px-2 py-px text-xs font-semibold text-fg-on-fill">Current</span>}</Td>}
                {cols.map((f) => (
                  <Td key={f.name} className="max-w-64 truncate" title={cellText(f, r, refs)}>
                    {f.name === "is_active" ? <StatusBadge status={r.is_active ? "ACTIVE" : "INACTIVE"} size="sm" />
                      : f.kind === "colour" && r[f.name] ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm border border-border" style={{ background: String(r[f.name]) }} /><span className="font-mono text-xs">{String(r[f.name])}</span></span> /* design-tokens-allow: the stored brand colour */
                      : cellText(f, r, refs)}
                  </Td>
                ))}
                <Td align="right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`Edit ${cellText(cols[0]!, r, refs)}`}><Pencil aria-hidden />Edit</Button>
                    {"is_active" in r && <Button variant="ghost" size="sm" onClick={() => toggle.mutate(r)}>{r.is_active ? "Disable" : "Enable"}</Button>}
                  </div>
                </Td>
              </Tr>
            );
          })}</tbody>
        </Table>
      )}
      <ErrorText error={toggle.error} />
      {editing !== undefined && <MasterFormDrawer key={String(editing?.id ?? "new")} spec={spec} label={label} row={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
