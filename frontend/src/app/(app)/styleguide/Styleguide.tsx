"use client";
/* Living style guide: every token and component in its states. FICTITIOUS data only. */
import { CalendarDays, MoonStar, Receipt, Wallet } from "lucide-react";
import { BrandIcon, BrandLogo } from "@/components/crm/BrandMark";
import { useState } from "react";
import { CategoryChip, Chip, CopyButton, Money, Mono, PageHeader, Progress, SeasonChip, StatTile } from "@/components/crm/Display";
import { ConfirmDialog, ErrorState, MaskedValue, TableSkeleton } from "@/components/crm/States";
import { StatusStepper } from "@/components/crm/Stepper";
import { STATUS_TONES, StatusBadge } from "@/components/crm/StatusBadge";
import { Table, Td, Th, THead, Tr } from "@/components/crm/Table";
import { Timeline } from "@/components/crm/Timeline";
import { useToast } from "@/components/crm/Toast";
import { ChangeList } from "@/components/member/HistoryTab";
import { useMe } from "@/components/providers";
import { Alert, AutoTag, Button, Card, Checkbox, Empty, Field, Input, Kbd, PrefixInput, Select, Skeleton, Tabs, Textarea } from "@/components/ui";
import { BRANDS, type BrandId, DEFAULT_BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/DateField";

/* Brand palettes as documented in docs/DESIGN_SYSTEM.md (hex values shown as text for reference only). */
const BRAND_SWATCHES: Record<BrandId, { token: string; cls: string; fg?: string; hex: string; ratio: string }[]> = {
  club8: [
    { token: "--brand-primary (--c8-indigo)", cls: "bg-primary", fg: "text-fg-on-fill", hex: "#393186", ratio: "10.73:1" }, // design-tokens-allow: documentation
    { token: "--brand-primary-hover", cls: "bg-primary-hover", fg: "text-fg-on-fill", hex: "#2C2667", ratio: "13.29:1 (white on)" }, // design-tokens-allow: documentation
    { token: "--brand-primary-subtle", cls: "bg-primary-subtle", hex: "#EEEDF8", ratio: "9.25:1 (primary on)" }, // design-tokens-allow: documentation
    { token: "--brand-accent (--c8-orange)", cls: "bg-accent", hex: "#EF7F1B", ratio: "2.72:1: never text" }, // design-tokens-allow: documentation
    { token: "--brand-accent-text", cls: "bg-accent-text", fg: "text-fg-on-fill", hex: "#B35F14", ratio: "4.60:1 on white" }, // design-tokens-allow: documentation
    { token: "--brand-secondary (--c8-blue)", cls: "bg-secondary", fg: "text-fg-on-fill", hex: "#1E5AA8", ratio: "6.81:1" }, // design-tokens-allow: documentation
  ],
  k8: [
    { token: "--brand-primary (--k8-navy)", cls: "bg-primary", fg: "text-fg-on-fill", hex: "#172040", ratio: "15.94:1" }, // design-tokens-allow: documentation
    { token: "--brand-primary-hover", cls: "bg-primary-hover", fg: "text-fg-on-fill", hex: "#0D1328", ratio: "18.41:1 (white on)" }, // design-tokens-allow: documentation
    { token: "--brand-primary-subtle", cls: "bg-primary-subtle", hex: "#E9EBF2", ratio: "13.39:1 (primary on)" }, // design-tokens-allow: documentation
    { token: "--brand-accent (--k8-gold)", cls: "bg-accent", hex: "#BC9C23", ratio: "2.65:1: never text" }, // design-tokens-allow: documentation
    { token: "--brand-accent-text", cls: "bg-accent-text", fg: "text-fg-on-fill", hex: "#8B7319", ratio: "4.60:1 on white" }, // design-tokens-allow: documentation
    { token: "--brand-secondary (navy tint)", cls: "bg-secondary", fg: "text-fg-on-fill", hex: "#4A5677", ratio: "7.27:1" }, // design-tokens-allow: documentation
  ],
};

const SWATCHES: { name: string; cls: string; fg?: string }[] = [
  { name: "--bg", cls: "bg-bg" }, { name: "--surface", cls: "bg-surface" },
  { name: "--surface-sunken", cls: "bg-surface-sunken" }, { name: "--border", cls: "bg-border" }, { name: "--border-strong", cls: "bg-border-strong" },
  { name: "--text", cls: "bg-fg", fg: "text-fg-on-fill" }, { name: "--text-muted", cls: "bg-fg-muted", fg: "text-fg-on-fill" }, { name: "--text-subtle", cls: "bg-fg-subtle", fg: "text-fg-on-fill" },
  { name: "--success", cls: "bg-success", fg: "text-fg-on-fill" }, { name: "--success-subtle", cls: "bg-success-subtle" },
  { name: "--warning", cls: "bg-warning", fg: "text-fg-on-fill" }, { name: "--warning-subtle", cls: "bg-warning-subtle" }, { name: "--warning-strong", cls: "bg-warning-strong" },
  { name: "--danger", cls: "bg-danger", fg: "text-fg-on-fill" }, { name: "--danger-subtle", cls: "bg-danger-subtle" },
  { name: "--info", cls: "bg-info", fg: "text-fg-on-fill" }, { name: "--info-subtle", cls: "bg-info-subtle" },
  { name: "--season-red-bg", cls: "bg-season-red-bg" }, { name: "--season-blue-bg", cls: "bg-season-blue-bg" },
];
const TYPE: [string, string][] = [["text-3xl", "30 · login brand moment"], ["text-2xl", "24 · page title"], ["text-xl", "20 · page title (mobile), key figure"], ["text-lg", "18 · dialog title"], ["text-md", "16 · card title"], ["text-base", "14 · body (default)"], ["text-sm", "13 · labels, dense tables"], ["text-xs", "12 · badges, hints"]];
const GROUPS: [string, string[]][] = [
  ["Lead", ["NEW", "CONTACTED", "PRESENTATION_SCHEDULED", "ATTENDED", "CONVERTED", "NOT_INTERESTED"]],
  ["Membership", ["PENDING_APPROVAL", "ACTIVE", "DEFAULT_NOTICE", "SUSPENDED", "TERMINATED", "EXPIRED"]],
  ["Reservation", ["REQUESTED", "APPROVED", "CONFIRMED", "DECLINED", "CANCELLED", "RESCHEDULED"]],
  ["Instalment / payment", ["PAID", "PART_PAID", "PENDING", "OVERDUE", "NORMAL", "REVERSAL", "ADJUSTMENT"]],
  ["ASF per year", ["NOT_YET_DUE", "RAISED", "PAID"]],
  ["Other", ["OPEN", "CURED", "CLEAN", "INFECTED", "HELD", "INACTIVE"]],
];

/** Date field demo: Field passes its aria attributes through to the input. */
function StyleguideDate(props: { "aria-describedby"?: string; "aria-invalid"?: boolean; "aria-required"?: boolean }) {
  const [v, setV] = useState("");
  return <DateField id="sg-6" value={v} onChange={setV} {...props} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card title={title}><div className="flex flex-col gap-4">{children}</div></Card>;
}

export function Styleguide({ production }: { production: boolean }) {
  const me = useMe();
  const toast = useToast();
  const [tab, setTab] = useState("one");
  const [confirm, setConfirm] = useState(false);
  if (production && !me.data?.roles.includes("ADMIN")) {
    return <Empty>The style guide is available to administrators only.</Empty>;
  }
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Style guide" description="Design tokens and components (docs/DESIGN_SYSTEM.md). All data on this page is fictitious." />

      <Section title="Brand">
        <p className="text-base text-fg-muted">
          The app shell uses one theme, the deployment default (<Mono>NEXT_PUBLIC_DEFAULT_BRAND</Mono>, now <strong className="text-fg">{DEFAULT_BRAND.name}</strong>).
          Records show their own brand as a chip; documents use the record&apos;s company branding.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {(Object.keys(BRANDS) as BrandId[]).map((id) => {
            const b = BRANDS[id];
            return (
              <div key={id} data-brand={id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{b.name}</p>
                  <span className="text-xs text-fg-subtle">Full logo ≥ 120px wide · icon ≥ 16px</span>
                </div>
                {/* clear space = height of the "8", shown as the padded white area */}
                <div className="flex justify-center rounded-md border border-dashed border-primary-border bg-surface p-8">
                  <BrandLogo brand={b} width={200} />
                </div>
                <div className="flex items-end gap-3">
                  {[16, 32, 48, 64].map((s) => <BrandIcon key={s} brand={b} size={s} />)}
                  <span className="text-xs text-fg-subtle">Provisional icons</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm">Primary</Button>
                  <span className="relative inline-flex h-8 items-center rounded-md bg-primary-subtle pl-4 pr-3 text-sm font-semibold text-primary">
                    <span aria-hidden className="absolute inset-y-1.5 left-0 w-bar rounded-r-full bg-accent" />Active nav
                  </span>
                  <span className="inline-flex h-8 items-center text-sm font-medium text-accent-text">Accent text</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {BRAND_SWATCHES[id].map((s) => (
                    <div key={s.token} className="overflow-hidden rounded-md border border-border">
                      <div className={cn("flex h-12 items-end justify-between p-2 text-xs font-medium", s.cls, s.fg ?? "text-fg")}><span>Aa</span><span className="font-mono">{s.hex}</span></div>
                      <p className="bg-surface px-2 py-1 font-mono text-xs leading-tight text-fg-muted">{s.token}<br /><span className="text-fg-subtle">{s.ratio}</span></p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Alert kind="success" title="Do">
            <ul className="list-disc pl-4">
              <li>Place logos on white or very light backgrounds only.</li>
              <li>Keep clear space equal to the height of the &quot;8&quot; on all sides.</li>
              <li>Scale proportionally; full logo ≥ 120px wide, icon ≥ 16px.</li>
              <li>Use the brand chip to show which brand a record belongs to.</li>
            </ul>
          </Alert>
          <Alert kind="error" title="Don't">
            <ul className="list-disc pl-4">
              <li>Recolour, outline, shadow, stretch, crop or rotate the logos.</li>
              <li>Place logos on dark, coloured or busy backgrounds.</li>
              <li>Recreate the logos as text or SVG, or use the Club8 gradient elsewhere.</li>
              <li>Use orange or gold for body text or links, or show both brands as the theme on one screen.</li>
            </ul>
          </Alert>
        </div>
      </Section>

      <Section title="Colour tokens">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {SWATCHES.map((s) => (
            <div key={s.name} className="overflow-hidden rounded-md border border-border">
              <div className={cn("flex h-14 items-end p-2 text-xs font-medium", s.cls, s.fg ?? "text-fg")}>Aa</div>
              <p className="bg-surface px-2 py-1 font-mono text-xs text-fg-muted">{s.name}</p>
            </div>
          ))}
        </div>
        <Alert kind="warning" title="Accent colours are never text on white">Club8 orange (2.72:1) and K8 gold (2.65:1) fail WCAG AA. Use them for thin indicators and fills; use --brand-accent-text when accent-coloured text is genuinely needed.</Alert>
      </Section>

      <Section title="Typography (Inter; JetBrains Mono for IDs)">
        <div className="flex flex-col gap-2">
          {TYPE.map(([cls, use]) => <p key={cls} className={cn(cls, "text-fg")}>{use} <span className="font-mono text-xs text-fg-subtle">{cls}</span></p>)}
        </div>
        <p className="text-base">Tabular figures: <Money value="255000.00" /> · <Money value="-15000.00" /> · <Money value="1234567.5" currency="USD" /> · <Mono>MSMC8-9001</Mono> · <Mono>RC8-2026-000003</Mono></p>
      </Section>

      <Section title="Status badges (every status uses <StatusBadge>)">
        {GROUPS.map(([g, list]) => (
          <div key={g} className="flex flex-wrap items-center gap-2">
            <span className="w-40 text-sm font-medium text-fg-muted">{g}</span>
            {list.map((s) => <StatusBadge key={s} status={s} />)}
          </div>
        ))}
        <p className="text-xs text-fg-subtle">{Object.keys(STATUS_TONES).length} statuses mapped. Unknown codes fall back to neutral.</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-40 text-sm font-medium text-fg-muted">Seasons</span><SeasonChip code="RED" /><SeasonChip code="WHITE" /><SeasonChip code="BLUE" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-40 text-sm font-medium text-fg-muted">Resort categories</span><CategoryChip code="CLASSIC" /><CategoryChip code="PREMIUM" /><CategoryChip code="SUPREME" /><Chip>T0 · Studio</Chip>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button><Button variant="outline">Secondary</Button><Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Terminate membership</Button><Button variant="destructive-outline">Issue default notice</Button>
          <Button variant="link">Link</Button><Button disabled>Disabled</Button><Button size="sm">Small</Button>
        </div>
        <p className="flex items-center gap-1 text-sm text-fg-muted">Shortcuts: <Kbd>Ctrl</Kbd><Kbd>K</Kbd> search · <Kbd>/</Kbd> list filter · <Kbd>Ctrl</Kbd><Kbd>S</Kbd> save · <Kbd>Esc</Kbd> close</p>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Prospect name" htmlFor="sg-1" required hint="Help text sits below the input."><Input id="sg-1" placeholder="Kiran Demo" /></Field>
          <Field label="Mobile" htmlFor="sg-2" required error="Enter a 10-digit Indian mobile or +<country code><number>"><Input id="sg-2" defaultValue="12345" /></Field>
          <Field label="Purchase Price" htmlFor="sg-3" hint="= ₹2,50,000.00"><PrefixInput prefix="₹" id="sg-3" className="text-right" defaultValue="250000" /></Field>
          <Field label="Balance" htmlFor="sg-4" tag={<AutoTag explain="Total purchase price − down payment" />}><Input id="sg-4" readOnly value="₹2,00,000.00" className="text-right font-semibold" /></Field>
          <Field label="Season" htmlFor="sg-5"><Select id="sg-5"><option>Red (RED)</option><option>White (WHITE)</option></Select></Field>
          <Field label="Check-in" htmlFor="sg-6"><StyleguideDate /></Field>
          <Field label="Note" htmlFor="sg-7" className="sm:col-span-2"><Textarea id="sg-7" rows={2} /></Field>
          <div className="flex items-end"><Checkbox label="WhatsApp same as mobile" defaultChecked /></div>
        </div>
        <p className="text-sm">Masked value: <MaskedValue masked="XXXX XXXX 1660" label="demo PAN number" canReveal onReveal={async () => "ABCDE1660F"} /></p>
      </Section>

      <Section title="Feedback">
        <Alert kind="info">Info: entitlement is created when the member is approved.</Alert>
        <Alert kind="success">All checks passed. The member can be approved.</Alert>
        <Alert kind="warning" title="Outside the booking window">Give an override reason to continue.</Alert>
        <Alert kind="error" title="ASF unpaid for 2026">Confirmation is blocked until it is paid.</Alert>
        <ErrorState onRetry={() => undefined} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => toast.success("Payment recorded", "The receipt PDF has been generated.")}>Show success toast</Button>
          <Button variant="outline" onClick={() => toast.error("Could not save", { retry: () => undefined })}>Show error toast</Button>
          <Button variant="destructive-outline" onClick={() => setConfirm(true)}>Open risky-action dialog</Button>
        </div>
        <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Terminate membership?" description="Payments made are forfeited (no refund)."
          reasonLabel="Termination reason" typeToConfirm="MSMC8-9001" confirmLabel="Terminate membership" onConfirm={() => setConfirm(false)} />
      </Section>

      <Section title="Stat tiles, progress and member facts">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile label="Nights left in 2026" value="3.0" sub="of 7.0 available" icon={<MoonStar />} />
          <StatTile label="Outstanding balance" value={<Money value="180000.00" />} sub="Paying by EMI" icon={<Wallet />} />
          <StatTile label="Next check-in" value="28-10-2026" sub="R-2026-000001 · in 12 days" icon={<CalendarDays />} />
          <StatTile label="ASF 2026" value={<StatusBadge status="RAISED" />} tone="warning" sub="Raised, unpaid" icon={<Receipt />} />
        </div>
        <Progress value={20000} max={200000} label="EMI amount paid (example)" />
        <p className="flex items-center gap-1 text-sm">Copy: <Mono>MSMC8-9001</Mono><CopyButton value="MSMC8-9001" label="Copy membership number" /></p>
      </Section>

      <Section title="Tabs, stepper and timeline">
        <Tabs label="Example tabs" tabs={[{ id: "one", label: "Profile" }, { id: "two", label: "Reservations", count: 3 }, { id: "three", label: "History" }]} active={tab} onChange={setTab} />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="text-sm text-fg-muted">Panel for the selected tab.</div>
        <StatusStepper label="Example lead status" path={["NEW", "CONTACTED", "PRESENTATION_SCHEDULED", "ATTENDED", "CONVERTED"]} current="CONTACTED" />
        <Timeline items={[
          { key: "1", type: "payment", at: "2026-10-16T06:34:00Z", actor: "demo.finance", title: "EMI 1 paid · ₹20,000.00" },
          { key: "2", type: "email", at: "2026-10-15T09:10:00Z", actor: "demo.service", title: "Early check-in request", detail: "Could we check in early? (demo)" },
          { key: "3", type: "status", at: "2026-10-14T04:00:00Z", actor: "demo.manager", title: "Pending approval → Active" },
        ]} />
      </Section>

      <Section title="Tables and audit diff">
        <Table caption="Example EMI schedule">
          <THead><tr><Th align="right">#</Th><Th>Due</Th><Th align="right">Amount</Th><Th>Status</Th></tr></THead>
          <tbody>
            <Tr><Td align="right">1</Td><Td>01-09-2026</Td><Td align="right"><Money value="20000.00" /></Td><Td><StatusBadge status="PAID" /></Td></Tr>
            <Tr tone="danger"><Td align="right">2</Td><Td>01-10-2026</Td><Td align="right"><Money value="20000.00" /></Td><Td><StatusBadge status="OVERDUE" /></Td></Tr>
            <Tr><Td align="right">3</Td><Td>01-11-2026</Td><Td align="right"><Money value="-500.00" /></Td><Td><StatusBadge status="PENDING" /></Td></Tr>
          </tbody>
        </Table>
        <ChangeList changes={{ comments: [null, "Prefers sea-facing rooms"], relationship_manager_id: ["7b1e…", "9c2f…"] }} />
      </Section>

      <Section title="Empty and loading states (demo)">
        <Empty action={<Button variant="outline" size="sm">New reservation</Button>}>No reservations yet.</Empty>
        <div className="flex gap-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-8 flex-1" /></div>
        <div data-demo className="rounded-md border border-border"><TableSkeleton rows={3} cols={4} /></div>
      </Section>
    </div>
  );
}
