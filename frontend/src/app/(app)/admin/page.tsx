"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Plus, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { type AdminUser, type OneTime, OneTimePasswordDialog, PendingAdminResets, UserRecoveryActions } from "@/components/admin/AccountRecovery";
import { EditRolesAction, RoleChecklist, TwoFactorPolicyCard } from "@/components/admin/Roles";
import { PageHeader } from "@/components/crm/Display";
import { TableSkeleton } from "@/components/crm/States";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { Table, Td, Th, THead, Tr } from "@/components/crm/Table";
import { useToast } from "@/components/crm/Toast";
import { ErrorText, useCan } from "@/components/providers";
import { Alert, Button, Card, Drawer, Empty, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { humanize, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

const MASTER = [
  ["companies", "Companies / brands"], ["resort-categories", "Resort categories"], ["seasons", "Seasons"], ["season-calendar", "Season calendar"],
  ["unit-types", "Unit types & occupancy"], ["products", "Products / plans"], ["custom-fields", "Custom fields"], ["joining-offer-types", "Joining offers"],
  ["asf-rates", "ASF rates"], ["tax-rates", "Tax rates (GST)"], ["deduction-matrix", "Night-deduction matrix"], ["cancellation-tiers", "Cancellation tiers"],
  ["payment-types", "Payment types"], ["payment-methods", "Payment methods"], ["currencies", "Currencies"], ["document-types", "Document types"],
  ["venues", "Venues"], ["lead-sources", "Lead sources"], ["destinations", "Destinations"], ["properties", "Properties"], ["reasons", "Reasons"],
  ["holidays", "Holiday calendar"], ["settings", "Business-rule settings"], ["letter-templates", "Letter templates"],
] as const;
const HIDDEN = new Set(["id", "version", "created_at", "updated_at", "created_by", "updated_by", "next_membership_seq"]);

/** Effective-dated row that applies today. */
function isCurrent(r: Record<string, unknown>) {
  if (!("effective_from" in r)) return false;
  const today = todayIso();
  return String(r.effective_from) <= today && (!r.effective_to || String(r.effective_to) >= today);
}

function MasterEditor({ slug, label }: { slug: string; label: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const rows = useQuery({ queryKey: ["master", slug, true], queryFn: () => api.get<Record<string, unknown>[]>(`/admin/master/${slug}`, { include_inactive: true }) });
  const cols = useMemo(() => Object.keys(rows.data?.[0] ?? {}).filter((c) => !HIDDEN.has(c)), [rows.data]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("{\n  \n}");
  const [override, setOverride] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => api.post<{ _warnings: string[] }>(`/admin/master/${slug}`, JSON.parse(draft), override ? { headers: { "X-Override-Reason": override } } : undefined),
    onSuccess: (r) => { setWarn(r._warnings ?? []); qc.invalidateQueries({ queryKey: ["master", slug] }); toast.success("Entry added"); if (!(r._warnings ?? []).length) setAdding(false); },
  });
  const toggle = useMutation({
    mutationFn: (r: Record<string, unknown>) => api.patch(`/admin/master/${slug}/${r.id}`, { is_active: !r.is_active }, { headers: { "If-Match": String(r.version) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["master", slug] }),
  });
  const dated = cols.includes("effective_from");
  const cell = (v: unknown) => (typeof v === "object" && v !== null ? JSON.stringify(v) : v === null || v === undefined ? "" : String(v));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base text-fg-muted">
          {rows.data ? `${rows.data.length} ${rows.data.length === 1 ? "entry" : "entries"}` : "Loading…"}
          {dated && <span className="ml-2 inline-flex items-center gap-1 text-sm"><span aria-hidden className="size-2.5 rounded-sm bg-primary-subtle ring-1 ring-primary/30" />current rate highlighted</span>}
        </p>
        <Button onClick={() => { setWarn([]); setAdding(true); }}><Plus aria-hidden />Add entry</Button>
      </div>
      {slug === "asf-rates" && (
        <Alert kind="warning" title="ASF increases are capped by the agreement">
          Adding a rate above the cap needs an override reason, which is logged.
        </Alert>
      )}
      {!rows.data ? <div className="rounded-md border border-border bg-surface"><TableSkeleton rows={5} cols={5} /></div> : rows.data.length === 0 ? <Empty>No entries yet.</Empty> : (
        <Table caption={label} density="compact" stickyFirstColumn maxHeight>
          <THead><tr>{dated && <Th><span className="sr-only">Current</span></Th>}{cols.map((c) => <Th key={c}>{humanize(c.toUpperCase())}</Th>)}<Th><span className="sr-only">Actions</span></Th></tr></THead>
          <tbody>{rows.data.map((r) => {
            const current = dated && isCurrent(r);
            return (
              <Tr key={String(r.id)} tone={current ? "highlight" : r.is_active === false ? "muted" : undefined}>
                {dated && <Td>{current && <span className="rounded-full bg-primary px-2 py-px text-xs font-semibold text-fg-on-fill">Current</span>}</Td>}
                {cols.map((c) => (
                  <Td key={c} className="max-w-56 truncate" title={cell(r[c])}>
                    {c === "is_active" ? <StatusBadge status={r[c] ? "ACTIVE" : "INACTIVE"} size="sm" /> : <span className={cn(typeof r[c] === "object" && "font-mono text-xs")}>{cell(r[c])}</span>}
                  </Td>
                ))}
                <Td align="right">{"is_active" in r && (
                  <Button variant="ghost" size="sm" onClick={() => toggle.mutate(r)}>{r.is_active ? "Disable" : "Enable"}</Button>
                )}</Td>
              </Tr>
            );
          })}</tbody>
        </Table>
      )}
      <ErrorText error={toggle.error} />
      <Drawer
        open={adding}
        onClose={() => setAdding(false)}
        title={`Add to ${label}`}
        description="Rates are effective-dated: add a new row with a later effective_from rather than editing amounts. The previous row is closed automatically."
        footer={<><Button variant="outline" onClick={() => setAdding(false)}>Close</Button><Button onClick={() => create.mutate()} disabled={create.isPending}>Add</Button></>}
      >
        <div className="flex flex-col gap-4">
          {cols.length > 0 && <p className="flex items-start gap-2 text-sm text-fg-muted"><Info aria-hidden className="mt-0.5 size-4 shrink-0" />Fields: <span className="font-mono">{cols.join(", ")}</span></p>}
          <Field label="New entry (JSON)" htmlFor="mjson">
            <Textarea id="mjson" aria-label="New entry JSON" className="font-mono text-sm" rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
          </Field>
          {slug === "asf-rates" && <Field label="Override reason (only if the increase exceeds the agreement cap)" htmlFor="ovr"><Input id="ovr" value={override} onChange={(e) => setOverride(e.target.value)} /></Field>}
          {warn.map((w) => <Alert key={w} kind="warning">{w}</Alert>)}
          <ErrorText error={create.error} />
        </div>
      </Drawer>
    </div>
  );
}

type Role = { code: string; name: string; permissions: string[] };

function PermissionMatrix({ roles, perms }: { roles: Role[]; perms: { code: string; description: string }[] }) {
  const qc = useQueryClient();
  const setPerms = useMutation({
    mutationFn: ({ role, p }: { role: string; p: string[] }) => api.put(`/admin/roles/${role}/permissions`, { permissions: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }),
  });
  const groups = useMemo(() => {
    const g = new Map<string, { code: string; description: string }[]>();
    for (const p of perms) {
      const k = p.code.split(".")[0]!;
      g.set(k, [...(g.get(k) ?? []), p]);
    }
    return [...g.entries()];
  }, [perms]);
  return (
    <div className="flex flex-col gap-2">
      <Table caption="Role permissions" density="compact" stickyFirstColumn maxHeight>
        <THead>
          <tr>
            <Th>Permission</Th>
            {roles.map((r) => <Th key={r.code} align="center" className="min-w-20 whitespace-normal leading-tight">{r.name}</Th>)}
          </tr>
        </THead>
        <tbody>
          {groups.map(([module, list]) => (
            <FragmentGroup key={module} module={module} colSpan={roles.length + 1}>
              {list.map((p) => (
                <Tr key={p.code}>
                  <Td className="min-w-56"><span className="font-mono text-xs text-fg">{p.code}</span><span className="block text-xs text-fg-subtle">{p.description}</span></Td>
                  {roles.map((r) => {
                    const on = r.permissions.includes(p.code);
                    return (
                      <Td key={r.code} align="center">
                        <input
                          type="checkbox"
                          className="size-4 cursor-pointer accent-primary"
                          aria-label={`${p.code} for ${r.name}`}
                          checked={on}
                          disabled={setPerms.isPending}
                          onChange={(e) => setPerms.mutate({ role: r.code, p: e.target.checked ? [...r.permissions, p.code] : r.permissions.filter((x) => x !== p.code) })}
                        />
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </FragmentGroup>
          ))}
        </tbody>
      </Table>
      <ErrorText error={setPerms.error} />
    </div>
  );
}

function FragmentGroup({ module, colSpan, children }: { module: string; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-surface-sunken/70">
        <th scope="rowgroup" colSpan={colSpan} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-fg-muted">{humanize(module.toUpperCase())}</th>
      </tr>
      {children}
    </>
  );
}

function UsersRoles() {
  const qc = useQueryClient();
  const can = useCan();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<AdminUser[]>("/admin/users"), enabled: can("admin.users") });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api.get<Role[]>("/admin/roles"), enabled: can("admin.roles") });
  const perms = useQuery({ queryKey: ["perms"], queryFn: () => api.get<{ code: string; description: string }[]>("/admin/permissions"), enabled: can("admin.roles") });
  const [nu, setNu] = useState<{ username: string; full_name: string; roles: string[] }>({ username: "", full_name: "", roles: ["SALES"] });
  const [creating, setCreating] = useState(false);
  const [oneTime, setOneTime] = useState<OneTime | null>(null);
  const createUser = useMutation({
    // no password field: the system generates a temporary one, shown once below
    mutationFn: () => api.post<AdminUser & { temporary_password: string; temporary_password_expires_at: string }>("/admin/users", nu),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setCreating(false);
      setNu({ username: "", full_name: "", roles: ["SALES"] });
      setOneTime({ username: u.username, password: u.temporary_password, expiresAt: u.temporary_password_expires_at, context: "new" });
    },
  });
  return (
    <div className="flex flex-col gap-5">
      <PendingAdminResets onTemporary={setOneTime} />
      {can("admin.users") && (
        <Card title="Users" actions={<Button onClick={() => setCreating(true)}><UserPlus aria-hidden />New user</Button>}>
          {!users.data ? <TableSkeleton rows={4} cols={4} /> : (
            <Table caption="Users" density="compact">
              <THead><tr><Th>Username</Th><Th>Name</Th><Th>Status</Th><Th>Sign-in</Th><Th>Roles</Th><Th><span className="sr-only">Account actions</span></Th></tr></THead>
              <tbody>{users.data.map((u) => (
                <Tr key={u.id} tone={u.is_active ? undefined : "muted"}>
                  <Td><span className="font-mono">{u.username}</span></Td>
                  <Td>{u.full_name}</Td>
                  <Td><StatusBadge status={u.is_active ? "ACTIVE" : "INACTIVE"} size="sm" /></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <span className={cn("rounded-full px-2 py-px text-xs font-medium", u.totp_enabled ? "bg-success-subtle text-success" : "bg-surface-sunken text-fg-muted")}>{u.totp_enabled ? "2FA on" : u.must_enroll_totp ? "2FA set-up due" : "2FA off"}</span>
                      {u.must_change_password && <span className="rounded-full bg-warning-subtle px-2 py-px text-xs font-medium text-warning">Must change password</span>}
                      {u.locked && <span className="rounded-full bg-danger-subtle px-2 py-px text-xs font-medium text-danger">Locked</span>}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => <span key={r} className="rounded-full bg-surface-sunken px-2 py-px text-xs font-medium text-fg-muted">{roles.data?.find((x) => x.code === r)?.name ?? humanize(r)}</span>)}
                    </div>
                  </Td>
                  <Td align="right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {can("admin.roles") && <EditRolesAction user={u} />}
                      <UserRecoveryActions user={u} onTemporary={setOneTime} />
                    </div>
                  </Td>
                </Tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      )}
      {can("admin.users") && <TwoFactorPolicyCard />}
      {can("admin.roles") && (
        <Card title="Role permissions" description="Changes apply immediately to everyone with the role. FastAPI enforces every permission.">
          {roles.data && perms.data ? <PermissionMatrix roles={roles.data} perms={perms.data} /> : <TableSkeleton rows={6} cols={6} />}
        </Card>
      )}
      <Drawer
        open={creating}
        onClose={() => setCreating(false)}
        title="New user"
        footer={<><Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={() => createUser.mutate()} disabled={createUser.isPending || nu.roles.length === 0}>Create user</Button></>}
      >
        <div className="grid gap-4">
          <Field label="Username" htmlFor="nuu" required><Input id="nuu" className="font-mono" autoComplete="off" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} /></Field>
          <Field label="Full name" htmlFor="nuf" required><Input id="nuf" value={nu.full_name} onChange={(e) => setNu({ ...nu, full_name: e.target.value })} /></Field>
          {roles.data && <RoleChecklist roles={roles.data} value={nu.roles} onChange={(r) => setNu({ ...nu, roles: r })} hint="At least one role." />}
          <Alert kind="info">The system creates a temporary password and shows it to you once. The new user must change it at first sign-in; it expires after 24 hours.</Alert>
          <ErrorText error={createUser.error} />
        </div>
      </Drawer>
      <OneTimePasswordDialog value={oneTime} onClose={() => setOneTime(null)} />
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState("access");
  const [slug, setSlug] = useState<string>("asf-rates");
  const label = MASTER.find(([s]) => s === slug)?.[1] ?? slug;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Administration" description="Users, roles, master data and effective-dated rates." />
      <Tabs label="Administration sections" tabs={[{ id: "access", label: "Users & roles" }, { id: "master", label: "Master data & rates" }]} active={tab} onChange={setTab} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "access" ? <UsersRoles /> : (
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <nav aria-label="Master data tables" className="hidden lg:block">
              <ul className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-2">
                {MASTER.map(([s, l]) => (
                  <li key={s}>
                    <button type="button" onClick={() => setSlug(s)} aria-current={slug === s ? "true" : undefined}
                      className={cn("w-full rounded-md px-3 py-1.5 text-left text-base", slug === s ? "bg-primary-subtle font-medium text-primary" : "text-fg-muted hover:bg-surface-sunken hover:text-fg")}>
                      {l}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="flex min-w-0 flex-col gap-3">
              <Field label="Table" htmlFor="ms" className="max-w-sm lg:hidden"><Select id="ms" value={slug} onChange={(e) => setSlug(e.target.value)}>{MASTER.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</Select></Field>
              <h2 className="text-lg font-semibold">{label}</h2>
              <MasterEditor key={slug} slug={slug} label={label} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
