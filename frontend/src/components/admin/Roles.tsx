"use client";
/* Roles as a multi-select of the existing roles (never free text), role changes with a required reason, and the
 * "two-step verification required for these roles" policy. The server validates and logs every change. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, UserCog } from "lucide-react";
import * as React from "react";
import { useToast } from "@/components/crm/Toast";
import { ErrorText } from "@/components/providers";
import { Alert, Button, Card, Dialog, Field, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";

export type RoleOption = { code: string; name: string };

/** Accessible multi-select: a fieldset of checkboxes, one per existing role. */
export function RoleChecklist({
  roles, value, onChange, legend = "Roles", hint, recommended = [],
}: {
  roles: RoleOption[]; value: string[]; onChange: (v: string[]) => void; legend?: string; hint?: string; recommended?: string[];
}) {
  const id = React.useId();
  return (
    <fieldset className="flex flex-col gap-1" aria-describedby={hint ? `${id}-hint` : undefined}>
      <legend className="mb-1 text-sm font-medium text-fg">{legend}</legend>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {roles.map((r) => (
          <label key={r.code} className="flex min-h-9 cursor-pointer items-center gap-2 text-base text-fg touch:min-h-11">
            <input
              type="checkbox"
              className="size-4 shrink-0 cursor-pointer accent-primary"
              checked={value.includes(r.code)}
              onChange={(e) => onChange(e.target.checked ? [...value, r.code].sort() : value.filter((c) => c !== r.code))}
            />
            <span>{r.name}</span>
            {recommended.includes(r.code) && <span className="rounded-full bg-info-subtle px-2 py-px text-xs text-info">Recommended</span>}
          </label>
        ))}
      </div>
      {hint && <p id={`${id}-hint`} className="text-xs text-fg-subtle">{hint}</p>}
    </fieldset>
  );
}

export function useRoleOptions(enabled = true) {
  return useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get<(RoleOption & { permissions: string[] })[]>("/admin/roles"),
    enabled,
  });
}

/** Row action: change a user's roles (multi-select + reason). */
export function EditRolesAction({ user }: { user: { id: string; username: string; roles: string[] } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useRoleOptions();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState<string[]>(user.roles);
  const [reason, setReason] = React.useState("");
  React.useEffect(() => { if (open) { setValue(user.roles); setReason(""); } }, [open, user.roles]);
  const save = useMutation({
    mutationFn: () => api.put(`/admin/users/${user.id}/roles`, { roles: value, reason: reason.trim() }),
    onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ["users"] }); toast.success(`Roles updated for ${user.username}`); },
  });
  const changed = [...value].sort().join() !== [...user.roles].sort().join();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit roles for ${user.username}`}><UserCog aria-hidden />Edit roles…</Button>
      <Dialog
        open={open}
        onClose={() => { setOpen(false); save.reset(); }}
        size="sm"
        title={`Roles for ${user.username}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!changed || value.length === 0 || reason.trim().length < 5 || save.isPending}>
              {save.isPending ? "Saving…" : "Save roles"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {roles.data ? <RoleChecklist roles={roles.data} value={value} onChange={setValue} hint="At least one role. Permissions come from the roles (Role permissions below)." /> : <p className="text-fg-muted">Loading roles…</p>}
          <Field label="Reason for the change" htmlFor={`rr-${user.id}`} required hint="Recorded in the activity log.">
            <Textarea id={`rr-${user.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorText error={save.error} />
        </div>
      </Dialog>
    </>
  );
}

type Policy = { require_2fa_roles: string[]; recommended_2fa_roles: string[] };

/** Admin -> Users & roles: which roles must use two-step verification (off by default; OPEN_QUESTIONS 30). */
export function TwoFactorPolicyCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useRoleOptions();
  const policy = useQuery({ queryKey: ["security-policy"], queryFn: () => api.get<Policy>("/admin/security-policy") });
  const [value, setValue] = React.useState<string[] | null>(null);
  const [reason, setReason] = React.useState("");
  const current = value ?? policy.data?.require_2fa_roles ?? [];
  const save = useMutation({
    mutationFn: () => api.put<Policy>("/admin/security-policy", { require_2fa_roles: current, reason: reason.trim() }),
    onSuccess: (p) => { qc.setQueryData(["security-policy"], p); setValue(null); setReason(""); toast.success("Two-step verification policy saved"); },
  });
  if (!policy.data || !roles.data) return null;
  const changed = [...current].sort().join() !== [...policy.data.require_2fa_roles].sort().join();
  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><ShieldCheck aria-hidden className="size-5 text-primary" />Two-step verification policy</span>}
      description="Users in the selected roles must set up two-step verification at their next sign-in before they can use the CRM."
    >
      <div className="flex flex-col gap-4">
        {policy.data.require_2fa_roles.length === 0 && (
          <Alert kind="info">Currently optional for everyone. Recommended for {policy.data.recommended_2fa_roles.map((r) => roles.data.find((x) => x.code === r)?.name ?? humanize(r)).join(", ")}, given the financial and KYC data.</Alert>
        )}
        <RoleChecklist legend="Require two-step verification for" roles={roles.data} value={current} onChange={setValue} recommended={policy.data.recommended_2fa_roles} />
        {changed && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-sunken/50 p-3">
            <Field label="Reason for the change" htmlFor="tfp-reason" required hint="Recorded in the activity log.">
              <Textarea id="tfp-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button onClick={() => save.mutate()} disabled={reason.trim().length < 5 || save.isPending}>{save.isPending ? "Saving…" : "Save policy"}</Button>
              <Button variant="outline" onClick={() => { setValue(null); setReason(""); }}>Cancel</Button>
            </div>
            <ErrorText error={save.error} />
          </div>
        )}
      </div>
    </Card>
  );
}
