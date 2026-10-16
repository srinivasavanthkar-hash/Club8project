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

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const dt = new Date(value);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(dt);
  return `${formatDate(value)} ${time}`;
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
