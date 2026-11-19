"use client";
import { AlertTriangle, Download, Eye, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Drawer } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

/** How long the viewer waits for the document to appear before offering Download instead (slow or blocked viewer). */
export const SLOW_AFTER_MS = 12_000;

type State =
  | { s: "closed" }
  | { s: "fetching" } // asking the API for a signed link (permission check)
  | { s: "loading"; url: string; type: string } // the browser is loading the document
  | { s: "ready"; url: string; type: string }
  | { s: "slow"; url: string; type: string } // still not shown after SLOW_AFTER_MS
  | { s: "error"; message: string };

/**
 * Opens a short-lived signed URL (issued after a server-side permission check) in a preview drawer. The drawer opens
 * at once and always shows one of: a loading state, the document, or a clear error with Retry / Download. It never
 * shows an empty box.
 */
export function DocLink({ id, label, contentType }: { id: string; label: string; contentType?: string }) {
  const [state, setState] = useState<State>({ s: "closed" });
  const attempt = useRef(0);

  const open = async () => {
    const mine = ++attempt.current;
    setState({ s: "fetching" });
    try {
      const r = await api.get<{ url: string; content_type: string }>(`/documents/${id}/url`, { inline: true });
      if (attempt.current === mine) setState({ s: "loading", url: r.url, type: r.content_type || contentType || "application/pdf" });
    } catch (e) {
      if (attempt.current === mine) {
        setState({ s: "error", message: e instanceof ApiError ? e.problem.detail : "The document could not be opened. Check your connection and try again." });
      }
    }
  };
  const close = () => { attempt.current++; setState({ s: "closed" }); };
  const download = async () => {
    try {
      const r = await api.get<{ url: string }>(`/documents/${id}/url`, { inline: false });
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      setState({ s: "error", message: e instanceof ApiError ? e.problem.detail : "The document could not be downloaded." });
    }
  };

  // A document that never reports "loaded" (blocked or very slow viewer) gets a message instead of an empty box.
  useEffect(() => {
    if (state.s !== "loading") return;
    const t = window.setTimeout(() => setState((cur) => (cur.s === "loading" ? { s: "slow", url: cur.url, type: cur.type } : cur)), SLOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [state]);

  const shown = state.s === "loading" || state.s === "ready" || state.s === "slow" ? state : null;
  const loaded = () => setState((cur) => (cur.s === "loading" || cur.s === "slow" ? { s: "ready", url: cur.url, type: cur.type } : cur));

  return (
    <>
      <Button variant="ghost" size="sm" onClick={open}><Eye aria-hidden />{label}</Button>
      <Drawer
        open={state.s !== "closed"}
        onClose={close}
        title={label}
        footer={<Button variant="outline" onClick={download}><Download aria-hidden />Download</Button>}
      >
        <div className="relative h-full min-h-[70vh]" data-testid="doc-viewer" data-state={state.s}>
          {(state.s === "fetching" || state.s === "loading") && (
            <div role="status" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface text-sm text-fg-muted">
              <Loader2 aria-hidden className="size-7 animate-spin text-primary" />
              Opening {label.toLowerCase()}…
            </div>
          )}
          {state.s === "slow" && (
            <div className="absolute inset-x-0 top-0 z-10">
              <Alert kind="warning" title="This is taking longer than usual">
                The document may still appear. If it doesn&apos;t, download it instead.
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={open}><RotateCw aria-hidden />Try again</Button>
                  <Button size="sm" variant="outline" onClick={download}><Download aria-hidden />Download</Button>
                </div>
              </Alert>
            </div>
          )}
          {state.s === "error" && (
            <div role="alert" className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
              <AlertTriangle aria-hidden className="size-8 text-danger" />
              <p className="max-w-md font-medium">{state.message}</p>
              <Button variant="outline" onClick={open}><RotateCw aria-hidden />Try again</Button>
            </div>
          )}
          {shown && (shown.type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown.url} alt={label} onLoad={loaded} onError={() => setState({ s: "error", message: "The image could not be shown. Try again, or download it." })}
              className="mx-auto max-h-full w-full rounded-md object-contain" />
          ) : (
            <iframe key={shown.url} src={shown.url} title={label} onLoad={loaded}
              className="h-full min-h-[70vh] w-full rounded-md border border-border bg-surface" data-testid="doc-preview" />
          ))}
        </div>
      </Drawer>
    </>
  );
}
