/**
 * Master-data forms (Admin > Master data & rates), driven by GET /admin/master-forms. Pure helpers: turning a stored
 * row into form values and back, plain-language validation, and readable table cells. No JSON entry.
 */
import { formatDate, formatMoney } from "@/lib/format";

export type FieldKind =
  | "text" | "textarea" | "int" | "decimal" | "date" | "bool" | "colour" | "choice" | "ref"
  | "int_list" | "str_list" | "letter" | "setting_value" | "json";

export type FieldSpec = {
  name: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  max_length?: number;
  help?: string;
  ref?: { slug: string; by: "id" | "code"; none_label?: string };
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  min_exclusive?: number;
  locked_on_edit?: string;
  /** Business settings with a fixed set of values (by setting key): shown as a dropdown. */
  setting_choices?: Record<string, { value: string; label: string }[]>;
  /** Column default: a new entry starts with it. */
  default?: string | number | boolean;
};

export type FormSpec = {
  slug: string;
  intro: string;
  effective_dated: boolean;
  rate_table: boolean;
  fields: FieldSpec[];
  columns: string[];
};

export type Row = Record<string, unknown>;
/** Form values: strings for inputs, booleans for ticks. */
export type Values = Record<string, string | boolean>;
export type RefRows = Record<string, Row[]>;

const isBlank = (v: unknown) => v === null || v === undefined || v === "";

/** Value kind of a business setting, from its stored value. */
export function settingKind(v: unknown): "bool" | "number" | "number_list" | "text_list" | "text" {
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return "number";
  if (Array.isArray(v)) return v.every((x) => typeof x === "number") && v.length > 0 ? "number_list" : "text_list";
  return "text";
}

export function emptyValues(spec: FormSpec): Values {
  const v: Values = {};
  for (const f of spec.fields) {
    if (f.kind === "bool") v[f.name] = typeof f.default === "boolean" ? f.default : f.name === "is_active";
    else v[f.name] = f.default === undefined || typeof f.default === "boolean" ? "" : String(f.default);
  }
  return v;
}

export function toValues(spec: FormSpec, row: Row): Values {
  const v: Values = {};
  for (const f of spec.fields) {
    const x = row[f.name];
    if (f.kind === "bool") v[f.name] = Boolean(x);
    else if (f.kind === "int_list") v[f.name] = Array.isArray(x) ? x.join(", ") : "";
    else if (f.kind === "str_list") v[f.name] = Array.isArray(x) ? x.join("\n") : "";
    else if (f.kind === "setting_value") {
      const k = settingKind(x);
      v[f.name] = k === "bool" ? Boolean(x) : Array.isArray(x) ? x.join(k === "number_list" ? ", " : "\n") : isBlank(x) ? "" : String(x);
    } else v[f.name] = isBlank(x) ? "" : String(x);
  }
  return v;
}

const splitList = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);

/** Converts one form value to what the API stores. `original` is the stored value (setting kinds follow it). */
export function toApi(f: FieldSpec, value: string | boolean, original?: unknown): unknown {
  if (f.kind === "bool") return Boolean(value);
  const s = typeof value === "string" ? value.trim() : String(value);
  switch (f.kind) {
    case "int": return s === "" ? null : Number(s);
    case "decimal": return s === "" ? null : s;
    case "date": case "ref": case "choice": case "colour": return s === "" ? null : s;
    case "int_list": return splitList(s, /[,\s]+/).map(Number);
    case "str_list": return splitList(s, /\r?\n/);
    case "setting_value": {
      const k = settingKind(original);
      if (k === "bool") return Boolean(value);
      if (k === "number") return Number(s);
      if (k === "number_list") return splitList(s, /[,\s]+/).map(Number);
      if (k === "text_list") return splitList(s, /\r?\n|,/);
      return s;
    }
    default: return s === "" && !f.required ? null : s;
  }
}

/** The payload: every field for a new row; only the changed fields for an edit. */
export function payload(spec: FormSpec, values: Values, original?: Row): Row {
  const out: Row = {};
  for (const f of spec.fields) {
    const next = toApi(f, values[f.name] ?? "", original?.[f.name]);
    if (!original) {
      if (next !== null || f.required) out[f.name] = next;
      continue;
    }
    const before = toApi(f, toValues(spec, original)[f.name] ?? "", original[f.name]);
    if (JSON.stringify(next) !== JSON.stringify(before)) out[f.name] = next;
  }
  return out;
}

