"use client";
import { useCallback, useEffect, useState } from "react";

/** List filters + paging + sort, with named saved searches kept per browser (convenience only). */
export function useListState<F extends Record<string, unknown>>(key: string, initial: F) {
  const [filters, setFilters] = useState<F>(initial);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | undefined>();
  const [saved, setSaved] = useState<Record<string, F>>({});

  useEffect(() => {
    try {
      setSaved(JSON.parse(localStorage.getItem(`saved:${key}`) ?? "{}"));
    } catch {
      /* storage unavailable */
    }
    // deep links from elsewhere in the UI (dashboard tiles, duplicate-match warnings): ?status=ACTIVE&q=...
    const sp = new URLSearchParams(window.location.search);
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(initial)) {
      const v = sp.get(k);
      if (v !== null) patch[k] = typeof initial[k] === "boolean" ? v === "1" || v === "true" : v;
    }
    if (Object.keys(patch).length) setFilters((f) => ({ ...f, ...patch }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((patch: Partial<F>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }, []);

  const saveAs = useCallback(
    (name: string) => {
      const next = { ...saved, [name]: filters };
      setSaved(next);
      try {
        localStorage.setItem(`saved:${key}`, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [filters, key, saved],
  );

  return { filters, update, page, setPage, sort, setSort, saved, saveAs, apply: (f: F) => { setFilters(f); setPage(1); } };
}
