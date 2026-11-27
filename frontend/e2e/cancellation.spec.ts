/**
 * Cancelling a confirmed reservation (docs/DECISIONS.md D-31 to D-34), FICTITIOUS data only.
 * The confirmed booking is set up through the API; the member's email and the cancellation are done in the UI.
 */
import { type APIRequestContext, type Page } from "@playwright/test";
import { expect, istToday, test } from "./support/clock";
import { requireIsolatedStack } from "./support/stack";

const PASSWORD = process.env.CRM_DEMO_PASSWORD ?? "Demo-Passw0rd!";
const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test.beforeAll(requireIsolatedStack); // creates members and reservations: never against the demo database

/** A random, fictitious PAN in the valid format (AAAPA9999A, 4th letter P = individual). */
function fakePan(): string {
  const L = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${L()}${L()}${L()}P${L()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}${L()}`;
}

function istDay(offsetDays = 0): string {
  return istToday(offsetDays); // the fixed business date (support/clock.ts)
}

/** API calls as `user`, sharing the browser context's cookies (CSRF double-submit header included). */
async function apiAs(page: Page, user: string) {
  const req: APIRequestContext = page.request;
  await page.context().clearCookies();
  const login = await req.post("/api/v1/auth/login", { data: { username: user, password: PASSWORD } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const csrf = (await page.context().cookies()).find((c) => c.name === "crm_csrf")?.value ?? "";
  const call = async <T,>(method: "GET" | "POST", path: string, data?: unknown, multipart?: Record<string, unknown>): Promise<T> => {
    const r = await req.fetch(`/api/v1${path}`, { method, headers: { "X-CSRF-Token": csrf }, data, multipart: multipart as never });
    expect(r.ok(), `${method} ${path}: ${await r.text()}`).toBeTruthy();
    return (await r.json()) as T;
  };
  const master = async (slug: string, code: string) =>
    (await call<{ id: string; code: string }[]>("GET", `/admin/master/${slug}`)).find((x) => x.code === code)!;
  return { call, master };
}

async function login(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(user);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("confirmed reservation: member's email → cancel → nights credited and forfeited, letter generated", async ({ page }) => {
  const checkIn = istDay(25); // 15–30 days' notice → 50%
  const year = Number(checkIn.slice(0, 4));

  // ---- set-up through the API: active member, confirmed 4-night booking with ASF paid, voucher issued
  let a = await apiAs(page, "demo.sales");
  const n = Math.floor(Math.random() * 900_000) + 100_000;
  const member = await a.call<{ id: string; email: string }>("POST", "/members", {
    applicant1: { full_name: `Cancel Demo ${tag}`, dob: "1982-03-04", mobile: `97${String(Date.now()).slice(-8)}`, kyc: [{ id_type: "PAN", value: fakePan() }] },
    address: { line1: "2 Demo Street", city: "Mysuru", postcode: "570001", state: "Karnataka" },
    email: `cancel.${tag.toLowerCase()}@example.com`,
    company_id: (await a.master("companies", "CLUB8")).id,
    purchase_date: istDay(),
    tenure_years: 10,
    first_year_of_use: Number(istDay().slice(0, 4)),
    resort_category_id: (await a.master("resort-categories", "PREMIUM")).id,
    season_id: (await a.master("seasons", "RED")).id,
    unit_type_id: (await a.master("unit-types", "T0")).id,
    nights_per_year: "7",
    purchase_price: "100000.00",
    admin_fees: "0.00",
    down_payment_amount: "100000.00",
    down_payment_method_id: (await a.master("payment-methods", "CARD")).id,
    down_payment: { payment_date: istDay(), transaction_ref: `DP-${n}`, card_last4: "1111" },
    balance_mode: "NONE",
  });
  await a.call("POST", `/members/${member.id}/documents`, undefined, {
    document_type_id: (await a.master("document-types", "MEMBERSHIP_AGREEMENT_SIGNED")).id,
    file: { name: "agreement.pdf", mimeType: "application/pdf", buffer: PDF },
  });
  a = await apiAs(page, "demo.manager");
  await a.call("POST", `/members/${member.id}/approve`, {});
  a = await apiAs(page, "demo.reservations");
  const res = await a.call<{ id: string; reservation_number: string }>("POST", `/members/${member.id}/reservations`, {
    destination_id: (await a.master("destinations", "GOA")).id,
    property_id: (await a.master("properties", "GOA-DEMO-PREM")).id,
    unit_type_id: (await a.master("unit-types", "T0")).id,
    adults: 2,
    check_in: checkIn,
    check_out: istDay(29),
  });
  await a.call("POST", `/reservations/${res.id}/status`, { to_status: "APPROVED" });
  const detail = await a.call<{ asf_charges: { id: string; base: string }[] }>("GET", `/reservations/${res.id}`);
  a = await apiAs(page, "demo.finance");
  for (const c of detail.asf_charges) {
    await a.call("POST", `/members/${member.id}/payments`, {
      payment_type_code: "ASF", base_amount: c.base, payment_date: istDay(),
      payment_method_id: (await a.master("payment-methods", "CARD")).id, transaction_ref: `ASF-${tag}`, asf_charge_id: c.id,
    });
  }
  a = await apiAs(page, "demo.reservations");
  await a.call("POST", `/reservations/${res.id}/status`, { to_status: "CONFIRMED", confirmation_number: `CNF-${tag}` });
  await a.call("POST", `/reservations/${res.id}/voucher`);

  // from here on the browser drives the app: any failed API call is a bug
  const apiErrors: string[] = [];
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/v1/")) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

  // ---- the member's email asking to cancel, logged by member services
  await login(page, "demo.service");
  await page.goto(`/members/${member.id}?tab=correspondence`);
  await page.getByLabel("To (comma separated)", { exact: true }).fill("reservations@example.com");
  await page.getByLabel("Subject", { exact: true }).fill("Please cancel my Goa stay");
  await page.getByLabel("Body", { exact: true }).fill("Sorry, we can't travel in December. Please cancel. (demo)");
  await page.getByRole("button", { name: "Add email" }).click();
  await expect(page.getByText("Please cancel my Goa stay (1)")).toBeVisible();

  // ---- reservations cancels: picks the email, sees the outcome first, then cancels
  await login(page, "demo.reservations");
  await page.goto(`/reservations/${res.id}`);
  await page.getByLabel("Decline / cancel reason", { exact: true }).selectOption({ label: "Member request" });
  await page.getByLabel("Explanation", { exact: true }).fill("Member cannot travel");
  const picker = page.getByLabel("Member's written request", { exact: true });
  await expect(picker.locator("option", { hasText: "Email: Please cancel my Goa stay" })).toHaveCount(1);
  await picker.selectOption({ label: `${istDay().split("-").reverse().join("-")} · Email: Please cancel my Goa stay` });
  await expect(page.getByLabel("Cancellation date", { exact: true })).toHaveValue(istDay().split("-").reverse().join("-")); // DD-MM-YYYY
  const outcome = "25 days' notice → 50%: 2.0 nights credited, 2.0 forfeited";
  await expect(page.getByText(outcome).first()).toBeVisible();
  await page.getByRole("button", { name: "Cancel reservation…" }).click();
  const dlg = page.getByRole("dialog", { name: "Cancel this reservation?" });
  await expect(dlg.getByText(outcome)).toBeVisible();
  await dlg.getByRole("button", { name: "Cancel reservation" }).click();

  await expect(page.getByText("CANCELLED", { exact: true }).first()).toBeVisible();
  const card = page.locator("section", { hasText: "Cancellation date" }).first();
  await expect(card.getByText(outcome)).toBeVisible();
  await expect(card.getByText("Email “Please cancel my Goa stay”")).toBeVisible();
  const docs = page.locator("section", { hasText: "Letters and vouchers" });
  const voucher = docs.getByRole("listitem").filter({ hasText: "Voucher" });
  await expect(voucher.getByText("CANCELLED", { exact: true })).toBeVisible();
  await docs.getByRole("button", { name: "Cancellation letter" }).click();
  await expect(page.getByTestId("doc-preview")).toBeVisible();
  await page.keyboard.press("Escape");

  // ---- nights: 2.0 credited back, 2.0 forfeited (7 − 4 + 2 = 5 left)
  await page.goto(`/members/${member.id}?tab=entitlement`);
  const row = page.getByRole("row", { name: new RegExp(`^${year}\\b`) });
  await expect(row.getByRole("cell").last()).toHaveText("5.0");
  expect(apiErrors).toEqual([]);
});
