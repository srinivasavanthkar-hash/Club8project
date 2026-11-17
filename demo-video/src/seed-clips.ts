/**
 * Seed data for the follow-up clips (docs/DEMO_CLIPS_PROMPT.md, section 1). Everything goes through the API, as the
 * staff roles would, on the run's throwaway database; all people and numbers are FICTITIOUS and labelled DEMO.
 *
 * Two states need help from the app itself (demo-video/seed_clock.py): the nightly overdue job (Rohan) and one
 * default notice dated in the past (Meera; approved option A, only that call sees the earlier date).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { type Api, PASSWORDS, PDF, TOTP_KEYS, addDays, apiAs, istToday, totpFor } from "./api";
import type { Shared } from "./scene";
import { PY, ROOT, type Stack } from "./stack";

type Member = { id: string; membership_number: string; version: number; status: string };
type Quote = { entitlement_nights: string; plan: { year: number; nights: string; kind: string }[]; blocking: string[]; window_warnings: string[]; asf: { membership_year: number; new: boolean }[] };
export type YearView = { year: number; used: string; on_hold: string; borrowed_out: string; remaining: string };

const n = (v: string | number) => Number(v);

/** A fictitious PAN in the right shape (5 letters, 4 digits, 1 letter), starting DEMO: never a real person's. */
const fakePan = (name: string, mobile: string) => `DEMO${name[0]!.toUpperCase()}${mobile.slice(-4)}Z`;
/** The month after `iso` (EMIs start next month by default). */
const nextMonth = (iso: string) => { const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)); return m === 12 ? { month: 1, year: y + 1 } : { month: m + 1, year: y }; };

// ---------------------------------------------------------------- members (lead -> convert -> agreement -> approve)
export type MemberOpts = {
  name: string; mobile: string; company?: "CLUB8" | "K8"; category?: string;
  /** purchase date and first EMI month (back-dated for an overdue member); defaults: today, next month */
  purchaseDate?: string; emiStart?: { month: number; year: number };
  pan?: string;
};

