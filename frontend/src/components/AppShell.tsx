"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCan, useMe } from "@/components/providers";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; perm?: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads", perm: "lead.view" },
  { href: "/members", label: "Members", perm: "member.view" },
  { href: "/reservations", label: "Reservations", perm: "reservation.view" },
  { href: "/finance", label: "Finance", perm: "finance.view" },
  { href: "/activity", label: "Activity log", perm: "auditlog.view" },
  { href: "/exports", label: "Exports", perm: "export.run" },
  { href: "/admin", label: "Admin", perm: "admin.masterdata" },
];

type SearchResult = {
  members: { id: string; membership_number: string; names: string[]; status: string }[];
  leads: { id: string; lead_number: string; name: string; status: string }[];
};

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<SearchResult>("/search", { q: debounced }),
    enabled: debounced.length >= 2,
  });
  const go = (href: string) => {
    setQ("");
    router.push(href);
  };
  return (
    <div className="relative w-full max-w-md">
      <label htmlFor="global-search" className="sr-only">Search members and leads</label>
      <input
        id="global-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Membership no., lead ID, name, mobile, email"
        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        autoComplete="off"
      />
      {debounced.length >= 2 && data && (
        <ul role="listbox" className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg">
          {data.members.map((m) => (
            <li key={m.id} role="option" aria-selected={false}>
              <button className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => go(`/members/${m.id}`)}>
                <span className="font-medium">{m.membership_number}</span> · {m.names.join(" & ")} · {m.status}
              </button>
            </li>
          ))}
          {data.leads.map((l) => (
            <li key={l.id} role="option" aria-selected={false}>
              <button className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => go(`/leads/${l.id}`)}>
                <span className="font-medium">{l.lead_number}</span> · {l.name} · {l.status}
              </button>
            </li>
          ))}
          {data.members.length + data.leads.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>}
        </ul>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: me } = useMe();
  const can = useCan();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const logout = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    qc.clear();
    router.replace("/login");
  };
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">Skip to content</a>
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <button className="md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
        <Link href="/" className="font-semibold text-primary">Club8 CRM</Link>
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden sm:inline">{me?.full_name}</span>
          <button onClick={logout} className="underline">Sign out</button>
        </div>
      </header>
      <div className="flex">
        <nav aria-label="Main" className={cn("w-52 shrink-0 border-r border-border p-3 md:block", open ? "block" : "hidden")}>
          <ul className="flex flex-col gap-1">
            {items.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn("block rounded-md px-3 py-2 text-sm", active ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main id="main" className="min-w-0 flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
