"use client";
/* Primitives (shadcn/ui copied-component pattern) restyled through design tokens only. Accessible by default.
 * App-level, domain-aware components live in components/crm/. Usage rules: docs/DESIGN_SYSTEM.md. */
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import * as React from "react";
import { BrandIcon } from "@/components/crm/BrandMark";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "outline" | "ghost" | "destructive" | "destructive-outline" | "link";
type ButtonSize = "sm" | "md" | "icon";

export function buttonClasses({ variant = "default", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    size === "sm" && "h-8 px-3 text-sm touch:min-h-11",
    size === "md" && "h-9 px-4 text-base touch:min-h-11",
    size === "icon" && "size-9 touch:size-11",
    variant === "default" && "bg-primary text-fg-on-fill hover:bg-primary-hover",
    variant === "outline" && "border border-border-strong/60 bg-surface text-fg hover:bg-surface-sunken",
    variant === "ghost" && "text-fg-muted hover:bg-surface-sunken hover:text-fg",
    variant === "destructive" && "bg-danger text-fg-on-fill hover:bg-danger/90",
    variant === "destructive-outline" && "border border-danger/40 bg-surface text-danger hover:bg-danger-subtle",
    variant === "link" && "h-auto px-0 text-primary underline-offset-2 hover:underline touch:min-h-0",
    className,
  );
}

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(({ className, variant = "default", size = "md", type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={buttonClasses({ variant, size, className })} {...props} />
));
Button.displayName = "Button";

const control =
  "w-full rounded-md border border-border-strong bg-surface px-3 text-base text-fg transition-colors " +
  "placeholder:text-fg-subtle hover:border-fg-muted disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-muted " +
  "[&[readonly]]:bg-surface-sunken [&[readonly]]:text-fg-muted " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-subtle/40";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        control,
        "h-9 touch:h-11",
        type === "file" && "h-auto py-1.5 text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-surface-sunken file:px-3 file:py-1 file:text-sm file:font-medium file:text-fg",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

/** Input with a fixed prefix such as "₹" or "+91". */
export const PrefixInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { prefix: string }>(
  ({ prefix, className, ...props }, ref) => (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-center text-fg-subtle">{prefix}</span>
      <Input ref={ref} className={cn("pl-8 tabular-nums", className)} {...props} />
    </div>
  ),
);
PrefixInput.displayName = "PrefixInput";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(control, "min-h-20 py-2", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(control, "select-chevron h-9 appearance-none pr-8 touch:h-11", className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex min-h-9 cursor-pointer items-center gap-2 text-base text-fg touch:min-h-11", className)}>
      <input type="checkbox" className="size-4 shrink-0 cursor-pointer rounded-sm accent-primary" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Label above input, required marker, help text below, inline error. The single child control gets
 * aria-describedby / aria-invalid / aria-required wired automatically. The required marker and the
 * `tag` are aria-hidden so accessible names stay exactly the label text. */
export function Field({
  label, error, children, hint, htmlFor, className, required, tag,
}: {
  label: string; error?: string; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode; className?: string;
  required?: boolean; tag?: React.ReactNode;
}) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const errId = htmlFor ? `${htmlFor}-error` : undefined;
  const described = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const child = React.Children.only(children);
  const enhanced = React.isValidElement<Record<string, unknown>>(child) && htmlFor
    ? React.cloneElement(child, {
        "aria-describedby": described,
        ...(error ? { "aria-invalid": true } : {}),
        ...(required ? { "aria-required": true } : {}),
      })
    : child;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} data-field={htmlFor}>
      <div className="flex items-center gap-2">
        <span className="flex items-baseline">
          <label htmlFor={htmlFor} className="text-sm font-medium text-fg">{label}</label>
          {required && <span aria-hidden className="ml-0.5 text-sm font-medium text-danger">*</span>}
        </span>
        {tag}
      </div>
      {enhanced}
      {hint && !error && <p id={hintId} className="text-xs text-fg-subtle">{hint}</p>}
      {error && (
        <p id={errId} className="flex items-start gap-1 text-xs font-medium text-danger">
          <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Small "auto" tag for calculated read-only fields; the explanation is in the title tooltip and the hint. */
export function AutoTag({ explain }: { explain: string }) {
  return (
    <span aria-hidden title={explain} className="rounded-sm bg-primary-subtle px-1.5 text-xs font-medium uppercase tracking-wide text-primary">
      auto
    </span>
  );
}

export function Card({
  title, actions, children, className, description, padding = "md", id, as: As = "section",
}: {
  title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string;
  description?: React.ReactNode; padding?: "none" | "md"; id?: string; as?: "section" | "div";
}) {
  return (
    <As id={id} className={cn("min-w-0 rounded-lg border border-border bg-surface", padding === "md" && "p-4 sm:p-5", className)}>
      {(title || actions) && (
        <header className={cn("mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2", padding === "none" && "mb-0 border-b border-border px-4 py-3 sm:px-5")}>
          <div className="min-w-0">
            {title && <h2 className="text-md font-semibold leading-6 text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </As>
  );
}

const ALERT_ICON = { error: XCircle, warning: AlertTriangle, info: Info, success: CheckCircle2 } as const;

export function Alert({
  kind = "error", children, title, className, action,
}: { kind?: "error" | "warning" | "info" | "success"; children?: React.ReactNode; title?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const Icon = ALERT_ICON[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-md border px-3 py-2.5 text-base",
        kind === "error" && "border-danger/30 bg-danger-subtle text-fg",
        kind === "warning" && "border-warning/30 bg-warning-subtle text-fg",
        kind === "info" && "border-info/25 bg-info-subtle text-fg",
        kind === "success" && "border-success/25 bg-success-subtle text-fg",
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          kind === "error" && "text-danger", kind === "warning" && "text-warning",
          kind === "info" && "text-info", kind === "success" && "text-success",
        )}
      />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export type TabItem = { id: string; label: string; count?: number | null };

/** WAI-ARIA tabs with roving focus (arrow keys, Home/End). The caller renders the tabpanel. */
export function Tabs({ tabs, active, onChange, label = "Sections", className }: { tabs: TabItem[]; active: string; onChange: (id: string) => void; label?: string; className?: string }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(tabs[next]!.id);
  };
  return (
    <div role="tablist" aria-label={label} className={cn("scrollbar-thin flex gap-1 overflow-x-auto border-b border-border", className)}>
      {tabs.map((t, i) => {
        const selected = active === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "relative -mb-px inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-base transition-colors touch:h-11",
              selected ? "border-primary font-semibold text-primary" : "border-transparent text-fg-muted hover:border-border-strong/50 hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span className={cn("rounded-full px-1.5 text-xs font-medium tabular-nums", selected ? "bg-primary-subtle text-primary" : "bg-surface-sunken text-fg-muted")}>
                <span className="sr-only">(</span>{t.count}<span className="sr-only">)</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Modal dialog on the native <dialog>: focus is trapped while open, Esc closes, focus returns to the opener. */
export function Dialog({
  open, onClose, title, description, children, footer, size = "md",
}: {
  open: boolean; onClose: () => void; title: string; description?: React.ReactNode; children: React.ReactNode;
  footer?: React.ReactNode; size?: "sm" | "md" | "lg";
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const opener = React.useRef<Element | null>(null);
  const titleId = React.useId();
  React.useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    opener.current = document.activeElement;
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    return () => {
      if (d.open && typeof d.close === "function") d.close();
      const o = opener.current as HTMLElement | null;
      if (o && typeof o.focus === "function" && document.contains(o)) o.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      aria-labelledby={titleId}
      className={cn(
        "fixed inset-0 z-50 m-auto max-h-[90vh] w-[94vw] animate-fade-in flex-col overflow-hidden rounded-lg border border-border bg-surface-raised p-0 text-fg shadow-dialog open:flex",
        size === "sm" && "max-w-md", size === "md" && "max-w-2xl", size === "lg" && "max-w-4xl",
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          {description && <div className="mt-1 text-sm text-fg-muted">{description}</div>}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1"><X aria-hidden /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-surface-sunken/60 px-5 py-3">{footer}</div>}
    </dialog>
  );
}

/** Side drawer (right) on the native modal <dialog>; same focus behaviour as Dialog. */
export function Drawer({ open, onClose, title, children, footer, description }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; description?: React.ReactNode }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  React.useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    return () => {
      if (d.open && typeof d.close === "function") d.close();
      if (opener && document.contains(opener)) opener.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={titleId}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-3xl animate-slide-in-right flex-col border-l border-border bg-surface-raised p-0 text-fg shadow-dialog open:flex"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-lg font-semibold">{title}</h2>
          {description && <div className="mt-0.5 text-sm text-fg-muted">{description}</div>}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1"><X aria-hidden /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-surface-sunken/60 px-5 py-3">{footer}</div>}
    </dialog>
  );
}

export function KeyValue({ items, columns = 3 }: { items: [string, React.ReactNode][]; columns?: 2 | 3 | 4 }) {
  return (
    <dl className={cn(
      "grid grid-cols-2 gap-x-4 gap-y-3 sm:gap-x-6",
      columns === 3 && "lg:grid-cols-3", columns === 4 && "lg:grid-cols-4",
    )}>
      {items.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs font-medium text-fg-subtle">{k}</dt>
          <dd className="break-words text-base text-fg">{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Friendly empty state: one line of explanation and, where there is one, the primary action. */
export function Empty({ children, action, icon, className }: { children: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-md px-4 py-8 text-center", className)}>
      {icon ? <div aria-hidden className="text-fg-subtle [&_svg]:size-6">{icon}</div> : <BrandIcon size={28} decorative className="opacity-40" />}
      <p className="text-base text-fg-muted">{children}</p>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-shimmer rounded-md bg-surface-sunken", className)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-sm border border-border bg-surface-sunken px-1.5 font-sans text-xs font-medium text-fg-muted">{children}</kbd>;
}

export function Separator({ className }: { className?: string }) {
  return <hr className={cn("border-border", className)} />;
}