export async function createMember(o: MemberOpts): Promise<Member & { url: string }> {
  const today = istToday();
  const purchase = o.purchaseDate ?? today;
  const email = `${o.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
  const marketing = await apiAs("demo.marketing");
  const venue = await marketing.master("venues", "DEMO-MALL");
  let lead = await marketing.call<{ id: string; status: string }>("POST", "/leads", {
    prospect_name: o.name, mobile: o.mobile, whatsapp_same_as_mobile: true, email, city: "Bengaluru",
    venue_id: venue.id, opc_name: "Demo OPC", note: "DEMO data for the follow-up clips",
  });
  for (const [status, extra] of [["CONTACTED", {}], ["PRESENTATION_SCHEDULED", { presentation_at: `${today}T11:00:00` }], ["ATTENDED", {}]] as const) {
    lead = await marketing.call("POST", `/leads/${lead.id}/status`, { status, ...extra });
  }
  await marketing.dispose();

  const sales = await apiAs("demo.sales");
  const staff = Object.fromEntries((await sales.call<{ id: string; username: string }[]>("GET", "/admin/staff")).map((u) => [u.username, u]));
  const company = await sales.master("companies", o.company ?? "CLUB8");
  const cat = await sales.master("resort-categories", o.category ?? "PREMIUM");
  const season = await sales.master("seasons", "RED");
  const studio = await sales.master("unit-types", "T0");
  const card = await sales.master("payment-methods", "CARD");
  const start = o.emiStart ?? nextMonth(purchase);
  let member = await sales.call<Member>("POST", `/leads/${lead.id}/convert`, {
    applicant1: { full_name: o.name, dob: "1987-03-14", mobile: o.mobile, email, kyc: [{ id_type: "PAN", value: o.pan ?? fakePan(o.name, o.mobile) }] },
    address: { line1: "7 Demo Road", city: "Bengaluru", postcode: "560001", state: "Karnataka" },
    email, company_id: company.id, purchase_date: purchase, tenure_years: 10, first_year_of_use: Number(purchase.slice(0, 4)),
    resort_category_id: cat.id, season_id: season.id, unit_type_id: studio.id, nights_per_year: "7",
    purchase_price: "250000.00", admin_fees: "5000.00", down_payment_amount: "55000.00", down_payment_method_id: card.id,
    down_payment: { payment_date: purchase, transaction_ref: `DEMO-CARD-${o.mobile.slice(-4)}`, card_last4: "4242" },
    balance_mode: "EMI", emi_amount: "20000.00", emi_count: 10, emi_start_month: start.month, emi_start_year: start.year,
    relationship_manager_id: staff["demo.sales"]!.id, team_manager_id: staff["demo.team"]!.id,
    agreement_signed_applicant1: true, agreement_signed_company: true, agreement_signed_date: purchase,
  });
  const agreement = await sales.master("document-types", "MEMBERSHIP_AGREEMENT_SIGNED");
  await sales.upload(`/members/${member.id}/documents`, { document_type_id: agreement.id, description: "Signed agreement (DEMO)" },
    { name: "signed-agreement.pdf", mimeType: "application/pdf", buffer: PDF });
  await sales.dispose();

  const manager = await apiAs("demo.manager");
  member = await manager.call<Member>("POST", `/members/${member.id}/approve`, { comments: "DEMO approval" });
  await manager.dispose();
  if (member.status !== "ACTIVE") throw new Error(`${o.name} is ${member.status}, not ACTIVE`);
  return { ...member, url: `/members/${member.id}` };
}

export async function entitlementYears(memberId: string): Promise<Record<number, YearView>> {
  const api = await apiAs("demo.reservations");
  const e = await api.call<{ years: YearView[] }>("GET", `/members/${memberId}/entitlement`);
  await api.dispose();
  return Object.fromEntries(e.years.map((y) => [y.year, y]));
}

// ---------------------------------------------------------------- reservations
export type Booking = { check_in: string; check_out: string; adults?: number };

async function bookingBody(api: Api, b: Booking) {
  return {
    destination_id: (await api.master("destinations", "GOA")).id,
    property_id: (await api.master("properties", "GOA-DEMO-PREM")).id,
    unit_type_id: (await api.master("unit-types", "T0")).id,
    adults: b.adults ?? 2, child_ages: [], check_in: b.check_in, check_out: b.check_out,
  };
}

export async function quote(memberId: string, b: Booking): Promise<Quote> {
  const api = await apiAs("demo.reservations");
  const q = await api.call<Quote>("POST", `/members/${memberId}/reservations/quote`, await bookingBody(api, b));
  await api.dispose();
  return q;
}

/** Request -> approve -> (pay any ASF it raised) -> confirm. Returns the reservation id. */
export async function confirmedStay(memberId: string, b: Booking, confirmation: string): Promise<string> {
  const res = await apiAs("demo.reservations");
  const r = await res.call<{ id: string }>("POST", `/members/${memberId}/reservations`, await bookingBody(res, b));
  await res.call("POST", `/reservations/${r.id}/status`, { to_status: "APPROVED" });
  const detail = await res.call<{ asf_charges: { id: string; base: string; status: string }[] }>("GET", `/reservations/${r.id}`);
  const unpaid = detail.asf_charges.filter((a) => a.status === "RAISED");
  if (unpaid.length) {
    const fin = await apiAs("demo.finance");
    const card = await fin.master("payment-methods", "CARD");
    for (const a of unpaid) {
      await fin.call("POST", `/members/${memberId}/payments`, {
        payment_type_code: "ASF", base_amount: a.base, payment_date: istToday(), payment_method_id: card.id,
        transaction_ref: `DEMO-ASF-${confirmation}`, card_last4: "4242", asf_charge_id: a.id, reservation_id: r.id,
      });
    }
    await fin.dispose();
  }
  await res.call("POST", `/reservations/${r.id}/status`, { to_status: "CONFIRMED", confirmation_number: confirmation });
  await res.dispose();
  return r.id;
}

// ---------------------------------------------------------------- clip 1: Kavya's dates
/**
 * All of clip 1 must fall in one membership year Y (a stay's nights count against its check-in year), at least 7
 * working days ahead (14 calendar days), with the latest date (the 4-night request) by 31 December. Recording by
 * about 22 November that is December of this year, exactly as in the storyboard ("borrow from next year"); later in
 * the year everything moves to February of next year (the next-year fallback).
 *
 *   stay A    B      .. B+2    2 nights, confirmed     \ 5 of Y's 7 nights used: 2 left
 *   stay B    B+7    .. B+10   3 nights, confirmed     /  (rescheduled in the clip to B+14 .. B+17)
 *   request   B+21   .. B+25   4 nights in the clip: 2 from Y + 2 borrowed from Y+1
 *   window    today+3          the booking-window warning (not submitted)
 */
export function kavyaDates(today = istToday()) {
  let base = addDays(today, 14);
  const fits = addDays(base, 25).slice(0, 4) === today.slice(0, 4);
  if (!fits) base = `${Number(today.slice(0, 4)) + 1}-02-02`;
  const year = Number(base.slice(0, 4));
  return {
    year, nextYear: year + 1, fallback: !fits,
    stayA: { check_in: base, check_out: addDays(base, 2) },
    stayB: { check_in: addDays(base, 7), check_out: addDays(base, 10) },
    stayBMoved: { check_in: addDays(base, 14), check_out: addDays(base, 17) },
    request: { check_in: addDays(base, 21), check_out: addDays(base, 25) },
    tooSoon: { check_in: addDays(today, 3), check_out: addDays(today, 5) },
  };
}

export async function seedKavya(): Promise<Shared> {
  const dates = kavyaDates();
  const kavya = await createMember({ name: "Kavya Demo", mobile: "9000000101" });
  // the clip's numbers depend on the season calendar: check them before recording anything
  const qa = await quote(kavya.id, dates.stayA);
  const qb = await quote(kavya.id, dates.stayB);
  if (n(qa.entitlement_nights) + n(qb.entitlement_nights) !== 5) throw new Error(`Kavya's stays deduct ${qa.entitlement_nights} + ${qb.entitlement_nights}, not 5 nights`);
  const stayA = await confirmedStay(kavya.id, dates.stayA, "GOA-51207");
  const stayB = await confirmedStay(kavya.id, dates.stayB, "GOA-51388");
  const years = await entitlementYears(kavya.id);
  if (n(years[dates.year]!.remaining) !== 2) throw new Error(`Kavya has ${years[dates.year]!.remaining} nights left in ${dates.year}, not 2`);
  const q = await quote(kavya.id, dates.request);
  const borrowed = q.plan.filter((p) => p.year === dates.nextYear).reduce((s, p) => s + n(p.nights), 0);
  if (n(q.entitlement_nights) !== 4 || borrowed !== 2 || q.blocking.length || q.window_warnings.length) {
    throw new Error(`the 4-night request does not split 2 + 2 borrowed: ${JSON.stringify(q)}`);
  }
  if (!q.asf.some((a) => a.membership_year === dates.nextYear && a.new)) throw new Error(`the request does not raise ASF ${dates.nextYear}`);
  return { kavya, kavyaStays: { stayA, stayB }, dates };
}

