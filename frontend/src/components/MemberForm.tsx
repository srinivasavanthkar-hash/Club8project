"use client";
/* Member application form. Section order mirrors the paper Membership Application Form so staff can key in
 * from the scanned form top to bottom (docs/FORM_MAPPING.md). */
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { ErrorText, useMaster, useStaff } from "@/components/providers";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { addMoney, formatMoney, subMoney, todayIso } from "@/lib/format";
import { aadhaarSchema, isAdult, mobileSchema, moneySchema, optionalMobile, panSchema, pinSchema } from "@/lib/validation";

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

const Section = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <Card title={`${n}. ${title}`}>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">{children}</div>
  </Card>
);

export function MemberForm({
  defaults, onSubmit, submitLabel,
}: { defaults?: Partial<MemberFormValues>; onSubmit: (v: MemberFormValues) => Promise<void>; submitLabel: string }) {
  const companies = useMaster("companies");
  const categories = useMaster("resort-categories");
  const seasons = useMaster("seasons");
  const units = useMaster("unit-types");
  const methods = useMaster("payment-methods");
  const offerTypes = useMaster("joining-offer-types");
  const asfRates = useMaster("asf-rates");
  const staff = useStaff();
  const [serverError, setServerError] = useState<unknown>(null);
  const year = Number(todayIso().slice(0, 4));

  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
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

  const [pp, af, dp, unitId, tenure, firstYear, country] = watch([
    "purchase_price", "admin_fees", "down_payment_amount", "unit_type_id", "tenure_years", "first_year_of_use", "address.country",
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
  const e = errors as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  const submit = form.handleSubmit(async (v) => {
    setServerError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setServerError(err);
      if (err instanceof ApiError && err.code === "ProbableDuplicate") form.setFocus("duplicate_override_reason");
    }
  });

  const opts = (rows?: { id: string; name: string; code?: string }[]) =>
    rows?.map((r) => <option key={r.id} value={r.id}>{r.code ? `${r.name} (${r.code})` : r.name}</option>);

  const applicantBlock = (prefix: "applicant1" | "applicant2", kyc: typeof kyc1) => (
    <>
      <Field label={`${prefix === "applicant1" ? "1st" : "2nd"} Applicant Name`} htmlFor={`${prefix}-name`} error={e[prefix]?.full_name?.message}>
        <Input id={`${prefix}-name`} {...register(`${prefix}.full_name` as const)} />
      </Field>
      <Field label="D.O.B" htmlFor={`${prefix}-dob`} error={e[prefix]?.dob?.message}>
        <Input id={`${prefix}-dob`} type="date" {...register(`${prefix}.dob` as const)} />
      </Field>
      <Field label="Mobile (+91)" htmlFor={`${prefix}-mobile`} error={e[prefix]?.mobile?.message}>
        <Input id={`${prefix}-mobile`} inputMode="tel" {...register(`${prefix}.mobile` as const)} />
      </Field>
      <Field label="Applicant email (optional)" htmlFor={`${prefix}-email`} error={e[prefix]?.email?.message}>
        <Input id={`${prefix}-email`} type="email" {...register(`${prefix}.email` as const)} />
      </Field>
      <div className="col-span-full">
        <p className="mb-2 text-sm font-medium">KYC details ({prefix === "applicant1" ? "1st" : "2nd"} applicant)</p>
        {kyc.fields.map((f, i) => (
          <div key={f.id} className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_10rem_auto]">
            <Select aria-label="ID type" {...register(`${prefix}.kyc.${i}.id_type` as const)}>
              <option value="AADHAAR">Aadhaar (masked)</option>
              <option value="PAN">PAN Card</option>
              <option value="DL">Driver&apos;s Licence</option>
              <option value="PASSPORT">Passport</option>
              <option value="VOTER_ID">Voter ID</option>
            </Select>
            <div>
              <Input aria-label="ID number" autoComplete="off" {...register(`${prefix}.kyc.${i}.value` as const)} />
              {e[prefix]?.kyc?.[i]?.value && <p role="alert" className="text-xs text-destructive">{e[prefix].kyc[i].value.message}</p>}
            </div>
            <Input aria-label="Expiry (passport)" type="date" {...register(`${prefix}.kyc.${i}.expiry_date` as const)} />
            <Button type="button" variant="ghost" size="sm" onClick={() => kyc.remove(i)}>Remove</Button>
          </div>
        ))}
        {e[prefix]?.kyc?.message && <p role="alert" className="text-xs text-destructive">{e[prefix].kyc.message}</p>}
        <Button type="button" variant="outline" size="sm" onClick={() => kyc.append({ id_type: "PAN", value: "" })}>Add ID</Button>
        <p className="mt-1 text-xs text-muted-foreground">Only the last 4 digits of Aadhaar are stored. Upload a masked Aadhaar copy only.</p>
      </div>
    </>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Section n={1} title="Purchaser (Member) Details">
        {applicantBlock("applicant1", kyc1)}
        <label className="col-span-full flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("has_applicant2")} /> Add 2nd applicant
        </label>
        {watch("has_applicant2") && applicantBlock("applicant2", kyc2)}
        <Field label="Address Line 1" htmlFor="addr1" error={e.address?.line1?.message} className="md:col-span-2">
          <Input id="addr1" {...register("address.line1")} />
        </Field>
        <Field label="Address Line 2" htmlFor="addr2"><Input id="addr2" {...register("address.line2")} /></Field>
        <Field label="City" htmlFor="city" error={e.address?.city?.message}><Input id="city" {...register("address.city")} /></Field>
        <Field label="Post Code" htmlFor="pin" error={e.address?.postcode?.message}><Input id="pin" inputMode="numeric" {...register("address.postcode")} /></Field>
        <Field label="State" htmlFor="state" error={e.address?.state?.message}>
          {country?.toLowerCase() === "india" ? (
            <Select id="state" {...register("address.state")}>
              <option value="">Select…</option>
              {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          ) : (
            <Input id="state" {...register("address.state")} />
          )}
        </Field>
        <Field label="Country" htmlFor="country"><Input id="country" {...register("address.country")} /></Field>
        <Field label="Email" htmlFor="email" error={e.email?.message}><Input id="email" type="email" {...register("email")} /></Field>
      </Section>

      <Section n={2} title="Membership Details">
        <Field label="Company / brand" htmlFor="company" error={e.company_id?.message}>
          <Select id="company" {...register("company_id")}>
            <option value="">Select…</option>
            {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name} ({String(c.membership_prefix)}-)</option>)}
          </Select>
        </Field>
        <Field label="Membership Number" htmlFor="mnum" hint="Leave blank to auto-assign" error={e.membership_number?.message}>
          <Input id="mnum" inputMode="numeric" {...register("membership_number")} />
        </Field>
        <Field label="Purchase Date" htmlFor="pdate" error={e.purchase_date?.message}><Input id="pdate" type="date" {...register("purchase_date")} /></Field>
        <Field label="Tenure (Years)" htmlFor="tenure" error={e.tenure_years?.message}><Input id="tenure" type="number" {...register("tenure_years")} /></Field>
        <Field label="Start Year / First Year of Use" htmlFor="fy" error={e.first_year_of_use?.message}><Input id="fy" type="number" {...register("first_year_of_use")} /></Field>
        <Field label="Last Year of Use" htmlFor="ly" hint="Calculated: first year + tenure − 1"><Input id="ly" value={Number.isFinite(lastYear) ? lastYear : ""} readOnly /></Field>
        <Field label="Category (Membership Type)" htmlFor="cat" error={e.resort_category_id?.message}>
          <Select id="cat" {...register("resort_category_id")}><option value="">Select…</option>{opts(categories.data)}</Select>
        </Field>
        <Field label="Season" htmlFor="season" error={e.season_id?.message}>
          <Select id="season" {...register("season_id")}><option value="">Select…</option>{opts(seasons.data)}</Select>
        </Field>
        <Field label="Unit Type" htmlFor="unit" error={e.unit_type_id?.message}>
          <Select id="unit" {...register("unit_type_id")}>
            <option value="">Select…</option>
            {units.data?.map((u) => <option key={u.id} value={u.id}>{u.code} = {u.name} ({String(u.occupancy_text)})</option>)}
          </Select>
        </Field>
        <Field label="No. of Nights per Year" htmlFor="nights" error={e.nights_per_year?.message}><Input id="nights" inputMode="decimal" {...register("nights_per_year")} /></Field>
        <Field label="Annual Subscription Fee (current rate)" htmlFor="asf" hint="From the ASF rate table; charged per membership year at first booking">
          <Input id="asf" readOnly value={asf ? `${formatMoney(String(asf.amount))} + GST` : unitId ? "No rate configured" : "Select unit type"} />
        </Field>
      </Section>

      <Section n={3} title="Payment Details">
        <Field label="Purchase Price" htmlFor="pp" error={e.purchase_price?.message}><Input id="pp" inputMode="decimal" {...register("purchase_price")} /></Field>
        <Field label="Admin Fees" htmlFor="af" error={e.admin_fees?.message}><Input id="af" inputMode="decimal" {...register("admin_fees")} /></Field>
        <Field label="Total Purchase Price" htmlFor="tp"><Input id="tp" readOnly value={formatMoney(total)} /></Field>
        <Field label="Down Payment" htmlFor="dp" error={e.down_payment_amount?.message}><Input id="dp" inputMode="decimal" {...register("down_payment_amount")} /></Field>
        <Field label="By (payment method)" htmlFor="dpm" error={e.down_payment_method_id?.message}>
          <Select id="dpm" {...register("down_payment_method_id")}><option value="">Select…</option>{opts(methods.data)}</Select>
        </Field>
        <Field label="Balance" htmlFor="bal"><Input id="bal" readOnly value={balance === "0.00" ? "NIL" : formatMoney(balance)} /></Field>
        <label className="col-span-full flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("record_down_payment")} /> Record the down payment in Finance now
        </label>
        {watch("record_down_payment") && (
          <>
            <Field label="Transaction / approval reference" htmlFor="dpref"><Input id="dpref" {...register("down_payment_ref")} /></Field>
            <Field label="Card last 4 digits (optional)" htmlFor="last4" hint="Never enter the full card number" error={e.down_payment_card_last4?.message}>
              <Input id="last4" inputMode="numeric" maxLength={4} {...register("down_payment_card_last4")} />
            </Field>
          </>
        )}
        <Field label="Balance Mode" htmlFor="bm" error={e.balance_mode?.message}>
          <Select id="bm" {...register("balance_mode")}>
            <option value="NONE">None (paid in full)</option><option value="EMI">EMI</option><option value="OTHER">Other</option>
          </Select>
        </Field>
        {watch("balance_mode") === "EMI" && (
          <>
            <Field label="EMI Amount" htmlFor="emi" error={e.emi_amount?.message}><Input id="emi" inputMode="decimal" {...register("emi_amount")} /></Field>
            <Field label="No. of EMIs" htmlFor="emin"><Input id="emin" type="number" {...register("emi_count")} /></Field>
            <Field label="Starting From (MM/YYYY)" htmlFor="emis"><Input id="emis" type="month" {...register("emi_start")} /></Field>
          </>
        )}
        {watch("balance_mode") === "OTHER" && (
          <Field label="Balance arrangement" htmlFor="bo" className="md:col-span-2"><Input id="bo" {...register("balance_other_text")} /></Field>
        )}
      </Section>

      <Section n={4} title="Joining Offer">
        <div className="col-span-full flex flex-col gap-2">
          {offers.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr_7rem_auto]">
              <Select aria-label="Offer type" {...register(`joining_offers.${i}.offer_type_id` as const)}>{opts(offerTypes.data)}</Select>
              <Input aria-label="Offer description" placeholder="e.g. Goa 3N/4D" {...register(`joining_offers.${i}.description` as const)} />
              <Input aria-label="Bonus nights" placeholder="Nights" inputMode="decimal" {...register(`joining_offers.${i}.nights` as const)} />
              <Button type="button" variant="ghost" size="sm" onClick={() => offers.remove(i)}>Remove</Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="self-start"
            onClick={() => offers.append({ offer_type_id: offerTypes.data?.[0]?.id ?? "", description: "", nights: "" })}>
            Add offer line
          </Button>
        </div>
      </Section>

      <Section n={5} title="Sales, Approval & Signatures">
        <Field label="Relationship Manager" htmlFor="rm">
          <Select id="rm" {...register("relationship_manager_id")}><option value="">Select…</option>{opts(staff.data?.map((s) => ({ id: s.id, name: s.full_name })))}</Select>
        </Field>
        <Field label="Team Manager" htmlFor="tm">
          <Select id="tm" {...register("team_manager_id")}><option value="">Select…</option>{opts(staff.data?.map((s) => ({ id: s.id, name: s.full_name })))}</Select>
        </Field>
        <Field label="Agreement signed date" htmlFor="asd"><Input id="asd" type="date" {...register("agreement_signed_date")} /></Field>
        <div className="col-span-full flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" {...register("agreement_signed_applicant1")} /> 1st Applicant signed</label>
          <label className="flex items-center gap-2"><input type="checkbox" {...register("agreement_signed_applicant2")} /> 2nd Applicant signed</label>
          <label className="flex items-center gap-2"><input type="checkbox" {...register("agreement_signed_company")} /> Signed on behalf of the Company</label>
        </div>
        <Field label="Comments" htmlFor="comments" className="col-span-full"><Textarea id="comments" {...register("comments")} /></Field>
      </Section>

      {serverError instanceof ApiError && serverError.code === "ProbableDuplicate" && (
        <Alert kind="warning">
          Possible duplicate found. Review the matches below. To save anyway, give a reason (it is logged).
          <Field label="Override reason" htmlFor="dup" className="mt-2"><Input id="dup" {...register("duplicate_override_reason")} /></Field>
        </Alert>
      )}
      <ErrorText error={serverError} />
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background py-3">
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}
