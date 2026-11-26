"use client";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck, ChevronsLeft, ChevronsRight, Download, IdCard, KeyRound, LayoutDashboard, LogOut, Menu, ScrollText, Settings,
  ShieldCheck, UserPlus, Wallet, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { BrandIcon, BrandLogo } from "@/components/crm/BrandMark";
import { GlobalSearch } from "@/components/crm/GlobalSearch";
import { UiSettingsProvider } from "@/components/DateField";
import { useCan, useMe } from "@/components/providers";
import { Kbd } from "@/components/ui";
import { api } from "@/lib/api";
import { DEFAULT_BRAND } from "@/lib/brand";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; perm?: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    group: "Sales",
    items: [
      { href: "/leads", label: "Leads", perm: "lead.view", icon: UserPlus },
      { href: "/members", label: "Members", perm: "member.view", icon: IdCard },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/reservations", label: "Reservations", perm: "reservation.view", icon: CalendarCheck },
      { href: "/finance", label: "Finance", perm: "finance.view", icon: Wallet },
    ],
  },
  {
    group: "Control",
    items: [
      { href: "/activity", label: "Activity log", perm: "auditlog.view", icon: ScrollText },
      { href: "/exports", label: "Exports", perm: "export.run", icon: Download },
      { href: "/admin", label: "Admin", perm: "admin.masterdata", icon: Settings },
    ],
  },
];

