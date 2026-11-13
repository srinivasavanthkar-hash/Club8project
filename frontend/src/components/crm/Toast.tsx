"use client";
/* Toasts: success auto-dismisses after 5 s; errors stay until dismissed and can offer a retry. Announced via aria-live. */
import { CheckCircle2, X, XCircle } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

type Toast = { id: number; kind: "success" | "error"; title: string; description?: string; retry?: () => void };
type Ctx = { success: (title: string, description?: string) => void; error: (title: string, opts?: { description?: string; retry?: () => void }) => void };

const ToastContext = React.createContext<Ctx>({ success: () => undefined, error: () => undefined });
export const useToast = () => React.useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const seq = React.useRef(0);
  const dismiss = React.useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    if (t.kind === "success") setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);
  const ctx = React.useMemo<Ctx>(() => ({
    success: (title, description) => push({ kind: "success", title, description }),
    error: (title, opts) => push({ kind: "error", title, ...opts }),
  }), [push]);
  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full animate-toast-in gap-3 rounded-lg border bg-surface-raised p-3 shadow-popover",
              t.kind === "success" ? "border-success/30" : "border-danger/40",
            )}
          >
            {t.kind === "success"
              ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              : <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />}
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-fg">{t.title}</p>
              {t.description && <p className="mt-0.5 text-sm text-fg-muted">{t.description}</p>}
              {t.retry && (
                <button type="button" className="mt-1 text-sm font-medium text-primary hover:underline" onClick={() => { dismiss(t.id); t.retry?.(); }}>
                  Retry
                </button>
              )}
            </div>
            <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="-m-1 inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-sunken hover:text-fg">
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
