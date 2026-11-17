"use client";
/* Global search in the top bar (ARIA combobox). Ctrl/⌘+K focuses it from anywhere; arrows move, Enter opens,
 * Esc closes. Results are grouped; recent searches (this tab only, kept in memory, never in browser storage
 * because they can contain names) show when the field is empty. */
import { useQuery } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Mono } from "@/components/crm/Display";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { Kbd } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type SearchResult = {
  members: { id: string; membership_number: string; names: string[]; status: string }[];
  leads: { id: string; lead_number: string; name: string; status: string }[];
};
type Option = { key: string; href: string; ref: string; name: string; status?: string; group: string };

const recent: string[] = [];

export function GlobalSearch() {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [isMac, setIsMac] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const router = useRouter();
  const listId = "global-search-results";

  React.useEffect(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<SearchResult>("/search", { q: debounced }),
    enabled: debounced.length >= 2,
  });

  const options: Option[] = React.useMemo(() => {
    if (debounced.length < 2 || !data) return [];
    return [
      ...data.members.map((m) => ({ key: `m-${m.id}`, href: `/members/${m.id}`, ref: m.membership_number, name: m.names.join(" & "), status: m.status, group: "Members" })),
      ...data.leads.map((l) => ({ key: `l-${l.id}`, href: `/leads/${l.id}`, ref: l.lead_number, name: l.name, status: l.status, group: "Leads" })),
    ];
  }, [data, debounced]);
  const recentOptions: Option[] = q.trim() === "" ? recent.map((r) => ({ key: `r-${r}`, href: "", ref: r, name: "", group: "Recent searches" })) : [];
  const shown = options.length ? options : recentOptions;
  React.useEffect(() => setActive(0), [debounced, q === ""]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (o: Option) => {
    if (!o.href) {
      setQ(o.ref);
      input.current?.focus();
      return;
    }
    const term = q.trim();
    if (term) {
      const i = recent.indexOf(term);
      if (i >= 0) recent.splice(i, 1);
      recent.unshift(term);
      recent.length = Math.min(recent.length, 5);
    }
    setQ("");
    setOpen(false);
    input.current?.blur();
    router.push(o.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && shown[active]) { e.preventDefault(); go(shown[active]!); }
    else if (e.key === "Escape") { setOpen(false); if (!q) input.current?.blur(); else setQ(""); }
  };

  const showList = open && (shown.length > 0 || (debounced.length >= 2 && !!data));
  let lastGroup = "";
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xl">
      <label htmlFor="global-search" className="sr-only">Search members and leads</label>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
      <input
        ref={input}
        id="global-search"
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && shown[active] ? `gs-${shown[active]!.key}` : undefined}
        aria-keyshortcuts="Control+K Meta+K"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder="Search membership no., lead ID, name, mobile"
        className="h-9 w-full rounded-md border border-border bg-surface-sunken pl-9 pr-16 text-base text-fg placeholder:text-fg-subtle hover:border-border-strong/60 focus:bg-surface touch:h-11 [&::-webkit-search-cancel-button]:hidden"
        autoComplete="off"
      />
      <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 gap-0.5 sm:flex">
        <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd><Kbd>K</Kbd>
      </span>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute z-40 mt-1.5 max-h-[70vh] w-full min-w-72 overflow-y-auto rounded-lg border border-border bg-surface-raised p-1 shadow-popover"
        >
          {shown.map((o, i) => {
            const header = o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <React.Fragment key={o.key}>
                {header && <li role="presentation" className="px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">{header}</li>}
                <li
                  id={`gs-${o.key}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); go(o); }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-base touch:min-h-11", i === active && "bg-primary-subtle")}
                >
                  {o.href ? (
                    <>
                      <Mono className="shrink-0 text-sm font-medium text-primary">{o.ref}</Mono>
                      <span className="min-w-0 flex-1 truncate text-fg">{o.name}</span>
                      {o.status && <StatusBadge status={o.status} size="sm" />}
                    </>
                  ) : (
                    <><History aria-hidden className="size-4 text-fg-subtle" /><span className="text-fg-muted">{o.ref}</span></>
                  )}
                </li>
              </React.Fragment>
            );
          })}
          {debounced.length >= 2 && data && options.length === 0 && (
            <li role="presentation" className="px-3 py-3 text-base text-fg-muted">{isFetching ? "Searching…" : `No members or leads match “${debounced}”.`}</li>
          )}
        </ul>
      )}
    </div>
  );
}
