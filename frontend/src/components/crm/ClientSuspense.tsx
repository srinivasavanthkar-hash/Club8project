"use client";
import * as React from "react";

const noop = () => () => {};

/** False on the server and during hydration, true afterwards (useSyncExternalStore picks the server snapshot while
 * hydrating, so the first browser render matches the HTML the server sent). */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(noop, () => true, () => false);
}

/**
 * Suspense for pages that read the URL (useSearchParams) and the signed-in user's data. Next.js streams such a
 * boundary's content from the server, where the user's permissions and lists (staff, master data) are not known,
 * and the browser hydrates it a moment later, when that data may already have arrived: buttons shown only to some
 * permissions or filled dropdowns then differ from the server's HTML (React error #418). Here the server and the
 * hydrating browser both render the fallback, and the real content renders right after hydration.
 */
export function ClientSuspense({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  const hydrated = useHydrated();
  return <React.Suspense fallback={fallback}>{hydrated ? children : fallback}</React.Suspense>;
}
