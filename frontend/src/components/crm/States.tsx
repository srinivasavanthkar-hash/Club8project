"use client";
/* Loading (skeletons shaped like the content), error (plain language + retry) and risky-action confirmation. */
import { AlertOctagon, Eye, EyeOff, RefreshCw } from "lucide-react";
import * as React from "react";
import { Alert, Button, Dialog, Field, Input, Skeleton, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

export function PageSkeleton({ variant = "list" }: { variant?: "list" | "record" | "dashboard" }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-56" />
      {variant === "dashboard" && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      )}
      {variant === "record" && (
        <>
          <Skeleton className="h-28" />
          <div className="flex gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-8 w-24" />)}</div>
        </>
      )}
      <div className="rounded-lg border border-border bg-surface p-4">
        {Array.from({ length: variant === "list" ? 8 : 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border py-3 last:border-0">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-border px-3 py-3 last:border-0">
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className={cn("h-4", c === 0 ? "w-24" : "flex-1")} />)}
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message = "This could not be loaded.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <Alert
      kind="error"
      title={message}
      action={onRetry && <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw aria-hidden />Retry</Button>}
    >
      <p className="text-sm text-fg-muted">Check your connection and try again. If it keeps happening, contact support.</p>
    </Alert>
  );
}

/** Confirmation for risky actions: mandatory reason, danger-styled button named after the action, and optionally
 * a typed confirmation (e.g. the membership number before termination). */
export function ConfirmDialog({
  open, onClose, onConfirm, title, description, confirmLabel, reasonLabel = "Reason (required)", minReason = 5,
  typeToConfirm, pending, children, destructive = true,
}: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void; title: string; description?: React.ReactNode;
  confirmLabel: string; reasonLabel?: string | null; minReason?: number; typeToConfirm?: string; pending?: boolean;
  children?: React.ReactNode; destructive?: boolean;
}) {
  const [reason, setReason] = React.useState("");
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => { if (!open) { setReason(""); setTyped(""); } }, [open]);
  const reasonOk = reasonLabel === null || reason.trim().length >= minReason;
  const typedOk = !typeToConfirm || typed.trim() === typeToConfirm;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Keep as is</Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={!reasonOk || !typedOk || pending} onClick={() => onConfirm(reason.trim())}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {description && (
          <div className="flex gap-3 text-base text-fg-muted">
            {destructive && <AlertOctagon aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />}
            <div>{description}</div>
          </div>
        )}
        {children}
        {reasonLabel !== null && (
          <Field label={reasonLabel} htmlFor="confirm-reason" required hint={`At least ${minReason} characters. Recorded in the activity log.`}>
            <Textarea id="confirm-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {typeToConfirm && (
          <Field label={`Type ${typeToConfirm} to confirm`} htmlFor="confirm-typed" required>
            <Input id="confirm-typed" autoComplete="off" spellCheck={false} className="font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/** Masked sensitive value with a permission-gated Reveal. Revealing is confirmed ("This view will be logged"),
 * then the value hides itself again after 30 seconds. */
export function MaskedValue({
  masked, label, canReveal, onReveal,
}: { masked: string; label: string; canReveal: boolean; onReveal?: () => Promise<string> }) {
  const [value, setValue] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => setValue(null), 30_000);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-mono tracking-tight">{value ?? masked}</span>
      {canReveal && onReveal && (value ? (
        <button type="button" onClick={() => setValue(null)} aria-label={`Hide ${label}`} title="Hide"
          className="inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-sunken hover:text-fg touch:size-11">
          <EyeOff aria-hidden className="size-4" />
        </button>
      ) : (
        <button type="button" onClick={() => setAsking(true)} aria-label={`Reveal ${label}`} title="Reveal (logged)"
          className="inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-sunken hover:text-fg touch:size-11">
          <Eye aria-hidden className="size-4" />
        </button>
      ))}
      {value && <span className="text-xs text-fg-subtle">hides in 30 s</span>}
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        destructive={false}
        title={`Reveal ${label}?`}
        description="This view will be logged in the activity log with your name and the time."
        reasonLabel={null}
        confirmLabel="Reveal"
        pending={busy}
        onConfirm={async () => {
          setBusy(true);
          setErr(null);
          try {
            if (onReveal) setValue(await onReveal());
          } catch {
            setErr("Could not reveal");
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      />
    </span>
  );
}
