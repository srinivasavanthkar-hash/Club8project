"use client";
import { Check, ChevronDown, X } from "lucide-react";
import * as React from "react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string; description?: string };

/**
 * A searchable single-choice dropdown (ARIA combobox + listbox). Shows names, never IDs. Type to filter by the label
 * or description; Up/Down to move, Enter to choose, Escape to close. `noneLabel` adds an explicit "none" choice.
 */
export function SearchSelect({
  id, options, value, onChange, placeholder = "Search…", noneLabel, disabled, invalid, emptyText = "No matches",
}: {
  id: string;
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  noneLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = `${id}-list`;
  const wrap = React.useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  const all: SearchOption[] = React.useMemo(
    () => (noneLabel ? [{ value: "", label: noneLabel }, ...options] : options),
    [options, noneLabel],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((o) => `${o.label} ${o.description ?? ""}`.toLowerCase().includes(q)) : all;

  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (o: SearchOption) => { onChange(o.value); setQuery(""); setOpen(false); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); if (shown[active]) choose(shown[active]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  return (
    <div ref={wrap} className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${id}-opt-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={selected ? undefined : placeholder}
        value={open ? query : selected ? selected.label : value === "" && noneLabel ? noneLabel : ""}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => { setOpen(true); setActive(Math.max(0, shown.findIndex((o) => o.value === value))); }}
        onKeyDown={onKey}
        className="pr-14"
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-fg-subtle">
        <ChevronDown aria-hidden className="size-4" />
      </span>
      {value && noneLabel && !disabled && (
        <button type="button" aria-label="Clear selection" onClick={() => onChange("")}
          className="absolute inset-y-0 right-7 flex items-center text-fg-subtle hover:text-fg">
          <X aria-hidden className="size-4" />
        </button>
      )}
      {open && !disabled && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface-raised py-1 shadow-dialog">
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-fg-muted">{emptyText}</li>}
          {shown.map((o, i) => (
            <li
              key={o.value || "__none"}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-start gap-2 px-3 py-2 text-sm", i === active && "bg-primary-subtle")}
            >
              <Check aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-primary", o.value !== value && "invisible")} />
              <span className="min-w-0">
                <span className="block">{o.label}</span>
                {o.description && <span className="block text-xs text-fg-muted">{o.description}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
