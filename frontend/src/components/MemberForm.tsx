"use client";
/* Member application form. Section order mirrors the paper Membership Application Form so staff can key in
 * from the scanned form top to bottom (docs/FORM_MAPPING.md). */
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { BrandIcon } from "@/components/crm/Brand";
import { ErrorText, useMaster, useStaff } from "@/components/providers";
import { Alert, AutoTag, Button, Card, Checkbox, Field, Input, Kbd, PrefixInput, Select, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { addMoney, formatMoney, subMoney, todayIso } from "@/lib/format";
import { brandOfCompany } from "@/lib/brand";
import { useSaveShortcut } from "@/lib/useShortcut";
import { cn } from "@/lib/utils";
import { aadhaarSchema, isAdult, mobileSchema, moneySchema, optionalMobile, panSchema, pinSchema } from "@/lib/validation";
import { FormDateField, FormMonthField } from "@/components/DateField";

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

const kycSchema = z
  .object({ id_type: z.enum(["AADHAAR", "PAN", "DL", "PASSPORT", "VOTER_ID"]), value: z.string().trim().min(4, "Required"), expiry_date: z.string().optional() })
  .superRefine((k, ctx) => {
    if (k.id_type === "PAN" && !panSchema.safeParse(k.value).success) ctx.addIssue({ code: "custom", path: ["value"], message: "PAN must look like AAAAA9999A" });
    if (k.id_type === "AADHAAR" && !aadhaarSchema.safeParse(k.value).success) ctx.addIssue({ code: "custom", path: ["value"], message: "Invalid Aadhaar (checksum)" });
    if (k.id_type === "PASSPORT" && !k.expiry_date) ctx.addIssue({ code: "custom", path: ["expiry_date"], message: "Passport expiry required" });
  });

const applicantSchema = z.object({
  full_name: z.string().trim().min(2, "Name is required"),
  dob: z.string().min(1, "Date of birth is required").refine((d) => isAdult(d), "Applicant must be 18 or older"),
  mobile: optionalMobile,
  email: z.union([z.literal(""), z.string().email()]).optional(),
  kyc: z.array(kycSchema).min(1, "At least one KYC ID is required"),
});

export const memberFormSchema = z
  .object({
    applicant1: applicantSchema.extend({ mobile: mobileSchema }),
    has_applicant2: z.boolean(),
    // validated in superRefine only when has_applicant2 is ticked (the field array always registers it)
    applicant2: z.any().optional(),
    address: z.object({
      line1: z.string().trim().min(2, "Address is required"),
      line2: z.string().optional(),
      city: z.string().trim().min(2, "City is required"),
      postcode: z.string().optional(),
      state: z.string().optional(),
      country: z.string().min(2),
    }),
    email: z.string().email("Valid email is required"),
    company_id: z.string().uuid("Choose the company / brand"),
    venue_id: z.string().optional(),
    home_property_id: z.string().optional(),
    number_series_id: z.string().optional(),
    membership_number: z.union([z.literal(""), z.string().regex(/^\d{1,10}$/, "Digits only (prefix is added)")]).optional(),
    purchase_date: z.string().min(1, "Required"),
    tenure_years: z.coerce.number().int().min(1).max(99),
    first_year_of_use: z.coerce.number().int().min(2000).max(2100),
    resort_category_id: z.string().uuid("Required"),
    season_id: z.string().uuid("Required"),
    unit_type_id: z.string().uuid("Required"),
    nights_per_year: z.string().regex(/^\d{1,3}(\.[05])?$/, "Whole or half nights"),
    purchase_price: moneySchema,
    admin_fees: moneySchema,
    down_payment_amount: moneySchema,
    down_payment_method_id: z.string().optional(),
    record_down_payment: z.boolean(),
    down_payment_ref: z.string().optional(),
    down_payment_card_last4: z.union([z.literal(""), z.string().regex(/^\d{4}$/, "Last 4 digits only")]).optional(),
    balance_mode: z.enum(["NONE", "EMI", "OTHER"]),
    emi_amount: z.union([z.literal(""), moneySchema]).optional(),
    emi_count: z.union([z.literal(""), z.coerce.number().int().min(1).max(240)]).optional(),
    emi_start: z.string().optional(), // YYYY-MM
    balance_other_text: z.string().optional(),
    joining_offers: z.array(z.object({ offer_type_id: z.string().uuid(), description: z.string().min(2), nights: z.string().optional() })),
    relationship_manager_id: z.string().optional(),
    team_manager_id: z.string().optional(),
    comments: z.string().optional(),
    agreement_signed_applicant1: z.boolean(),
    agreement_signed_applicant2: z.boolean(),
    agreement_signed_company: z.boolean(),
    agreement_signed_date: z.string().optional(),
    duplicate_override_reason: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.address.country.toLowerCase() === "india") {
      if (!pinSchema.safeParse(v.address.postcode ?? "").success) ctx.addIssue({ code: "custom", path: ["address", "postcode"], message: "6-digit PIN code required" });
      if (!v.address.state) ctx.addIssue({ code: "custom", path: ["address", "state"], message: "State is required" });
    }
    const balance = subMoney(addMoney(v.purchase_price, v.admin_fees), v.down_payment_amount);
    if (balance.startsWith("-")) ctx.addIssue({ code: "custom", path: ["down_payment_amount"], message: "Down payment exceeds total" });
    if (balance !== "0.00" && v.balance_mode === "NONE") ctx.addIssue({ code: "custom", path: ["balance_mode"], message: "Balance outstanding: choose EMI or Other" });
    if (v.balance_mode === "EMI" && (!v.emi_amount || !v.emi_count || !v.emi_start)) ctx.addIssue({ code: "custom", path: ["emi_amount"], message: "EMI amount, number and starting month are required" });
    if (v.record_down_payment && !v.down_payment_method_id) ctx.addIssue({ code: "custom", path: ["down_payment_method_id"], message: "Choose how the down payment was paid" });
    if (v.has_applicant2) {
      const a = applicantSchema.safeParse(v.applicant2);
      if (!a.success) a.error.issues.forEach((i) => ctx.addIssue({ ...i, path: ["applicant2", ...i.path] }));
    }
  });