// ---------------------------------------------------------------- clip 2: money
type Instalment = { number: number; due_date: string; amount_due: string; amount_paid: string; status: string };

/** Overdue amount from the member's schedule (due before today, not fully paid): what the screens must show. */
export async function overdueFromSchedule(memberId: string): Promise<{ amount: number; instalments: Instalment[] }> {
  const api = await apiAs("demo.finance");
  const s = await api.call<{ instalments: Instalment[] }>("GET", `/members/${memberId}/schedule`);
  await api.dispose();
  const today = istToday();
  const overdue = s.instalments.filter((i) => i.due_date < today && n(i.amount_paid) < n(i.amount_due));
  return { amount: overdue.reduce((t, i) => t + n(i.amount_due) - n(i.amount_paid), 0), instalments: overdue };
}

export async function seedClip2(stack: Stack): Promise<Shared> {
  const today = istToday();
  const kavya = await seedKavya(); // the booking fee goes on her confirmed December stay
  // bought about 4 months ago, EMIs from about 45 days ago: EMI 1 more than 30 days overdue (and already overdue
  // 20 days ago, which Meera's back-dated notice needs). Past purchase and EMI dates are accepted by the API.
  const backdated = { purchaseDate: addDays(today, -120), emiStart: (() => { const d = addDays(today, -45); return { month: Number(d.slice(5, 7)), year: Number(d.slice(0, 4)) }; })() };
  const rohan = await createMember({ name: "Rohan Demo", mobile: "9000000102", ...backdated });
  const meera = await createMember({ name: "Meera Demo", mobile: "9000000103", ...backdated });
  const fin = await apiAs("demo.finance");
  for (const m of [rohan, meera]) await fin.call("POST", `/members/${m.id}/schedule`, {});
  await fin.dispose();
  console.log(`    ${seedClock(stack, ["mark-overdue"])}`);
  console.log(`    Meera: ${seedClock(stack, ["default-notice", meera.id, "20", "demo.finance"])}`);
  const arjun = await createMember({ name: "Arjun Demo", mobile: "9000000104", company: "K8" });

  const rohanOverdue = await overdueFromSchedule(rohan.id);
  if (!rohanOverdue.instalments.some((i) => i.number === 1 && i.due_date <= addDays(today, -31))) throw new Error("Rohan's EMI 1 is not more than 30 days overdue");
  if (rohanOverdue.instalments.some((i) => i.status !== "OVERDUE")) throw new Error("the overdue job did not mark Rohan's past-due instalments OVERDUE");
  const man = await apiAs("demo.manager");
  const meeraNow = await man.call<{ status: string }>("GET", `/members/${meera.id}`);
  const notices = await man.call<{ issued_on: string; deadline: string; status: string; document_id: string | null }[]>("GET", `/members/${meera.id}/default-notices`);
  await man.dispose();
  if (meeraNow.status !== "DEFAULT_NOTICE" || !notices.some((x) => x.status === "OPEN" && x.deadline < today && x.document_id)) {
    throw new Error(`Meera is not ready to terminate: ${meeraNow.status}, ${JSON.stringify(notices)}`);
  }
  await requireIntactActivityLog("after seeding clip 2 (Meera's back-dated notice)");
  return { ...kavya, rohan, meera, arjun, rohanOverdue: rohanOverdue.amount };
}