/** Plain-language checks before sending (the server checks again). Returns field -> message. */
export function validate(spec: FormSpec, values: Values, editing = false): Record<string, string> {
  const errors: Record<string, string> = {};
  const byName = Object.fromEntries(spec.fields.map((f) => [f.name, f]));
  for (const f of spec.fields) {
    if (editing && f.locked_on_edit) continue;
    const raw = values[f.name];
    if (f.kind === "bool") continue;
    const s = typeof raw === "string" ? raw.trim() : "";
    if (s === "") {
      if (f.required && f.kind !== "setting_value") errors[f.name] = `${f.label} is required.`;
      continue;
    }
    if (f.max_length && s.length > f.max_length) errors[f.name] = `${f.label} can be at most ${f.max_length} characters.`;
    if (f.kind === "int" && !/^-?\d+$/.test(s)) errors[f.name] = `${f.label} must be a whole number.`;
    if (f.kind === "decimal" && !/^-?\d+(\.\d+)?$/.test(s)) errors[f.name] = `${f.label} must be a number, e.g. 12.5.`;
    if (f.kind === "int_list" && !splitList(s, /[,\s]+/).every((x) => /^\d+$/.test(x))) errors[f.name] = `${f.label}: use whole numbers separated by commas, e.g. 10, 15, 25.`;
    if (f.kind === "colour" && !/^#[0-9a-fA-F]{6}$/.test(s)) errors[f.name] = `${f.label}: write # and six hex digits, e.g. #393186.`; // design-tokens-allow: an example in a message
    if (f.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[f.name] = `${f.label} must be a date.`;
    if ((f.kind === "int" || f.kind === "decimal") && !errors[f.name]) {
      const n = Number(s);
      if (f.min !== undefined && n < f.min) errors[f.name] = `${f.label} cannot be less than ${f.min}.`;
      if (f.max !== undefined && n > f.max) errors[f.name] = `${f.label} cannot be more than ${f.max}.`;
      if (f.min_exclusive !== undefined && n <= f.min_exclusive) errors[f.name] = `${f.label} must be more than ${f.min_exclusive}.`;
    }
  }
  const pair = (a: string, b: string, msg: string, numeric = false) => {
    const x = String(values[a] ?? "").trim();
    const y = String(values[b] ?? "").trim();
    if (!byName[a] || !byName[b] || !x || !y || errors[a] || errors[b]) return;
    if (numeric ? Number(y) < Number(x) : y < x) errors[b] = msg;
  };
  pair("effective_from", "effective_to", "'Effective to' must be on or after 'Effective from'.");
  pair("start_date", "end_date", "The last day must be on or after the first day.");
  pair("min_days", "max_days", "'To' days must be the same as or more than 'From' days.", true);
  return errors;
}

/** Server-side field errors (422 from pydantic) in plain language, by field. */
export function serverFieldErrors(spec: FormSpec, errors: { loc: (string | number)[]; msg: string; type?: string }[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of errors ?? []) {
    const name = String(e.loc[e.loc.length - 1]);
    const f = spec.fields.find((x) => x.name === name);
    if (!f) continue;
    const plain: Record<string, string> = {
      missing: `${f.label} is required.`,
      int_parsing: `${f.label} must be a whole number.`,
      decimal_parsing: `${f.label} must be a number.`,
      date_parsing: `${f.label} must be a date.`,
      date_from_datetime_parsing: `${f.label} must be a date.`,
      string_too_long: `${f.label} is too long.`,
    };
    out[name] = plain[e.type ?? ""] ?? `${f.label}: ${e.msg}`;
  }
  return out;
}

/** Name shown for a row of a referenced table (never its ID). */
export function rowName(r: Row): string {
  return String(r.name ?? r.label ?? r.code ?? r.key ?? "");
}

export function refOptions(f: FieldSpec, rows: Row[] | undefined, current?: string) {
  if (!f.ref) return [];
  const seen = new Set<string>();
  const out: { value: string; label: string; description?: string }[] = [];
  for (const r of rows ?? []) {
    const value = String(f.ref.by === "id" ? r.id : r.code);
    if (seen.has(value)) continue;
    if (r.is_active === false && value !== current) continue;
    seen.add(value);
    const label = rowName(r);
    out.push({ value, label, description: r.name && r.code && label !== r.code ? String(r.code) : undefined });
  }
  return out;
}

/** Readable cell for the list table. */
export function cellText(f: FieldSpec, row: Row, refs: RefRows): string {
  const x = row[f.name];
  if (f.kind === "ref" && f.ref) {
    if (isBlank(x)) return f.ref.none_label ?? "—";
    const hit = (refs[f.ref.slug] ?? []).find((r) => String(f.ref!.by === "id" ? r.id : r.code) === String(x));
    return hit ? rowName(hit) : f.ref.by === "code" ? String(x) : "(unknown)";
  }
  if (isBlank(x)) return f.name === "effective_to" ? "Open-ended" : f.name === "max_days" ? "or more" : "—";
  if (f.kind === "bool") return x ? "Yes" : "No";
  if (f.kind === "date") return formatDate(String(x));
  if (f.kind === "choice") return f.choices?.find((c) => c.value === x)?.label ?? String(x);
  if (f.kind === "setting_value" && typeof row.key === "string") {
    const label = f.setting_choices?.[row.key]?.find((c) => c.value === x)?.label;
    if (label) return label;
  }
  if (f.name === "amount" && typeof row.currency === "string") return formatMoney(String(x), row.currency);
  if (f.name === "rate_percent" || f.name === "credit_percent") return `${Number(x)}%`;
  if (f.name === "multiplier") return `× ${Number(x)}`;
  if (Array.isArray(x)) return x.join(", ");
  if (typeof x === "boolean") return x ? "Yes" : "No";
  return String(x);
}