export type MemberFormValues = z.infer<typeof memberFormSchema>;
/** What the fields hold before validation (zod 4 types coerced numbers as `unknown` on input). */
type MemberFormInput = z.input<typeof memberFormSchema>;

export function toPayload(v: MemberFormValues, sourceLeadId?: string) {
  const [ey, em] = (v.emi_start ?? "").split("-");
  const applicant = (a: Partial<MemberFormValues["applicant1"]> | undefined) =>
    a && {
      full_name: a.full_name,
      dob: a.dob,
      mobile: a.mobile || null,
      email: a.email || null,
      kyc: (a.kyc ?? []).map((k) => ({ id_type: k.id_type, value: k.value, expiry_date: k.expiry_date || null })),
    };
  return {
    applicant1: applicant(v.applicant1),
    applicant2: v.has_applicant2 ? applicant(v.applicant2) : null,
    address: { ...v.address, line2: v.address.line2 || null },
    email: v.email,
    company_id: v.company_id,
    venue_id: v.venue_id || null,
    home_property_id: v.home_property_id || null,
    number_series_id: v.number_series_id || null,
    membership_number: v.membership_number || null,
    purchase_date: v.purchase_date,
    tenure_years: v.tenure_years,
    first_year_of_use: v.first_year_of_use,
    resort_category_id: v.resort_category_id,
    season_id: v.season_id,
    unit_type_id: v.unit_type_id,
    nights_per_year: v.nights_per_year,
    purchase_price: v.purchase_price,
    admin_fees: v.admin_fees,
    down_payment_amount: v.down_payment_amount,
    down_payment_method_id: v.down_payment_method_id || null,
    down_payment: v.record_down_payment
      ? { payment_date: v.purchase_date, transaction_ref: v.down_payment_ref || null, card_last4: v.down_payment_card_last4 || null }
      : null,
    balance_mode: v.balance_mode,
    emi_amount: v.balance_mode === "EMI" ? v.emi_amount : null,
    emi_count: v.balance_mode === "EMI" ? v.emi_count : null,
    emi_start_year: v.balance_mode === "EMI" ? Number(ey) : null,
    emi_start_month: v.balance_mode === "EMI" ? Number(em) : null,
    balance_other_text: v.balance_other_text || null,
    joining_offers: v.joining_offers.map((o) => ({ ...o, nights: o.nights || null })),
    relationship_manager_id: v.relationship_manager_id || null,
    team_manager_id: v.team_manager_id || null,
    comments: v.comments || null,
    agreement_signed_applicant1: v.agreement_signed_applicant1,
    agreement_signed_applicant2: v.agreement_signed_applicant2,
    agreement_signed_company: v.agreement_signed_company,
    agreement_signed_date: v.agreement_signed_date || null,
    source_lead_id: sourceLeadId ?? null,
    duplicate_override_reason: v.duplicate_override_reason || null,
  };
}

const SECTIONS = [
  { n: 1, id: "sec-purchaser", title: "Purchaser (Member) Details", keys: ["applicant1", "applicant2", "address", "email"] },
  { n: 2, id: "sec-membership", title: "Membership Details", keys: ["company_id", "venue_id", "home_property_id", "number_series_id", "membership_number", "purchase_date", "tenure_years", "first_year_of_use", "resort_category_id", "season_id", "unit_type_id", "nights_per_year"] },
  { n: 3, id: "sec-payment", title: "Payment Details", keys: ["purchase_price", "admin_fees", "down_payment_amount", "down_payment_method_id", "down_payment_card_last4", "balance_mode", "emi_amount", "emi_count", "emi_start"] },
  { n: 4, id: "sec-offer", title: "Joining Offer", keys: ["joining_offers"] },
  { n: 5, id: "sec-sales", title: "Sales, Approval & Signatures", keys: ["relationship_manager_id", "team_manager_id", "comments", "duplicate_override_reason"] },
] as const;

