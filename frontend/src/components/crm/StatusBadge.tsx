/* The single source of status colour. Never colour a status ad hoc in a screen: add it here.
 * Text stays the status code with spaces (e.g. "PENDING APPROVAL"), set in small caps-style uppercase, so the
 * label always carries the meaning and colour is never the only signal. Critical states also get an icon. */
import { AlertOctagon, AlertTriangle, Ban, Clock, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "info" | "neutral" | "primary" | "warning" | "warning-subtle" | "success" | "danger" | "danger-subtle" | "muted" | "outline";

export const TONE_CLASSES: Record<BadgeTone, string> = {
  info: "bg-info-subtle text-info ring-info/25",
  neutral: "bg-surface-sunken text-fg-muted ring-border-strong/30",
  primary: "bg-primary-subtle text-primary ring-primary/20",
  warning: "bg-warning-strong text-warning ring-warning/30",
  "warning-subtle": "bg-warning-subtle text-warning ring-warning/20",
  success: "bg-success-subtle text-success ring-success/25",
  danger: "bg-danger text-fg-on-fill ring-danger",
  "danger-subtle": "bg-danger-subtle text-danger ring-danger/25",
  muted: "bg-surface text-fg-subtle ring-border-strong/40",
  outline: "bg-surface text-fg-muted ring-border-strong/60",
};

type Def = { tone: BadgeTone; icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> };

/** Status code -> tone. Keys are unique across domains where the meaning is the same (PAID, PENDING...). */
export const STATUS_TONES: Record<string, Def> = {
  // Leads
  NEW: { tone: "info" },
  CONTACTED: { tone: "neutral" },
  PRESENTATION_SCHEDULED: { tone: "primary" },
  ATTENDED: { tone: "warning-subtle" },
  CONVERTED: { tone: "success" },
  NOT_INTERESTED: { tone: "muted" },
  // Membership
  PENDING_APPROVAL: { tone: "warning", icon: Clock },
  ACTIVE: { tone: "success" },
  DEFAULT_NOTICE: { tone: "danger-subtle", icon: AlertTriangle },
  SUSPENDED: { tone: "warning", icon: Ban },
  TERMINATED: { tone: "danger", icon: AlertOctagon },
  EXPIRED: { tone: "muted" },
  // Reservations
  REQUESTED: { tone: "info" },
  APPROVED: { tone: "primary" },
  CONFIRMED: { tone: "success" },
  DECLINED: { tone: "danger-subtle" },
  CANCELLED: { tone: "muted" },
  RESCHEDULED: { tone: "warning-subtle" },
  // Instalments / payments
  PAID: { tone: "success" },
  PART_PAID: { tone: "warning" },
  PENDING: { tone: "neutral" },
  OVERDUE: { tone: "danger", icon: AlertTriangle },
  // ASF per year
  NOT_YET_DUE: { tone: "outline" },
  RAISED: { tone: "warning" },
  // Default notices
  OPEN: { tone: "danger-subtle", icon: AlertTriangle },
  CURED: { tone: "success" },
  // Documents (virus scan)
  CLEAN: { tone: "success" },
  INFECTED: { tone: "danger", icon: ShieldAlert },
  // Entitlement deduction state
  HELD: { tone: "warning-subtle" },
  DEDUCTED: { tone: "primary" },
  CREDITED: { tone: "success" },
  // Generic on/off (users, master data rows)
  INACTIVE: { tone: "muted" },
  // Payment entry kinds
  NORMAL: { tone: "neutral" },
  REVERSAL: { tone: "danger-subtle" },
  ADJUSTMENT: { tone: "warning-subtle" },
};

export function StatusBadge({ status, className, size = "md" }: { status: string; className?: string; size?: "sm" | "md" }) {
  const def = STATUS_TONES[status] ?? { tone: "neutral" as const };
  const Icon = def.icon;
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold uppercase tracking-wide ring-1 ring-inset",
        size === "md" ? "h-5 px-2 text-xs" : "px-1.5 py-px text-xs",
        TONE_CLASSES[def.tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3 shrink-0" />}
      {status.replaceAll("_", " ")}
    </span>
  );
}
