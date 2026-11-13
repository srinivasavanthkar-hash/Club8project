/** Display helpers: DD-MM-YYYY dates in Asia/Kolkata, Indian digit grouping for INR. Amounts arrive as decimal
 * strings from the API and are never converted to floating point for arithmetic. */

export function formatMoney(value: string | null | undefined, currency = "INR"): string {
  if (value === null || value === undefined || value === "") return "—";
  const negative = value.startsWith("-");
  const [whole = "0", frac = "00"] = value.replace("-", "").split(".");
  const fraction = (frac + "00").slice(0, 2);
  let grouped = whole;
  if (currency === "INR" && whole.length > 3) {
    const tail = whole.slice(-3);
    let head = whole.slice(0, -3);
    const parts: string[] = [];
    while (head.length > 2) {
      parts.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    if (head) parts.unshift(head);
    grouped = [...parts, tail].join(",");
  } else if (whole.length > 3) {
    grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : `${currency} `;
  return `${negative ? "-" : ""}${symbol}${grouped}.${fraction}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}-${m}-${y}`;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(dt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

/** 12-hour time with am/pm in IST, e.g. "4:05 pm". */
export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(dt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return `${formatDate(value)} ${formatTime(value)}`;
}

/** Whole days from today (IST) to an ISO date: negative = in the past. */
export function daysFromToday(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const d = isoDate.slice(0, 10);
  const ms = Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}

/** "today", "in 3 days", "3 days overdue" / "3 days ago". */
export function formatRelativeDays(isoDate: string | null | undefined, pastLabel: "ago" | "overdue" = "ago"): string {
  const n = daysFromToday(isoDate);
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n > 0) return `in ${n} days`;
  const k = -n;
  return pastLabel === "overdue" ? `${k} ${k === 1 ? "day" : "days"} overdue` : k === 1 ? "yesterday" : `${k} days ago`;
}

/** Phone numbers in lists: "+91 98XXX XX308". Non-Indian numbers keep only the last 3 digits visible. */
export function formatPhoneMasked(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  if (local.length === 10) return `+91 ${local.slice(0, 2)}XXX XX${local.slice(-3)}`;
  if (digits.length < 4) return "XXXX";
  return `${"X".repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
}

/** Full phone number for detail views: "+91 98450 12345". */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return local.length === 10 ? `+91 ${local.slice(0, 5)} ${local.slice(5)}` : value;
}

/** Nights always with one decimal ("7.0", "3.5") because half nights exist. */
export function formatNights(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : String(value);
}

/** Human label for an UPPER_SNAKE code: "MEMBERSHIP_EMI" -> "Membership EMI". */
export function humanize(code: string | null | undefined): string {
  if (!code) return "—";
  const ACRONYMS = new Set(["EMI", "ASF", "GST", "PAN", "DL", "ID", "UPI", "NEFT", "RTGS", "KYC", "OPC", "PDF"]);
  return code
    .split("_")
    .map((w, i) => (ACRONYMS.has(w) ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");
}

export function todayIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return parts; // en-CA gives YYYY-MM-DD
}

/** Exact decimal subtraction/addition on 2-dp strings (for live form totals) using integer paise. */
export function addMoney(...values: (string | undefined)[]): string {
  const paise = values.reduce((sum, v) => sum + toPaise(v), 0n);
  return fromPaise(paise);
}
export function subMoney(a: string | undefined, b: string | undefined): string {
  return fromPaise(toPaise(a) - toPaise(b));
}
function toPaise(v: string | undefined): bigint {
  if (!v || !/^-?\d+(\.\d{0,2})?$/.test(v.trim())) return 0n;
  const neg = v.trim().startsWith("-");
  const [w = "0", f = ""] = v.trim().replace("-", "").split(".");
  const p = BigInt(w) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -p : p;
}
function fromPaise(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