/** Error path -> [field id, label] for the error summary links. */
const FIELD_INDEX: Record<string, [string, string]> = {
  "applicant1.full_name": ["applicant1-name", "1st Applicant Name"], "applicant1.dob": ["applicant1-dob", "1st applicant D.O.B"],
  "applicant1.mobile": ["applicant1-mobile", "1st applicant mobile"], "applicant1.email": ["applicant1-email", "1st applicant email"],
  "applicant2.full_name": ["applicant2-name", "2nd Applicant Name"], "applicant2.dob": ["applicant2-dob", "2nd applicant D.O.B"],
  "applicant2.mobile": ["applicant2-mobile", "2nd applicant mobile"], "applicant2.email": ["applicant2-email", "2nd applicant email"],
  "address.line1": ["addr1", "Address Line 1"], "address.city": ["city", "City"], "address.postcode": ["pin", "Post Code"], "address.state": ["state", "State"],
  email: ["email", "Email"], company_id: ["company", "Company / brand"], membership_number: ["mnum", "Membership Number"], number_series_id: ["series", "Membership number series"], purchase_date: ["pdate", "Purchase Date"],
  tenure_years: ["tenure", "Tenure"], first_year_of_use: ["fy", "First Year of Use"], resort_category_id: ["cat", "Category"], season_id: ["season", "Season"],
  unit_type_id: ["unit", "Unit Type"], nights_per_year: ["nights", "Nights per Year"], purchase_price: ["pp", "Purchase Price"], admin_fees: ["af", "Admin Fees"],
  down_payment_amount: ["dp", "Down Payment"], down_payment_method_id: ["dpm", "Payment method"], down_payment_card_last4: ["last4", "Card last 4 digits"],
  balance_mode: ["bm", "Balance Mode"], emi_amount: ["emi", "EMI Amount"],
};

/** Flatten react-hook-form errors to dotted paths (applicant1.kyc.0.value). */
function flatten(errors: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(errors).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (!v || typeof v !== "object") return [];
    if ("message" in (v as object) && typeof (v as { message?: unknown }).message === "string") return [path];
    return flatten(v as Record<string, unknown>, path);
  });
}

function fieldFor(path: string): [string, string] {
  if (FIELD_INDEX[path]) return FIELD_INDEX[path]!;
  const kyc = path.match(/^(applicant[12])\.kyc(?:\.(\d+))?/);
  if (kyc) return [`${kyc[1]}-kyc-${kyc[2] ?? 0}`, `${kyc[1] === "applicant1" ? "1st" : "2nd"} applicant KYC ID`];
  const sec = SECTIONS.find((s) => s.keys.some((k) => path.startsWith(k)));
  return [sec?.id ?? "sec-purchaser", path];
}

