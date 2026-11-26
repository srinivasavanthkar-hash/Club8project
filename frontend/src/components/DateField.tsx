"use client";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { type Control, Controller, type FieldValues, type Path, type RegisterOptions } from "react-hook-form";
import { Button, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import {
  addDays, addMonths, autoDash, autoDashMonth, clampIso, isoOf, isoToDisplay, longLabel, MONTHS, monthGrid,
  monthToDisplay, parseDisplay, parseMonthDisplay, parseTime, splitIso, timeToDisplay, weekdayNames, type WeekStart,
} from "@/lib/dates";
import { todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Date fields that always show and accept DD-MM-YYYY (MM-YYYY for months), whatever the browser's language: native
 * date inputs follow the browser, and many office PCs run English (United States), which shows month-first dates.
 * Values in and out are ISO (YYYY-MM-DD / YYYY-MM). Something that is not a whole, valid date is reported next to the
 * field and passed on as "" (no date), never as a guess.
 */

const WeekStartContext = React.createContext<WeekStart>("MONDAY");

/** First day of the week from Admin (setting ui.week_start). Signed-in pages only. */
export function UiSettingsProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: ["ui-settings"],
    queryFn: () => api.get<{ week_start: WeekStart }>("/ui-settings"),
    staleTime: 30 * 60_000,
  });
  return <WeekStartContext.Provider value={data?.week_start === "SUNDAY" ? "SUNDAY" : "MONDAY"}>{children}</WeekStartContext.Provider>;
}

type Common = {
  id: string;
  /** Ignored by the field itself (labels come from Field); kept so callers can pass a name for forms. */
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  onBlur?: () => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean;
  title?: string;
};

function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [ref, open, close]);
}

/**
 * Text state that follows `value` when it changes from outside (a reset, a default) but never while the person is
 * typing: only a change of `value` that is not our own echo replaces the text. (A parent may map our "" back to a
 * default, as the cancellation date does; the value then does not change and the half-typed text stays.)
 */
function useSyncedText(value: string, toText: (v: string) => string) {
  const [text, setText] = React.useState(() => toText(value));
  const emitted = React.useRef(value);
  const prev = React.useRef(value);
  React.useEffect(() => {
    if (value === prev.current) return;
    prev.current = value;
    if (value !== emitted.current) setText(toText(value));
    emitted.current = value;
  }, [value, toText]);
  return { text, setText, emitted };
}

export type DateFieldProps = Common & {
  value: string | null | undefined;
  onChange: (iso: string) => void;
  /** ISO bounds: dates outside them are disabled in the calendar and refused when typed. */
  min?: string;
  max?: string;
  /** Overrides the Admin setting (tests, the style guide). */
  weekStart?: WeekStart;
};

