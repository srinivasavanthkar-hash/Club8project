"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { MasterEditor } from "@/components/admin/MasterData";
import { type AdminUser, type OneTime, OneTimePasswordDialog, PendingAdminResets, UserRecoveryActions } from "@/components/admin/AccountRecovery";
import { EditRolesAction, RoleChecklist, TwoFactorPolicyCard } from "@/components/admin/Roles";
import { PageHeader } from "@/components/crm/Display";
import { TableSkeleton } from "@/components/crm/States";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { Table, Td, Th, THead, Tr } from "@/components/crm/Table";
import { ErrorText, useCan } from "@/components/providers";
import { Alert, Button, Card, Drawer, Field, Input, Select, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

const MASTER = [
  ["companies", "Companies / brands"], ["resort-categories", "Resort categories"], ["seasons", "Seasons"], ["season-calendar", "Season calendar"],
  ["unit-types", "Unit types & occupancy"], ["products", "Products / plans"], ["custom-fields", "Custom fields"], ["joining-offer-types", "Joining offers"],
  ["asf-rates", "ASF rates"], ["tax-rates", "Tax rates (GST)"], ["deduction-matrix", "Night-deduction matrix"], ["cancellation-tiers", "Cancellation tiers"],
  ["payment-types", "Payment types"], ["payment-methods", "Payment methods"], ["currencies", "Currencies"], ["document-types", "Document types"],
  ["venues", "Venues"], ["lead-sources", "Lead sources"], ["destinations", "Destinations"], ["properties", "Properties"], ["reasons", "Reasons"],
  ["holidays", "Holiday calendar"], ["settings", "Business-rule settings"], ["letter-templates", "Letter templates"],
] as const;
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