const Section = ({ n, id, title, children }: { n: number; id: string; title: string; children: React.ReactNode }) => (
  <Card
    id={id}
    className="scroll-mt-32"
    title={<><span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-primary-subtle text-sm font-semibold text-primary">{n}.</span>{" "}{title}</>}
  >
    <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-6">{children}</div>
  </Card>
);

/** Shows an INR amount with Indian grouping under the input without changing what was typed. */
function amountHint(v: string | undefined, fallback?: string) {
  return v && moneySchema.safeParse(v).success ? `= ${formatMoney(v)}` : fallback;
}

type SeriesOption = { id: string; prefix: string; next_number: number; venue_id: string | null; property_id: string | null; to_be_confirmed: boolean };

export function MemberForm({
  defaults, onSubmit, submitLabel, venueFromLead = false,
}: {
  defaults?: Partial<MemberFormValues>; onSubmit: (v: MemberFormValues) => Promise<void>; submitLabel: string;
  /** Converting a lead: the sales venue is the lead's and cannot be changed here. */
  venueFromLead?: boolean;
}) {
  const companies = useMaster("companies");
  const venues = useMaster("venues");
  const properties = useMaster("properties");
  const categories = useMaster("resort-categories");
  const seasons = useMaster("seasons");
  const units = useMaster("unit-types");
  const methods = useMaster("payment-methods");
  const offerTypes = useMaster("joining-offer-types");
  const asfRates = useMaster("asf-rates");
  const staff = useStaff();
  const [serverError, setServerError] = useState<unknown>(null);
  const [submitted, setSubmitted] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const year = Number(todayIso().slice(0, 4));

  const form = useForm<MemberFormInput, unknown, MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
    mode: "onTouched",
    defaultValues: {
      has_applicant2: false,
      address: { country: "India", line1: "", city: "" },
      purchase_date: todayIso(),
      tenure_years: 10,
      first_year_of_use: year,
      nights_per_year: "7",
      admin_fees: "0.00",
      purchase_price: "",
      down_payment_amount: "",
      balance_mode: "NONE",
      record_down_payment: true,
      joining_offers: [],
      agreement_signed_applicant1: false,
      agreement_signed_applicant2: false,
      agreement_signed_company: false,
      ...defaults,
      applicant1: { full_name: "", dob: "", mobile: "", kyc: [{ id_type: "PAN", value: "" }], ...defaults?.applicant1 },
    },
  });
  const { register, watch, formState: { errors, isSubmitting } } = form;
  const kyc1 = useFieldArray({ control: form.control, name: "applicant1.kyc" });
  const kyc2 = useFieldArray({ control: form.control, name: "applicant2.kyc" as "applicant1.kyc" });
  const offers = useFieldArray({ control: form.control, name: "joining_offers" });

  const [pp, af, dp, unitId, tenure, firstYear, country, emiAmount] = watch([
    "purchase_price", "admin_fees", "down_payment_amount", "unit_type_id", "tenure_years", "first_year_of_use", "address.country", "emi_amount",
  ]);
  const total = addMoney(pp, af);
  const balance = subMoney(total, dp);
  const lastYear = Number(firstYear) + Number(tenure) - 1;
  const asf = useMemo(() => {
    const today = todayIso();
    return (asfRates.data ?? [])
      .filter((r) => r.unit_type_id === unitId && String(r.effective_from) <= today && (!r.effective_to || String(r.effective_to) >= today))
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
  }, [asfRates.data, unitId]);
  const companyId = watch("company_id");
  const selectedBrand = brandOfCompany(companies.data?.find((c) => c.id === companyId));
  const [venueId, homePropertyId, purchaseDate, seriesId] = watch(["venue_id", "home_property_id", "purchase_date", "number_series_id"]);
  // Membership number series that fit this company, sales venue, home property and purchase date (most specific first)
  const series = useQuery({
    queryKey: ["number-series", companyId, venueId, homePropertyId, purchaseDate],
    queryFn: () => api.get<{ items: SeriesOption[]; default_id: string | null }>("/members/number-series", {
      company_id: companyId, purchase_date: purchaseDate, venue_id: venueId || undefined, home_property_id: homePropertyId || undefined,
    }),
    enabled: !!companyId && /^\d{4}-\d{2}-\d{2}$/.test(purchaseDate ?? ""),
  });
  useEffect(() => {
    const d = series.data;
    if (!d) return;
    // follow the most specific series (or nothing when two are equal) until staff choose one themselves; keep their
    // choice while it still fits
    const chosenByStaff = form.getFieldState("number_series_id").isDirty && d.items.some((s) => s.id === seriesId);
    if (!chosenByStaff) form.setValue("number_series_id", d.default_id ?? "", { shouldDirty: false });
  }, [series.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosenSeries = series.data?.items.find((s) => s.id === seriesId);
  const nameOf = (rows: { id: string; name: string }[] | undefined, id: string | null) => rows?.find((r) => r.id === id)?.name;
  const seriesLabel = (s: SeriesOption) => {
    const scope = [nameOf(venues.data, s.venue_id), nameOf(properties.data, s.property_id)].filter(Boolean).join(" + ") || "all locations and properties";
    return `${s.prefix}- (${scope})${s.to_be_confirmed ? ", to be confirmed" : ""}`;
  };
  const seriesHint = !companyId
    ? "Choose the company first."
    : series.data && series.data.items.length === 0
      ? "No series applies to this company on the purchase date. An administrator can add one (Admin > Master data > Membership number series)."
      : series.data && !series.data.default_id && !seriesId
        ? "More than one series applies: choose one."
        : chosenSeries
          ? `Picked from the company, sales venue, home property and purchase date.${chosenSeries.to_be_confirmed ? " Club8 has still to confirm this prefix." : ""}`
          : undefined;
  const e = errors as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const errorPaths = flatten(errors as Record<string, unknown>);
  const sectionHasError = (keys: readonly string[]) => errorPaths.some((p) => keys.some((k) => p === k || p.startsWith(`${k}.`)));

  const submit = form.handleSubmit(
    async (v) => {
      setServerError(null);
      try {
        await onSubmit(v);
      } catch (err) {
        setServerError(err);
        if (err instanceof ApiError && err.code === "ProbableDuplicate") form.setFocus("duplicate_override_reason");
      }
    },
    () => {
      setSubmitted(true);
      requestAnimationFrame(() => summaryRef.current?.focus());
    },
  );
  useSaveShortcut(() => formRef.current?.requestSubmit());

  // highlight the section in view in the mini table of contents
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: "-140px 0px -55% 0px" });
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  const opts = (rows?: { id: string; name: string; code?: string }[]) =>
    rows?.map((r) => <option key={r.id} value={r.id}>{r.code ? `${r.name} (${r.code})` : r.name}</option>);
  const auto = (explain: string) => <AutoTag explain={explain} />;

  const applicantBlock = (prefix: "applicant1" | "applicant2", kyc: typeof kyc1) => (
    <>
      <p className="col-span-full -mb-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">{prefix === "applicant1" ? "1st" : "2nd"} applicant</p>
      <Field label={`${prefix === "applicant1" ? "1st" : "2nd"} Applicant Name`} htmlFor={`${prefix}-name`} required error={e[prefix]?.full_name?.message} className="sm:col-span-2 lg:col-span-3">
        <Input id={`${prefix}-name`} autoCapitalize="words" {...register(`${prefix}.full_name` as const)} />
      </Field>
      <Field label="D.O.B" htmlFor={`${prefix}-dob`} required error={e[prefix]?.dob?.message} className="lg:col-span-1">
        <FormDateField id={`${prefix}-dob`} control={form.control} name={`${prefix}.dob` as const} max={todayIso()} />
      </Field>
      <Field label="Mobile (+91)" htmlFor={`${prefix}-mobile`} required={prefix === "applicant1"} error={e[prefix]?.mobile?.message} className="lg:col-span-2">
        <Input id={`${prefix}-mobile`} type="tel" inputMode="tel" {...register(`${prefix}.mobile` as const)} />
      </Field>
      <Field label="Applicant email (optional)" htmlFor={`${prefix}-email`} error={e[prefix]?.email?.message} className="sm:col-span-2 lg:col-span-3">
        <Input id={`${prefix}-email`} type="email" {...register(`${prefix}.email` as const)} />
      </Field>
      <fieldset className="col-span-full rounded-md border border-border bg-surface-sunken/40 p-3">
        <legend className="px-1 text-sm font-medium text-fg">KYC details ({prefix === "applicant1" ? "1st" : "2nd"} applicant)</legend>
        <div className="flex flex-col gap-2">
          {kyc.fields.map((f, i) => (
            <div key={f.id} id={`${prefix}-kyc-${i}`} className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_10rem_auto]">
              <Select aria-label="ID type" {...register(`${prefix}.kyc.${i}.id_type` as const)}>
                <option value="AADHAAR">Aadhaar (masked)</option>
                <option value="PAN">PAN Card</option>
                <option value="DL">Driver&apos;s Licence</option>
                <option value="PASSPORT">Passport</option>
                <option value="VOTER_ID">Voter ID</option>
              </Select>
              <div>
                <Input aria-label="ID number" autoComplete="off" spellCheck={false} className="font-mono uppercase" aria-invalid={!!e[prefix]?.kyc?.[i]?.value} {...register(`${prefix}.kyc.${i}.value` as const)} />
                {e[prefix]?.kyc?.[i]?.value && <p role="alert" className="mt-1 text-xs font-medium text-danger">{e[prefix].kyc[i].value.message}</p>}
              </div>
              <div>
                <FormDateField id={`${prefix}-kyc-${i}-expiry`} aria-label="Expiry (passport)" title="Passport expiry" control={form.control} name={`${prefix}.kyc.${i}.expiry_date` as const} />
                {e[prefix]?.kyc?.[i]?.expiry_date && <p role="alert" className="mt-1 text-xs font-medium text-danger">{e[prefix].kyc[i].expiry_date.message}</p>}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => kyc.remove(i)} aria-label={`Remove ID ${i + 1}`}><Trash2 aria-hidden /></Button>
            </div>
          ))}
          {e[prefix]?.kyc?.message && <p role="alert" className="text-xs font-medium text-danger">{e[prefix].kyc.message}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => kyc.append({ id_type: "PAN", value: "" })}><Plus aria-hidden />Add ID</Button>
            <p className="text-xs text-fg-subtle">Only the last 4 digits of Aadhaar are stored. Upload a masked Aadhaar copy only.</p>
          </div>
        </div>
      </fieldset>
    </>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="Form sections" className="hidden xl:block">
        <ol className="sticky top-24 flex flex-col gap-0.5">
          {SECTIONS.map((s) => {
            const bad = submitted && sectionHasError(s.keys);
            const current = activeSection === s.id;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={current ? "location" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    current ? "bg-primary-subtle font-medium text-primary" : "text-fg-muted hover:bg-surface-sunken hover:text-fg",
                  )}
                >
                  <span aria-hidden className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    bad ? "bg-danger text-fg-on-fill" : current ? "bg-primary text-fg-on-fill" : "bg-surface-sunken text-fg-muted",
                  )}>{bad ? "!" : s.n}</span>
                  <span className="min-w-0">{s.title}</span>
                  {bad && <span className="sr-only">(has errors)</span>}
                </a>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 flex items-center gap-1 px-2 text-xs text-fg-subtle"><Kbd>Ctrl</Kbd><Kbd>S</Kbd> to save</p>
      </nav>

      <form method="post" ref={formRef} onSubmit={submit} className="flex min-w-0 flex-col gap-4" noValidate>
        {submitted && errorPaths.length > 0 && (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-lg border border-danger/40 bg-danger-subtle p-4 outline-none">
            <p className="flex items-center gap-2 font-semibold text-fg"><AlertTriangle aria-hidden className="size-4 text-danger" />
              {errorPaths.length === 1 ? "1 field needs attention" : `${errorPaths.length} fields need attention`}
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {errorPaths.map((p) => {
                const [id, label] = fieldFor(p);
                return (
                  <li key={p}>
                    <a className="font-medium text-danger underline underline-offset-2" href={`#${id}`}
                      onClick={(ev) => { ev.preventDefault(); const el = document.getElementById(id); el?.scrollIntoView({ block: "center" }); (el?.matches("input,select,textarea") ? el : el?.querySelector<HTMLElement>("input,select,textarea"))?.focus(); }}>
                      {label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <Section n={1} id="sec-purchaser" title="Purchaser (Member) Details">
          {applicantBlock("applicant1", kyc1)}
          <div className="col-span-full">
            <Checkbox label="Add 2nd applicant" {...register("has_applicant2")} />
          </div>
          {watch("has_applicant2") && applicantBlock("applicant2", kyc2)}
          <p className="col-span-full -mb-1 mt-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Address and contact</p>
          <Field label="Address Line 1" htmlFor="addr1" required error={e.address?.line1?.message} className="sm:col-span-2 lg:col-span-4">
            <Input id="addr1" {...register("address.line1")} />
          </Field>
          <Field label="Address Line 2" htmlFor="addr2" className="sm:col-span-2 lg:col-span-2"><Input id="addr2" {...register("address.line2")} /></Field>
          <Field label="City" htmlFor="city" required error={e.address?.city?.message} className="lg:col-span-2"><Input id="city" {...register("address.city")} /></Field>
          <Field label="Post Code" htmlFor="pin" required={country?.toLowerCase() === "india"} error={e.address?.postcode?.message} className="lg:col-span-1">
            <Input id="pin" inputMode="numeric" maxLength={10} className="font-mono" {...register("address.postcode")} />
          </Field>
          <Field label="State" htmlFor="state" required={country?.toLowerCase() === "india"} error={e.address?.state?.message} className="lg:col-span-2">
            {country?.toLowerCase() === "india" ? (
              <Select id="state" {...register("address.state")}>
                <option value="">Select…</option>
                {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            ) : (
              <Input id="state" {...register("address.state")} />
            )}
          </Field>
          <Field label="Country" htmlFor="country" className="lg:col-span-1"><Input id="country" {...register("address.country")} /></Field>
          <Field label="Email" htmlFor="email" required error={e.email?.message} className="sm:col-span-2 lg:col-span-3"><Input id="email" type="email" {...register("email")} /></Field>
        </Section>

        <Section n={2} id="sec-membership" title="Membership Details">
          <Field
            label="Company / brand" htmlFor="company" required error={e.company_id?.message} className="sm:col-span-2 lg:col-span-3"
            hint={selectedBrand ? <span className="inline-flex items-center gap-1.5 text-fg"><BrandIcon brand={selectedBrand} size={20} decorative />{selectedBrand.name}</span> : undefined}
          >
            <Select id="company" {...register("company_id")}>
              <option value="">Select…</option>
              {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Sales venue (location)" htmlFor="venue" hint={venueFromLead ? "From the lead." : undefined} className="lg:col-span-3">
            <Select id="venue" disabled={venueFromLead} {...register("venue_id")}>
              <option value="">Not recorded</option>
              {venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </Field>
          <Field label="Home property (optional)" htmlFor="hprop" className="lg:col-span-3">
            <Select id="hprop" {...register("home_property_id")}>
              <option value="">None</option>
              {properties.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Membership number series" htmlFor="series" hint={seriesHint} error={e.number_series_id?.message} className="lg:col-span-3">
            <Select id="series" disabled={!series.data || series.data.items.length === 0} {...register("number_series_id")}>
              <option value="">{series.data?.items.length ? "Choose…" : "None available"}</option>
              {series.data?.items.map((s) => <option key={s.id} value={s.id}>{seriesLabel(s)}</option>)}
            </Select>
          </Field>
          <Field
            label="Membership Number" htmlFor="mnum" error={e.membership_number?.message} className="lg:col-span-3"
            hint={chosenSeries ? `Leave blank for the next number, ${chosenSeries.prefix}-${chosenSeries.next_number}. For an existing paper member, type the number part only.` : "Leave blank to auto-assign."}
          >
            <Input id="mnum" inputMode="numeric" className="font-mono" {...register("membership_number")} />
          </Field>
          <Field label="Purchase Date" htmlFor="pdate" required error={e.purchase_date?.message} className="lg:col-span-1"><FormDateField id="pdate" control={form.control} name="purchase_date" /></Field>
          <Field label="Tenure (Years)" htmlFor="tenure" required error={e.tenure_years?.message} className="lg:col-span-1"><Input id="tenure" type="number" min={1} {...register("tenure_years")} /></Field>
          <Field label="Start Year / First Year of Use" htmlFor="fy" required error={e.first_year_of_use?.message} className="lg:col-span-2"><Input id="fy" type="number" {...register("first_year_of_use")} /></Field>
          <Field label="Last Year of Use" htmlFor="ly" hint="Calculated: first year + tenure − 1" tag={auto("First year of use + tenure − 1")} className="lg:col-span-1">
            <Input id="ly" value={Number.isFinite(lastYear) ? lastYear : ""} readOnly tabIndex={-1} />
          </Field>
          <Field label="No. of Nights per Year" htmlFor="nights" required error={e.nights_per_year?.message} hint="Whole or half nights" className="lg:col-span-2"><Input id="nights" inputMode="decimal" {...register("nights_per_year")} /></Field>
          <Field label="Category (Membership Type)" htmlFor="cat" required error={e.resort_category_id?.message} className="lg:col-span-2">
            <Select id="cat" {...register("resort_category_id")}><option value="">Select…</option>{opts(categories.data)}</Select>
          </Field>
          <Field label="Season" htmlFor="season" required error={e.season_id?.message} className="lg:col-span-2">
            <Select id="season" {...register("season_id")}><option value="">Select…</option>{opts(seasons.data)}</Select>
          </Field>
          <Field label="Unit Type" htmlFor="unit" required error={e.unit_type_id?.message} className="sm:col-span-2 lg:col-span-2">
            <Select id="unit" {...register("unit_type_id")}>
              <option value="">Select…</option>
              {units.data?.map((u) => <option key={u.id} value={u.id}>{u.code} = {u.name} ({String(u.occupancy_text)})</option>)}
            </Select>
          </Field>
          <Field label="Annual Subscription Fee (current rate)" htmlFor="asf" hint="From the ASF rate table; charged per membership year at first booking" tag={auto("Current ASF rate for the selected unit type")} className="sm:col-span-2 lg:col-span-3">
            <Input id="asf" readOnly tabIndex={-1} value={asf ? `${formatMoney(String(asf.amount))} + GST` : unitId ? "No rate configured" : "Select unit type"} />
          </Field>
        </Section>

        <Section n={3} id="sec-payment" title="Payment Details">
          <Field label="Purchase Price" htmlFor="pp" required error={e.purchase_price?.message} hint={amountHint(pp)} className="lg:col-span-2">
            <PrefixInput prefix="₹" id="pp" inputMode="decimal" className="text-right" {...register("purchase_price")} />
          </Field>
          <Field label="Admin Fees" htmlFor="af" required error={e.admin_fees?.message} hint={amountHint(af)} className="lg:col-span-2">
            <PrefixInput prefix="₹" id="af" inputMode="decimal" className="text-right" {...register("admin_fees")} />
          </Field>
          <Field label="Total Purchase Price" htmlFor="tp" tag={auto("Purchase price + admin fees")} className="lg:col-span-2">
            <Input id="tp" readOnly tabIndex={-1} className="text-right font-semibold" value={formatMoney(total)} />
          </Field>
          <Field label="Down Payment" htmlFor="dp" required error={e.down_payment_amount?.message} hint={amountHint(dp)} className="lg:col-span-2">
            <PrefixInput prefix="₹" id="dp" inputMode="decimal" className="text-right" {...register("down_payment_amount")} />
          </Field>
          <Field label="By (payment method)" htmlFor="dpm" error={e.down_payment_method_id?.message} className="lg:col-span-2">
            <Select id="dpm" {...register("down_payment_method_id")}><option value="">Select…</option>{opts(methods.data)}</Select>
          </Field>
          <Field label="Balance" htmlFor="bal" tag={auto("Total purchase price − down payment")} className="lg:col-span-2">
            <Input id="bal" readOnly tabIndex={-1} className="text-right font-semibold" value={balance === "0.00" ? "NIL" : formatMoney(balance)} />
          </Field>
          <div className="col-span-full">
            <Checkbox label="Record the down payment in Finance now" {...register("record_down_payment")} />
          </div>
          {watch("record_down_payment") && (
            <>
              <Field label="Transaction / approval reference" htmlFor="dpref" className="sm:col-span-2 lg:col-span-3"><Input id="dpref" className="font-mono" {...register("down_payment_ref")} /></Field>
              <Field label="Card last 4 digits (optional)" htmlFor="last4" hint="Never enter the full card number" error={e.down_payment_card_last4?.message} className="lg:col-span-2">
                <Input id="last4" inputMode="numeric" maxLength={4} className="w-28 font-mono" {...register("down_payment_card_last4")} />
              </Field>
            </>
          )}
          <Field label="Balance Mode" htmlFor="bm" error={e.balance_mode?.message} className="col-span-full sm:col-span-1 lg:col-span-2">
            <Select id="bm" {...register("balance_mode")}>
              <option value="NONE">None (paid in full)</option><option value="EMI">EMI</option><option value="OTHER">Other</option>
            </Select>
          </Field>
          {watch("balance_mode") === "EMI" && (
            <>
              <Field label="EMI Amount" htmlFor="emi" error={e.emi_amount?.message} hint={amountHint(emiAmount)} className="lg:col-span-1">
                <PrefixInput prefix="₹" id="emi" inputMode="decimal" className="text-right" {...register("emi_amount")} />
              </Field>
              {/* the "EMI amount, number and starting month" rule reports on emi_amount, so re-check it when these change */}
              <Field label="No. of EMIs" htmlFor="emin" className="lg:col-span-1"><Input id="emin" type="number" min={1} {...register("emi_count", { deps: ["emi_amount"] })} /></Field>
              <Field label="Starting From (MM/YYYY)" htmlFor="emis" className="lg:col-span-2"><FormMonthField id="emis" control={form.control} name="emi_start" rules={{ deps: ["emi_amount"] }} /></Field>
            </>
          )}
          {watch("balance_mode") === "OTHER" && (
            <Field label="Balance arrangement" htmlFor="bo" className="sm:col-span-2 lg:col-span-4"><Input id="bo" {...register("balance_other_text")} /></Field>
          )}
        </Section>

        <Section n={4} id="sec-offer" title="Joining Offer">
          <div className="col-span-full flex flex-col gap-2">
            {offers.fields.length === 0 && <p className="text-base text-fg-muted">No joining offer on this application.</p>}
            {offers.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_7rem_auto]">
                <Select aria-label="Offer type" {...register(`joining_offers.${i}.offer_type_id` as const)}>{opts(offerTypes.data)}</Select>
                <Input aria-label="Offer description" placeholder="e.g. Goa 3N/4D" {...register(`joining_offers.${i}.description` as const)} />
                <Input aria-label="Bonus nights" placeholder="Nights" inputMode="decimal" className="text-right" {...register(`joining_offers.${i}.nights` as const)} />
                <Button type="button" variant="ghost" size="sm" onClick={() => offers.remove(i)} aria-label={`Remove offer line ${i + 1}`}><Trash2 aria-hidden /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="self-start"
              onClick={() => offers.append({ offer_type_id: offerTypes.data?.[0]?.id ?? "", description: "", nights: "" })}>
              <Plus aria-hidden />Add offer line
            </Button>
          </div>
        </Section>

        <Section n={5} id="sec-sales" title="Sales, Approval & Signatures">
          <Field label="Relationship Manager" htmlFor="rm" className="sm:col-span-1 lg:col-span-2">
            <Select id="rm" {...register("relationship_manager_id")}><option value="">Select…</option>{opts(staff.data?.map((s) => ({ id: s.id, name: s.full_name })))}</Select>
          </Field>
          <Field label="Team Manager" htmlFor="tm" className="sm:col-span-1 lg:col-span-2">
            <Select id="tm" {...register("team_manager_id")}><option value="">Select…</option>{opts(staff.data?.map((s) => ({ id: s.id, name: s.full_name })))}</Select>
          </Field>
          <Field label="Agreement signed date" htmlFor="asd" className="lg:col-span-2"><FormDateField id="asd" control={form.control} name="agreement_signed_date" /></Field>
          <fieldset className="col-span-full flex flex-wrap gap-x-6 gap-y-1">
            <legend className="mb-1 text-sm font-medium text-fg">Agreement signatures</legend>
            <Checkbox label="1st Applicant signed" {...register("agreement_signed_applicant1")} />
            <Checkbox label="2nd Applicant signed" {...register("agreement_signed_applicant2")} />
            <Checkbox label="Signed on behalf of the Company" {...register("agreement_signed_company")} />
          </fieldset>
          <Field label="Comments" htmlFor="comments" className="col-span-full"><Textarea id="comments" rows={3} {...register("comments")} /></Field>
        </Section>

        {serverError instanceof ApiError && serverError.code === "ProbableDuplicate" && (
          <Alert kind="warning" title="Possible duplicate found">
            Review the matches below. To save anyway, give a reason (it is logged).
            <Field label="Override reason" htmlFor="dup" className="mt-3 max-w-lg"><Input id="dup" {...register("duplicate_override_reason")} /></Field>
          </Alert>
        )}
        <ErrorText error={serverError} />
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
          <span className="mr-auto hidden text-sm text-fg-muted md:block">
            Total <strong className="font-semibold text-fg tabular-nums">{formatMoney(total)}</strong> · Balance <strong className="font-semibold text-fg tabular-nums">{balance === "0.00" ? "NIL" : formatMoney(balance)}</strong>
          </span>
          <Button type="submit" disabled={isSubmitting} className="h-10 min-w-40">{isSubmitting ? "Saving…" : submitLabel}</Button>
        </div>
      </form>
    </div>
  );
}