/** Default brand's full logo (expanded) or icon (collapsed), on the white sidebar. Files used as supplied. */
function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex flex-col items-center gap-1 rounded-md" aria-label={`${DEFAULT_BRAND.appName} home`}>
      {compact ? (
        <BrandIcon size={32} />
      ) : (
        <>
          {/* 120px is the brand's minimum full-logo width (docs/DESIGN_SYSTEM.md "Brand") */}
          <BrandLogo width={120} priority />
          <span className="text-xs font-semibold uppercase tracking-widest text-fg-muted">CRM</span>
        </>
      )}
    </Link>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const can = useCan();
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV.map((g) => {
        const items = g.items.filter((n) => !n.perm || can(n.perm));
        if (!items.length) return null;
        return (
          <div key={g.group}>
            <p className={cn("mb-1 px-3 text-xs font-medium uppercase tracking-wider text-fg-subtle", collapsed && "sr-only")}>{g.group}</p>
            <ul className="flex flex-col gap-0.5">
              {items.map((n) => {
                const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
                const Icon = n.icon;
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? n.label : undefined}
                      className={cn(
                        "relative flex h-9 items-center gap-3 rounded-md px-3 text-base transition-colors touch:h-11",
                        collapsed && "justify-center px-0",
                        active ? "bg-primary-subtle font-semibold text-primary" : "text-fg-muted hover:bg-surface-sunken hover:text-fg",
                      )}
                    >
                      {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-bar rounded-r-full bg-accent" />}
                      <Icon aria-hidden className="size-5 shrink-0" />
                      <span className={cn(collapsed && "sr-only")}>{n.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function EnvRibbon({ env }: { env: string }) {
  const label = env === "staging" ? "STAGING" : env === "dev" || env === "local" || env === "test" ? "DEV" : null;
  if (!label) return null;
  return (
    <span
      title={`${label} environment: data here is not production data`}
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-sm px-2 text-xs font-bold uppercase tracking-wider",
        label === "STAGING" ? "bg-warning-strong text-warning" : "bg-accent text-fg",
      )}
    >
      {label}
    </span>
  );
}

function UserMenu() {
  const { data: me } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const logout = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    qc.clear();
    router.replace("/login");
  };
  const initials = (me?.full_name ?? "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`User menu for ${me?.full_name ?? "current user"}`}
        onClick={() => setOpen(!open)}
        className="flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-surface-sunken touch:h-11"
      >
        <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary">{initials}</span>
        <span className="hidden max-w-40 truncate text-base text-fg lg:inline">{me?.full_name}</span>
      </button>
      {open && (
        <div role="menu" aria-label="User" className="absolute right-0 z-40 mt-1 w-64 animate-fade-in rounded-lg border border-border bg-surface-raised p-1 shadow-popover">
          <div className="px-3 py-2">
            <p className="font-medium text-fg">{me?.full_name}</p>
            <p className="text-sm text-fg-subtle">{me?.username}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {me?.roles.map((r) => <span key={r} className="rounded-full bg-surface-sunken px-2 py-px text-xs text-fg-muted">{humanize(r)}</span>)}
            </div>
          </div>
          <div className="my-1 border-t border-border" />
          <Link role="menuitem" href="/change-password" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-base text-fg hover:bg-surface-sunken">
            <KeyRound aria-hidden className="size-4 text-fg-subtle" />Change password
          </Link>
          {me && !me.totp_enabled && (
            <Link role="menuitem" href="/setup-2fa" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-base text-fg hover:bg-surface-sunken">
              <ShieldCheck aria-hidden className="size-4 text-fg-subtle" />Set up two-step verification
            </Link>
          )}
          <div className="my-1 border-t border-border" />
          <button role="menuitem" type="button" onClick={logout} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-base text-fg hover:bg-surface-sunken">
            <LogOut aria-hidden className="size-4 text-fg-subtle" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Mobile navigation drawer on a native modal <dialog>: focus trap, Esc closes, focus returns to the menu button. */
function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Navigation"
      className="m-0 h-dvh max-h-dvh w-72 max-w-drawer animate-slide-in-left border-r border-border bg-surface p-0 text-fg backdrop:bg-fg/40"
    >
      <div className="flex items-start justify-between border-b border-border px-4 py-3">
        <Wordmark />
        <button type="button" aria-label="Close navigation" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-md text-fg-muted hover:bg-surface-sunken">
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <div className="p-3"><NavList onNavigate={onClose} /></div>
    </dialog>
  );
}

export function AppShell({ children, env = "" }: { children: React.ReactNode; env?: string }) {
  const [drawer, setDrawer] = React.useState(false);
  const { data: me } = useMe();
  const router = useRouter();
  // Forced account steps come first (the API refuses everything else anyway).
  React.useEffect(() => {
    if (me?.must_change_password) router.replace("/change-password");
    else if (me?.must_enroll_totp) router.replace("/setup-2fa");
  }, [me?.must_change_password, me?.must_enroll_totp, router]);
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try { setCollapsed(localStorage.getItem("ui:sidebar") === "collapsed"); } catch { /* storage unavailable */ }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("ui:sidebar", c ? "open" : "collapsed"); } catch { /* ignore */ }
      return !c;
    });
  };
  // "/" focuses the current list's filter (outside text fields).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || t.closest("input, textarea, select, [contenteditable=true]")) return;
      const filter = document.querySelector<HTMLElement>("[data-list-filter]");
      if (filter) { e.preventDefault(); filter.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-fg-on-fill focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface transition-[width] md:flex",
          collapsed ? "w-16" : "w-sidebar",
        )}
      >
        <div className={cn("flex shrink-0 items-center justify-center border-b border-border", collapsed ? "h-topbar" : "px-4 py-4")}>
          <Wordmark compact={collapsed} />
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto p-3"><NavList collapsed={collapsed} /></div>
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn("flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-fg-subtle hover:bg-surface-sunken hover:text-fg", collapsed && "justify-center px-0")}
          >
            {collapsed ? <ChevronsRight aria-hidden className="size-4" /> : <><ChevronsLeft aria-hidden className="size-4" />Collapse</>}
          </button>
        </div>
      </aside>
      <MobileDrawer open={drawer} onClose={() => setDrawer(false)} />
      <div className={cn("flex min-h-screen flex-col transition-[padding]", collapsed ? "md:pl-16" : "md:pl-sidebar")}>
        <header data-shell className="sticky top-0 z-20 flex h-topbar items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur sm:gap-3 sm:px-6">
          <button
            type="button"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-sunken md:hidden"
            aria-label="Open navigation"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <Link href="/" aria-label={`${DEFAULT_BRAND.appName} home`} className="shrink-0 rounded-md md:hidden">
            <BrandIcon size={28} />
          </Link>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <EnvRibbon env={env} />
            <span className="hidden items-center gap-1 text-xs text-fg-subtle xl:flex"><Kbd>/</Kbd> filter</span>
            <UserMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-page flex-1 px-4 py-5 outline-none sm:px-6 sm:py-6">
          <UiSettingsProvider>{children}</UiSettingsProvider>
        </main>
      </div>
    </div>
  );
}