export function DateField({
  id, value, onChange, min, max, weekStart, className, onBlur, disabled, required, ...aria
}: DateFieldProps) {
  const ctxStart = React.useContext(WeekStartContext);
  const start = weekStart ?? ctxStart;
  const iso = value ?? "";
  const { text, setText, emitted } = useSyncedText(iso, isoToDisplay);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useOutside(wrap, open, close);

  const emit = (v: string) => { emitted.current = v; if (v !== iso) onChange(v); };
  const rangeProblem = (d: string) =>
    min && d < min ? `Choose a date on or after ${isoToDisplay(min)}.` : max && d > max ? `Choose a date on or before ${isoToDisplay(max)}.` : null;

  /** Reads the text; `final` (on leaving the field) also reports incomplete dates. */
  const read = (t: string, final: boolean) => {
    const p = parseDisplay(t);
    if (p.kind === "empty") { setProblem(null); emit(""); return; }
    if (p.kind === "ok") {
      const out = rangeProblem(p.iso);
      setProblem(out);
      emit(out ? "" : p.iso);
      if (final && !out) setText(isoToDisplay(p.iso));
      return;
    }
    if (final) setProblem("Enter a date as DD-MM-YYYY, e.g. 05-03-2027.");
    emit("");
  };

  const pick = (d: string) => {
    setText(isoToDisplay(d));
    setProblem(null);
    emit(d);
    setOpen(false);
    button.current?.focus();
  };

  const errId = `${id}-date-error`;
  const describedBy = [aria["aria-describedby"], problem ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div ref={wrap} className={cn("relative", className)}>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD-MM-YYYY"
        maxLength={10}
        disabled={disabled}
        required={required}
        value={text}
        aria-label={aria["aria-label"]}
        title={aria.title}
        aria-describedby={describedBy}
        aria-invalid={problem ? true : aria["aria-invalid"]}
        aria-required={aria["aria-required"]}
        data-date-field=""
        onChange={(e) => {
          const raw = e.target.value;
          const grew = raw.length > text.length;
          const next = grew ? autoDash(raw) : raw;
          setText(next);
          read(next, false);
          if (!grew && problem) setProblem(null);
        }}
        onBlur={() => { read(text, true); onBlur?.(); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && e.altKey) { e.preventDefault(); setOpen(true); } }}
        className="pr-10 tabular-nums"
      />
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-label={`Choose date${aria["aria-label"] ? ` (${aria["aria-label"]})` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-r-md text-fg-subtle hover:text-fg disabled:cursor-not-allowed touch:h-11"
      >
        <CalendarDays aria-hidden className="size-4" />
      </button>
      {problem && <p id={errId} className="mt-1 text-xs font-medium text-danger">{problem}</p>}
      {open && !disabled && (
        <Calendar
          selected={splitIso(iso) ? iso : ""}
          min={min}
          max={max}
          start={start}
          onPick={pick}
          onClose={() => { setOpen(false); button.current?.focus(); }}
        />
      )}
    </div>
  );
}

function Calendar({ selected, min, max, start, onPick, onClose }: {
  selected: string; min?: string; max?: string; start: WeekStart; onPick: (iso: string) => void; onClose: () => void;
}) {
  const today = todayIso();
  const [focus, setFocus] = React.useState(() => clampIso(selected || today, min, max));
  const [y, m] = splitIso(focus)!;
  const grid = monthGrid(y, m, start);
  const gridRef = React.useRef<HTMLTableElement>(null);
  const out = (d: string) => (min !== undefined && d < min) || (max !== undefined && d > max);
  const minYear = min ? Number(min.slice(0, 4)) : Math.min(1920, y);
  const maxYear = max ? Number(max.slice(0, 4)) : Math.max(Number(today.slice(0, 4)) + 15, y);

  React.useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus();
  }, [focus]);

  const move = (d: string) => setFocus(clampIso(d, min, max));
  const onKey = (e: React.KeyboardEvent) => {
    const col = grid.flat().indexOf(focus) % 7;
    const keys: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      Home: () => addDays(focus, -col),
      End: () => addDays(focus, 6 - col),
    };
    if (keys[e.key]) { e.preventDefault(); move(keys[e.key]!()); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  const setMonth = (year: number, month1: number) => {
    const [, , d] = splitIso(focus)!;
    move(isoOf(year, month1, Math.min(d, new Date(Date.UTC(year, month1, 0)).getUTCDate())));
  };
  const names = weekdayNames(start);
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Choose date"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      className="absolute left-0 z-30 mt-1 w-80 rounded-md border border-border bg-surface-raised p-3 shadow-dialog"
    >
      <div className="mb-2 flex items-center gap-1">
        <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => move(addMonths(focus, -1))}><ChevronLeft aria-hidden className="size-4" /></Button>
        <Select aria-label="Month" value={m} onChange={(e) => setMonth(y, Number(e.target.value))} className="h-8 flex-1 text-sm">
          {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
        </Select>
        <Select aria-label="Year" value={y} onChange={(e) => setMonth(Number(e.target.value), m)} className="h-8 w-24 text-sm">
          {years.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
        </Select>
        <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => move(addMonths(focus, 1))}><ChevronRight aria-hidden className="size-4" /></Button>
      </div>
      <table ref={gridRef} role="grid" aria-label={`${MONTHS[m - 1]} ${y}`} className="w-full table-fixed border-collapse text-center text-sm" onKeyDown={onKey}>
        <thead>
          <tr>{names.map((n) => <th key={n} scope="col" abbr={n} className="pb-1 text-xs font-medium text-fg-muted">{n.slice(0, 2)}</th>)}</tr>
        </thead>
        <tbody>
          {grid.map((week) => (
            <tr key={week[0]}>
              {week.map((d) => {
                const inMonth = d.slice(0, 7) === focus.slice(0, 7);
                const isSel = d === selected;
                const disabled = out(d);
                return (
                  <td key={d} role="gridcell" aria-selected={isSel || undefined} className="p-0.5">
                    <button
                      type="button"
                      data-iso={d}
                      tabIndex={d === focus ? 0 : -1}
                      disabled={disabled}
                      aria-label={longLabel(d)}
                      aria-current={d === today ? "date" : undefined}
                      onClick={() => onPick(d)}
                      className={cn(
                        "flex h-8 w-full items-center justify-center rounded-sm tabular-nums hover:bg-primary-subtle",
                        !inMonth && "text-fg-subtle",
                        d === today && !isSel && "font-semibold text-primary",
                        isSel && "bg-primary text-fg-on-fill hover:bg-primary",
                        disabled && "cursor-not-allowed text-fg-subtle line-through opacity-50 hover:bg-transparent",
                      )}
                    >
                      {Number(d.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex justify-between">
        <Button size="sm" variant="ghost" disabled={out(today)} onClick={() => onPick(today)}>Today</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

/** Month and year only (EMI start), MM-YYYY on screen; value "YYYY-MM". */
export function MonthField({
  id, value, onChange, className, onBlur, disabled, required, ...aria
}: Common & { value: string | null | undefined; onChange: (ym: string) => void }) {
  const ym = value ?? "";
  const { text, setText, emitted } = useSyncedText(ym, monthToDisplay);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useOutside(wrap, open, close);
  const emit = (v: string) => { emitted.current = v; if (v !== ym) onChange(v); };
  const read = (t: string, final: boolean) => {
    const p = parseMonthDisplay(t);
    if (p.kind === "empty") { setProblem(null); emit(""); return; }
    if (p.kind === "ok") { setProblem(null); emit(p.ym); if (final) setText(monthToDisplay(p.ym)); return; }
    if (final) setProblem("Enter a month as MM-YYYY, e.g. 03-2027.");
    emit("");
  };
  const pick = (v: string) => { setText(monthToDisplay(v)); setProblem(null); emit(v); setOpen(false); button.current?.focus(); };
  const errId = `${id}-month-error`;
  const describedBy = [aria["aria-describedby"], problem ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div ref={wrap} className={cn("relative", className)}>
      <Input
        id={id} inputMode="numeric" autoComplete="off" placeholder="MM-YYYY" maxLength={7} disabled={disabled} required={required}
        value={text} aria-label={aria["aria-label"]} title={aria.title} aria-describedby={describedBy}
        aria-invalid={problem ? true : aria["aria-invalid"]} aria-required={aria["aria-required"]} data-month-field=""
        onChange={(e) => {
          const raw = e.target.value;
          const next = raw.length > text.length ? autoDashMonth(raw) : raw;
          setText(next);
          read(next, false);
        }}
        onBlur={() => { read(text, true); onBlur?.(); }}
        className="pr-10 tabular-nums"
      />
      <button ref={button} type="button" disabled={disabled} aria-label="Choose month" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-r-md text-fg-subtle hover:text-fg disabled:cursor-not-allowed touch:h-11">
        <CalendarDays aria-hidden className="size-4" />
      </button>
      {problem && <p id={errId} className="mt-1 text-xs font-medium text-danger">{problem}</p>}
      {open && !disabled && <MonthPicker selected={ym} onPick={pick} onClose={() => { setOpen(false); button.current?.focus(); }} />}
    </div>
  );
}

function MonthPicker({ selected, onPick, onClose }: { selected: string; onPick: (ym: string) => void; onClose: () => void }) {
  const start = /^\d{4}-\d{2}$/.test(selected) ? selected : todayIso().slice(0, 7);
  const [focus, setFocus] = React.useState(start);
  const ref = React.useRef<HTMLDivElement>(null);
  const year = Number(focus.slice(0, 4));
  React.useEffect(() => { ref.current?.querySelector<HTMLButtonElement>(`[data-ym="${focus}"]`)?.focus(); }, [focus]);
  const shift = (n: number) => {
    const idx = year * 12 + Number(focus.slice(5)) - 1 + n;
    setFocus(`${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const k: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 };
    if (k[e.key] !== undefined) { e.preventDefault(); shift(k[e.key]!); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  return (
    <div ref={ref} role="dialog" aria-label="Choose month" onKeyDown={onKey}
      className="absolute left-0 z-30 mt-1 w-64 rounded-md border border-border bg-surface-raised p-3 shadow-dialog">
      <div className="mb-2 flex items-center justify-between">
        <Button size="sm" variant="ghost" aria-label="Previous year" onClick={() => shift(-12)}><ChevronLeft aria-hidden className="size-4" /></Button>
        <span className="text-sm font-medium" aria-live="polite">{year}</span>
        <Button size="sm" variant="ghost" aria-label="Next year" onClick={() => shift(12)}><ChevronRight aria-hidden className="size-4" /></Button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTHS.map((name, i) => {
          const v = `${String(year).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button key={name} type="button" data-ym={v} tabIndex={v === focus ? 0 : -1} aria-label={`${name} ${year}`}
              aria-pressed={v === selected} onClick={() => onPick(v)}
              className={cn("h-8 rounded-sm text-sm hover:bg-primary-subtle",
                v === selected && "bg-primary text-fg-on-fill hover:bg-primary")}>
              {name.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type RhfProps<T extends FieldValues> = {
  control: Control<T>;
  name: Path<T>;
  rules?: Omit<RegisterOptions<T, Path<T>>, "valueAsNumber" | "valueAsDate" | "setValueAs" | "disabled">;
};

/** DateField bound to react-hook-form. Passes Field's aria attributes through (a bare Controller would drop them). */
export function FormDateField<T extends FieldValues>({ control, name, rules, ...rest }: RhfProps<T> & Omit<DateFieldProps, "value" | "onChange">) {
  return (
    <Controller control={control} name={name} rules={rules}
      render={({ field }) => <DateField {...rest} value={(field.value as string | null) ?? ""} onChange={field.onChange} onBlur={field.onBlur} />} />
  );
}

/** MonthField bound to react-hook-form. */
export function FormMonthField<T extends FieldValues>({ control, name, rules, ...rest }: RhfProps<T> & Omit<Common, "onBlur">) {
  return (
    <Controller control={control} name={name} rules={rules}
      render={({ field }) => <MonthField {...rest} value={(field.value as string | null) ?? ""} onChange={field.onChange} onBlur={field.onBlur} />} />
  );
}

/**
 * Date and time in India time (presentations, emails, calls): a DateField and a time box ("16:05" or "4:05 pm", shown
 * as "4:05 pm"). Value "YYYY-MM-DDTHH:MM" as India wall-clock time ("" until both parts are valid); convert with
 * istToInstant() for the API, so a PC in another time zone still records India time.
 */
export function DateTimeField({ id, value, onChange, timeLabel = "Time", disabled, ...aria }: Omit<Common, "onBlur" | "required"> & {
  value: string;
  onChange: (wall: string) => void;
  timeLabel?: string;
}) {
  const [date, setDate] = React.useState(value.slice(0, 10));
  const [time, setTime] = React.useState(value.slice(11, 16));
  const [timeText, setTimeText] = React.useState(timeToDisplay(value.slice(11, 16)));
  const [problem, setProblem] = React.useState<string | null>(null);
  const prev = React.useRef(value);
  const emitted = React.useRef(value);
  React.useEffect(() => {
    if (value === prev.current) return;
    prev.current = value;
    if (value !== emitted.current) {
      setDate(value.slice(0, 10));
      setTime(value.slice(11, 16));
      setTimeText(timeToDisplay(value.slice(11, 16)));
    }
    emitted.current = value;
  }, [value]);
  const emit = (d: string, t: string) => {
    const v = d && t ? `${d}T${t}` : "";
    emitted.current = v;
    if (v !== value) onChange(v);
  };
  const timeId = `${id}-time`;
  const errId = `${id}-time-error`;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <DateField id={id} value={date} disabled={disabled} className="min-w-40 flex-1" {...aria}
        onChange={(d) => { setDate(d); emit(d, time); }} />
      <div className="w-32">
        <Input
          id={timeId}
          aria-label={timeLabel}
          placeholder="e.g. 4:30 pm"
          autoComplete="off"
          disabled={disabled}
          value={timeText}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errId : undefined}
          onChange={(e) => {
            setTimeText(e.target.value);
            const t = parseTime(e.target.value) ?? "";
            setTime(t);
            if (t) setProblem(null);
            emit(date, t);
          }}
          onBlur={() => {
            const t = parseTime(timeText);
            if (t) setTimeText(timeToDisplay(t));
            setProblem(timeText.trim() && !t ? "Enter a time such as 16:30 or 4:30 pm." : null);
          }}
          className="tabular-nums"
        />
        {problem && <p id={errId} className="mt-1 text-xs font-medium text-danger">{problem}</p>}
      </div>
    </div>
  );
}
