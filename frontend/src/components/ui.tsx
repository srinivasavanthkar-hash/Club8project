"use client";
/* Small shadcn/ui-style primitives (copied-component pattern), accessible by default. */
import * as React from "react";
import { cn } from "@/lib/utils";

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "ghost" | "destructive"; size?: "sm" | "md" }
>(({ className, variant = "default", size = "md", ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
      size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
      variant === "default" && "bg-primary text-primary-foreground hover:opacity-90",
      variant === "outline" && "border border-border bg-background hover:bg-muted",
      variant === "ghost" && "hover:bg-muted",
      variant === "destructive" && "bg-destructive text-destructive-foreground hover:opacity-90",
      className,
    )}
    {...props}
  />
));
Button.displayName = "Button";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground",
        "aria-[invalid=true]:border-destructive",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn("min-h-20 w-full rounded-md border border-border bg-background p-3 text-sm", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn("h-10 w-full rounded-md border border-border bg-background px-2 text-sm", className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Field({
  label, error, children, hint, htmlFor, className,
}: { label: string; error?: string; hint?: string; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-background p-4 shadow-sm", className)}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-900", CONFIRMED: "bg-green-100 text-green-900", PAID: "bg-green-100 text-green-900",
  CONVERTED: "bg-green-100 text-green-900", APPROVED: "bg-sky-100 text-sky-900", PENDING_APPROVAL: "bg-amber-100 text-amber-900",
  REQUESTED: "bg-amber-100 text-amber-900", RAISED: "bg-amber-100 text-amber-900", OVERDUE: "bg-red-100 text-red-900",
  DEFAULT_NOTICE: "bg-red-100 text-red-900", TERMINATED: "bg-red-200 text-red-950", DECLINED: "bg-zinc-200 text-zinc-900",
  CANCELLED: "bg-zinc-200 text-zinc-900", NOT_INTERESTED: "bg-zinc-200 text-zinc-900",
};
export function Badge({ children }: { children: string }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[children] ?? "bg-muted text-foreground")}>
      {children.replaceAll("_", " ")}
    </span>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "warning" | "info" | "success"; children: React.ReactNode }) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border p-3 text-sm",
        kind === "error" && "border-red-300 bg-red-50 text-red-900",
        kind === "warning" && "border-amber-300 bg-amber-50 text-amber-900",
        kind === "info" && "border-sky-300 bg-sky-50 text-sky-900",
        kind === "success" && "border-green-300 bg-green-50 text-green-900",
      )}
    >
      {children}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" aria-label="Member sections" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={active === t.id}
          aria-controls={`panel-${t.id}`}
          onClick={() => onChange(t.id)}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm",
            active === t.id ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title} open
      className="fixed inset-0 z-50 m-auto w-[min(640px,95vw)] rounded-lg border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}

export function KeyValue({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="text-sm">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
