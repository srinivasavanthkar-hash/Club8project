"use client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ToastProvider } from "@/components/crm/Toast";
import { Alert, Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { MasterRow, Me } from "@/lib/types";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/auth/me"), staleTime: 60_000 });
}

/** UI convenience only - FastAPI enforces every permission. */
export function useCan() {
  const { data } = useMe();
  return React.useCallback((perm: string) => !!data?.permissions.includes(perm), [data]);
}

export function useMaster(slug: string, includeInactive = false) {
  return useQuery({
    queryKey: ["master", slug, includeInactive],
    queryFn: () => api.get<MasterRow[]>(`/admin/master/${slug}`, { include_inactive: includeInactive }),
    staleTime: 5 * 60_000,
  });
}

export function useStaff() {
  return useQuery({
    queryKey: ["staff"],
    queryFn: () => api.get<{ id: string; username: string; full_name: string; roles: string[] }[]>("/admin/staff"),
    staleTime: 5 * 60_000,
  });
}

/** Plain-language API error. 409 version conflicts get a reload action; duplicates list the matches with links.
 * Never shows stack traces: only the RFC 7807 detail, field errors and business-rule blockers. */
export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const p = e.problem;
  if (e instanceof ApiError && e.status === 409 && p?.code !== "ProbableDuplicate" && !p?.blockers?.length) {
    return (
      <Alert
        kind="error"
        title="Someone else updated this record"
        action={<Button size="sm" variant="outline" onClick={() => window.location.reload()}><RefreshCw aria-hidden />Reload</Button>}
      >
        <p>Reload to see their changes, then make your edit again.</p>
      </Alert>
    );
  }
  return (
    <Alert kind="error" title={p?.detail ?? (e instanceof ApiError ? e.message : "Something went wrong. Please try again.")}>
      {(p?.errors?.length || p?.blockers?.length || p?.matches?.length) ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {p?.errors?.map((x, i) => <li key={i}>{x.loc.slice(1).join(".")}: {x.msg}</li>)}
          {p?.blockers?.map((b, i) => <li key={i}>{b}</li>)}
          {p?.matches?.map((m) => (
            <li key={m.ref}>
              Possible duplicate {m.kind.toLowerCase()}{" "}
              <Link className="font-medium text-primary underline" href={`/${m.kind.toLowerCase().startsWith("lead") ? "leads" : "members"}?q=${encodeURIComponent(m.ref)}`}>{m.ref}</Link>{" "}
              (matched on {m.reasons.join(", ")})
            </li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}