// ---------------------------------------------------------------- clip 3: control and admin
/** A new administrator as staff would set it up: temporary password -> own password (-> two-step verification).
 * The credentials exist only in this run's throwaway database and in memory (api.ts PASSWORDS / TOTP_KEYS). */
async function activateAdmin(username: string, temporary: string, password: string, enrol2fa: boolean): Promise<void> {
  PASSWORDS[username] = temporary;
  let api = await apiAs(username);
  await api.call("POST", "/auth/change-password", { current_password: temporary, new_password: password });
  await api.dispose();
  PASSWORDS[username] = password;
  if (!enrol2fa) return;
  api = await apiAs(username);
  const { otpauth_uri } = await api.call<{ otpauth_uri: string }>("POST", "/auth/totp/setup");
  const secret = new URL(otpauth_uri).searchParams.get("secret")!;
  await api.call("POST", "/auth/totp/confirm", { code: totpFor(secret) });
  await api.dispose();
  TOTP_KEYS[username] = secret;
}

export async function seedClip3(): Promise<Shared> {
  const today = istToday();
  const neel = await createMember({ name: "Neel Demo", mobile: "9000000105", pan: "DEMON0105Z" });
  const admin = await apiAs("demo.admin");
  const created: Record<string, string> = {};
  for (const [username, full] of [["demo.admin2", "Demo Second Administrator"], ["demo.admin3", "Demo Third Administrator"]] as const) {
    const u = await admin.call<{ temporary_password: string }>("POST", "/admin/users", { username, full_name: full, roles: ["ADMIN"], email: `${username}@example.test` });
    created[username] = u.temporary_password;
  }
  // a new dated ASF rate 10% above the current Studio rate, from next year: above the 5% cap
  const rates = await admin.call<Record<string, unknown>[]>("GET", "/admin/master/asf-rates");
  const t0 = await admin.master("unit-types", "T0");
  await admin.dispose();
  const current = rates.filter((r) => r.unit_type_id === t0.id && r.is_active !== false)
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
  if (!current) throw new Error("no current ASF rate for Studio (T0)");
  let from = `${Number(today.slice(0, 4)) + 1}-01-01`;
  if (String(current.effective_from) >= from) from = `${Number(String(current.effective_from).slice(0, 4)) + 1}-01-01`;
  const keep = Object.fromEntries(Object.entries(current).filter(([k]) => !["id", "is_active", "effective_to", "override_reason", "created_at", "updated_at", "created_by", "updated_by", "version"].includes(k)));
  const asfDraft = { ...keep, amount: (n(String(current.amount)) * 1.1).toFixed(2), effective_from: from };

  await activateAdmin("demo.admin2", created["demo.admin2"]!, "Teal-Harbour-Lantern-4821", true);
  await activateAdmin("demo.admin3", created["demo.admin3"]!, "Copper-Meadow-Violin-7305", false);
  return { neel, asfDraft, asfCurrent: String(current.amount) };
}

/** Condition of option A: the activity log must still verify with the back-dated notice in it. If not: stop, no
 * workaround (the owner decides what to do). */
export async function requireIntactActivityLog(when: string): Promise<void> {
  const v = await verifyActivityLog();
  if (!v.ok) {
    throw new Error(`STOP: the activity-log integrity check FAILED ${when}: ${v.message ?? JSON.stringify(v)}. ` +
      "Not working around it: report to the owner before recording.");
  }
  console.log(`    activity log integrity: hash chain intact (${v.checked} entries) ${when}`);
}

// ---------------------------------------------------------------- the app's own clock-dependent steps
/** demo-video/seed_clock.py against this run's database (see its docstring for the safeguards). */
export function seedClock(stack: Stack, args: string[]): string {
  return execFileSync(PY, [path.join(ROOT, "demo-video", "seed_clock.py"), ...args], {
    cwd: path.join(ROOT, "backend"), env: { ...stack.apiEnv, PYTHONPATH: "." }, encoding: "utf8",
  }).trim();
}

/** The activity log's hash chain, checked by the app itself (POST /activity-log/verify) as an administrator. */
export async function verifyActivityLog(): Promise<{ ok: boolean; checked: number; message?: string }> {
  const admin = await apiAs("demo.admin");
  const v = await admin.call<{ ok: boolean; checked: number; message?: string }>("POST", "/activity-log/verify");
  await admin.dispose();
  return v;
}
