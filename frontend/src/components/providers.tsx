"use client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import * as React from "react";
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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
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

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const p = e.problem;
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <p className="font-medium">{p?.detail ?? e.message}</p>
      {p?.errors?.map((x, i) => (
        <p key={i}>• {x.loc.slice(1).join(".")}: {x.msg}</p>
      ))}
      {p?.blockers?.map((b, i) => <p key={i}>• {b}</p>)}
      {p?.matches?.map((m) => (
        <p key={m.ref}>• Possible duplicate {m.kind.toLowerCase()} {m.ref} (matched on {m.reasons.join(", ")})</p>
      ))}
    </div>
  );
}
