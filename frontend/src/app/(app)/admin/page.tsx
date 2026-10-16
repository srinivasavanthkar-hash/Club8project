"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ErrorText, useCan } from "@/components/providers";
import { Alert, Button, Card, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { api } from "@/lib/api";

const MASTER = [
  ["companies", "Companies / brands"], ["resort-categories", "Resort categories"], ["seasons", "Seasons"], ["season-calendar", "Season calendar"],
  ["unit-types", "Unit types & occupancy"], ["products", "Products / plans"], ["custom-fields", "Custom fields"], ["joining-offer-types", "Joining offers"],
  ["asf-rates", "ASF rates"], ["tax-rates", "Tax rates (GST)"], ["deduction-matrix", "Night-deduction matrix"], ["cancellation-tiers", "Cancellation tiers"],
  ["payment-types", "Payment types"], ["payment-methods", "Payment methods"], ["currencies", "Currencies"], ["document-types", "Document types"],
  ["venues", "Venues"], ["lead-sources", "Lead sources"], ["destinations", "Destinations"], ["properties", "Properties"], ["reasons", "Reasons"],
  ["holidays", "Holiday calendar"], ["settings", "Business-rule settings"], ["letter-templates", "Letter templates"],
] as const;
const HIDDEN = new Set(["id", "version", "created_at", "updated_at", "created_by", "updated_by", "next_membership_seq"]);

function MasterEditor({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["master", slug, true], queryFn: () => api.get<Record<string, unknown>[]>(`/admin/master/${slug}`, { include_inactive: true }) });
  const cols = useMemo(() => Object.keys(rows.data?.[0] ?? {}).filter((c) => !HIDDEN.has(c)), [rows.data]);
  const [draft, setDraft] = useState("{\n  \n}");
  const [override, setOverride] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => api.post<{ _warnings: string[] }>(`/admin/master/${slug}`, JSON.parse(draft), override ? { headers: { "X-Override-Reason": override } } : undefined),
    onSuccess: (r) => { setWarn(r._warnings ?? []); qc.invalidateQueries({ queryKey: ["master", slug] }); },
  });
  const toggle = useMutation({
    mutationFn: (r: Record<string, unknown>) => api.patch(`/admin/master/${slug}/${r.id}`, { is_active: !r.is_active }, { headers: { "If-Match": String(r.version) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["master", slug] }),
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted"><tr>{cols.map((c) => <th key={c} className="px-2 py-1 text-left">{c}</th>)}<th /></tr></thead>
          <tbody>{rows.data?.map((r) => (
            <tr key={String(r.id)} className="border-t border-border">
              {cols.map((c) => <td key={c} className="max-w-56 truncate px-2 py-1" title={JSON.stringify(r[c])}>{typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c] ?? "")}</td>)}
              <td className="px-2">{"is_active" in r && <button className="underline" onClick={() => toggle.mutate(r)}>{r.is_active ? "Disable" : "Enable"}</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <Card title="Add entry (JSON)">
        <p className="mb-2 text-xs text-muted-foreground">Rates are effective-dated: add a new row with a later effective_from rather than editing amounts. The previous row is closed automatically.</p>
        <Textarea aria-label="New entry JSON" className="font-mono" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
        {slug === "asf-rates" && <Field label="Override reason (only if the increase exceeds the agreement cap)" htmlFor="ovr"><Input id="ovr" value={override} onChange={(e) => setOverride(e.target.value)} /></Field>}
        <Button className="mt-2" onClick={() => create.mutate()}>Add</Button>
        {warn.map((w) => <Alert key={w} kind="warning">{w}</Alert>)}
        <ErrorText error={create.error ?? toggle.error} />
      </Card>
    </div>
  );
}

function UsersRoles() {
  const qc = useQueryClient();
  const can = useCan();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ id: string; username: string; full_name: string; is_active: boolean; roles: string[] }[]>("/admin/users"), enabled: can("admin.users") });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api.get<{ code: string; name: string; permissions: string[] }[]>("/admin/roles"), enabled: can("admin.roles") });
  const perms = useQuery({ queryKey: ["perms"], queryFn: () => api.get<{ code: string; description: string }[]>("/admin/permissions"), enabled: can("admin.roles") });
  const [nu, setNu] = useState({ username: "", full_name: "", password: "", roles: "SALES" });
  const createUser = useMutation({ mutationFn: () => api.post("/admin/users", { ...nu, roles: nu.roles.split(",").map((s) => s.trim()) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });
  const [role, setRole] = useState("MARKETING");
  const current = roles.data?.find((r) => r.code === role);
  const setPerms = useMutation({ mutationFn: (p: string[]) => api.put(`/admin/roles/${role}/permissions`, { permissions: p }), onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }) });
  const setRoles = useMutation({ mutationFn: ({ id, r }: { id: string; r: string[] }) => api.put(`/admin/users/${id}/roles`, { roles: r }), onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {can("admin.users") && (
        <Card title="Users">
          <ul className="mb-3 text-sm">{users.data?.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 border-t border-border py-1">
              <span className="font-medium">{u.username}</span> {u.full_name} {!u.is_active && "(inactive)"}
              <Input aria-label={`Roles for ${u.username}`} className="h-8 max-w-72" defaultValue={u.roles.join(", ")}
                onBlur={(e) => e.target.value !== u.roles.join(", ") && setRoles.mutate({ id: u.id, r: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </li>
          ))}</ul>
          <div className="grid gap-2 md:grid-cols-2">
            <Field label="Username" htmlFor="nuu"><Input id="nuu" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} /></Field>
            <Field label="Full name" htmlFor="nuf"><Input id="nuf" value={nu.full_name} onChange={(e) => setNu({ ...nu, full_name: e.target.value })} /></Field>
            <Field label="Initial password (12+ chars, mixed case, digit)" htmlFor="nup"><Input id="nup" type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></Field>
            <Field label="Roles (comma separated)" htmlFor="nur"><Input id="nur" value={nu.roles} onChange={(e) => setNu({ ...nu, roles: e.target.value })} /></Field>
          </div>
          <Button className="mt-2" onClick={() => createUser.mutate()}>Create user</Button>
          <ErrorText error={createUser.error ?? setRoles.error} />
        </Card>
      )}
      {can("admin.roles") && (
        <Card title="Role permissions">
          <Field label="Role" htmlFor="rl"><Select id="rl" value={role} onChange={(e) => setRole(e.target.value)}>{roles.data?.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</Select></Field>
          <div className="mt-2 grid max-h-96 grid-cols-1 gap-1 overflow-y-auto text-sm md:grid-cols-2">
            {perms.data?.map((p) => (
              <label key={p.code} className="flex items-center gap-2">
                <input type="checkbox" checked={!!current?.permissions.includes(p.code)}
                  onChange={(e) => current && setPerms.mutate(e.target.checked ? [...current.permissions, p.code] : current.permissions.filter((x) => x !== p.code))} />
                <span title={p.description}>{p.code}</span>
              </label>
            ))}
          </div>
          <ErrorText error={setPerms.error} />
        </Card>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState("access");
  const [slug, setSlug] = useState<string>("asf-rates");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Administration</h1>
      <Tabs tabs={[{ id: "access", label: "Users & roles" }, { id: "master", label: "Master data & rates" }]} active={tab} onChange={setTab} />
      {tab === "access" ? <UsersRoles /> : (
        <>
          <Field label="Table" htmlFor="ms" className="max-w-sm"><Select id="ms" value={slug} onChange={(e) => setSlug(e.target.value)}>{MASTER.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</Select></Field>
          <MasterEditor slug={slug} />
        </>
      )}
    </div>
  );
}
