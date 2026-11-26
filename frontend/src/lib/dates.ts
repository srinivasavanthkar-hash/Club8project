/**
 * Date entry helpers for DateField / MonthField: staff always see and type DD-MM-YYYY (MM-YYYY for months), whatever
 * the browser's language; the API always gets ISO (YYYY-MM-DD / YYYY-MM). Dates are calendar days, never instants,
 * so all arithmetic is done in UTC on Y/M/D and no time zone can shift a day.
 */

export type WeekStart = "MONDAY" | "SUNDAY";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function isoOf(year: number, month1: number, day: number): string {
  return `${pad(year, 4)}-${pad(month1)}-${pad(day)}`;
}

/** "2027-03-05" -> [2027, 3, 5], or null when it is not a real calendar date. */
export function splitIso(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return [y, mo, d];
}

/** ISO -> "05-03-2027" (empty for nothing or an unreadable value). */
export function isoToDisplay(iso: string | null | undefined): string {
  const p = iso ? splitIso(iso.slice(0, 10)) : null;
  return p ? `${pad(p[2])}-${pad(p[1])}-${pad(p[0], 4)}` : "";
}

export type Parsed = { kind: "empty" } | { kind: "ok"; iso: string } | { kind: "invalid" };

/**
 * What the person typed, read as day-month-year: "05-03-2027", "5-3-2027", "05/03/2027", "5.3.2027" or "05032027".
 * Two-digit years are refused (ambiguous), as are impossible dates such as 31-02-2027.
 */
export function parseDisplay(text: string): Parsed {
  const s = text.trim();
  if (s === "") return { kind: "empty" };
  let m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/.exec(s);
  if (!m && /^\d{8}$/.test(s)) m = [s, s.slice(0, 2), s.slice(2, 4), s.slice(4)] as unknown as RegExpExecArray;
  // A pasted ISO date (year first, four digits) cannot be misread: accepted and shown as DD-MM-YYYY on leaving.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m && iso) m = [s, iso[3], iso[2], iso[1]] as unknown as RegExpExecArray;
  if (!m) return { kind: "invalid" };
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return { kind: "invalid" };
  return { kind: "ok", iso: isoOf(y, mo, d) };
}

/**
 * Typing aid: digits only get dashes put in for them ("0503" -> "05-03", "05032027" -> "05-03-2027"). Text with the
 * person's own separators is left as typed (read by parseDisplay). Deleting is never fought: only called on growth.
 */
export function autoDash(typed: string): string {
  if (!/^[\d-]*$/.test(typed)) return typed;
  const text = typed.replace(/-+/g, "-"); // a dash typed right after one we put in
  const digits = text.replace(/-/g, "");
  if (text.includes("-") && !/^\d{2}(-\d{0,2}(-\d{0,4})?)?$/.test(text)) return text; // e.g. "5-3-2027" as typed
  const d = digits.slice(0, 8);
  if (d.length <= 2) return d.length === 2 ? `${d}-` : d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}${d.length === 4 ? "-" : ""}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
}

/** Same day n days later (n may be negative). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = splitIso(iso)!;
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Same day n months later, kept inside the month (31 January + 1 month = 28/29 February). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = splitIso(iso)!;
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return isoOf(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = splitIso(iso)!;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Position of a weekday in a week that starts on `start` (0 = first column). */
export function columnOf(iso: string, start: WeekStart): number {
  return (weekdayOf(iso) - (start === "MONDAY" ? 1 : 0) + 7) % 7;
}

/** Weekday names in column order. */
export function weekdayNames(start: WeekStart): string[] {
  return start === "MONDAY" ? [...WEEKDAYS.slice(1), WEEKDAYS[0]!] : [...WEEKDAYS];
}

/** The weeks shown for a month: always whole weeks, with the neighbouring months' days at either end. */
export function monthGrid(year: number, month1: number, start: WeekStart): string[][] {
  const first = isoOf(year, month1, 1);
  let day = addDays(first, -columnOf(first, start));
  const last = isoOf(year, month1, daysInMonth(year, month1));
  const weeks: string[][] = [];
  while (weeks.length === 0 || day <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** "Friday 5 March 2027" (calendar buttons' accessible names). */
export function longLabel(iso: string): string {
  const [y, m, d] = splitIso(iso)!;
  return `${WEEKDAYS[weekdayOf(iso)]} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function clampIso(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

// ---- months (EMI start): "MM-YYYY" on screen, "YYYY-MM" for the API

export function monthToDisplay(ym: string | null | undefined): string {
  const m = ym ? /^(\d{4})-(\d{2})$/.exec(ym) : null;
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[2]}-${m[1]}` : "";
}

export type ParsedMonth = { kind: "empty" } | { kind: "ok"; ym: string } | { kind: "invalid" };

/** "03-2027", "3-2027", "03/2027" or "032027". */
export function parseMonthDisplay(text: string): ParsedMonth {
  const s = text.trim();
  if (s === "") return { kind: "empty" };
  let m = /^(\d{1,2})[-/. ](\d{4})$/.exec(s);
  if (!m && /^\d{6}$/.test(s)) m = [s, s.slice(0, 2), s.slice(2)] as unknown as RegExpExecArray;
  if (!m) return { kind: "invalid" };
  const [mo, y] = [Number(m[1]), Number(m[2])];
  if (y < 1900 || mo < 1 || mo > 12) return { kind: "invalid" };
  return { kind: "ok", ym: `${pad(y, 4)}-${pad(mo)}` };
}

export function autoDashMonth(text: string): string {
  if (!/^\d*$/.test(text)) return text;
  const d = text.slice(0, 6);
  if (d.length < 2) return d;
  return d.length === 2 ? `${d}-` : `${d.slice(0, 2)}-${d.slice(2)}`;
}
