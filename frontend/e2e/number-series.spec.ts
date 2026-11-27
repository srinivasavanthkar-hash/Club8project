/**
 * Membership number series (docs/DECISIONS.md D-MN-1), FICTITIOUS data only: an admin adds a series for one property
 * through the form; the member form pre-selects the most specific series; a member gets a number from the new series;
 * search finds it by the number part and by the full number.
 */
import { type APIRequestContext, type Page } from "@playwright/test";
import { expect, istToday, test } from "./support/clock";
import { requireIsolatedStack, signIn } from "./support/stack";

test.beforeAll(requireIsolatedStack); // adds a series and a member: never against the demo database

const PASSWORD = process.env.CRM_DEMO_PASSWORD ?? "Demo-Passw0rd!";
const PREFIX = "E2EHILL";

function fakePan(): string {
  const L = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${L()}${L()}${L()}P${L()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}${L()}`;
}

async function apiAs(page: Page, user: string) {
  const req: APIRequestContext = page.request;
  await page.context().clearCookies();
  const login = await req.post("/api/v1/auth/login", { data: { username: user, password: PASSWORD } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const csrf = (await page.context().cookies()).find((c) => c.name === "crm_csrf")?.value ?? "";
  const call = async <T,>(method: "GET" | "POST", path: string, data?: unknown): Promise<T> => {
    const r = await req.fetch(`/api/v1${path}`, { method, headers: { "X-CSRF-Token": csrf }, data });
    expect(r.ok(), `${method} ${path}: ${await r.text()}`).toBeTruthy();
    return (await r.json()) as T;
  };
  const master = async (slug: string, value: string, key = "code") =>
    (await call<Record<string, string>[]>("GET", `/admin/master/${slug}`)).find((x) => x[key] === value)!;
  return { call, master };
}

async function pick(page: Page, label: string, option: RegExp) {
  await page.getByRole("dialog").getByRole("combobox", { name: label }).click();
  await page.getByRole("option").filter({ hasText: option }).first().click();
}

test("an admin adds a series; new members get numbers from the most specific series that fits", async ({ page }) => {
  // 1. Admin > Master data > Membership number series: a series for one property
  await signIn(page, "demo.manager");
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Master data & rates" }).click();
  await page.getByRole("navigation", { name: "Master data tables" }).getByRole("button", { name: "Membership number series" }).click();
  await expect(page.getByRole("row").filter({ hasText: "C8MTHN" })).toBeVisible(); // demo series, to be confirmed
  await page.getByRole("button", { name: "Add entry" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Prefix", { exact: true }).fill(PREFIX.toLowerCase()); // stored in capitals
  await pick(page, "Company", /^CLUB8 Holidays/);
  await pick(page, "Property", /^Demo Hill Resort/);
  await form.getByLabel("Next number", { exact: true }).fill("500");
  await form.getByLabel("Active from", { exact: true }).fill("01-01-2026");
  await form.getByRole("button", { name: "Add entry" }).click();
  const row = page.getByRole("row").filter({ hasText: PREFIX });
  await expect(row).toContainText("Demo Hill Resort (Supreme)");
  await expect(row).toContainText("All sales venues");

  // 2. The member form pre-selects the most specific series that fits
  await signIn(page, "demo.sales");
  await page.goto("/members/new");
  await page.getByLabel("Company / brand", { exact: true }).selectOption({ label: "CLUB8 Holidays" });
  const series = page.getByLabel("Membership number series", { exact: true });
  await expect(series.locator("option:checked")).toHaveText(/^MSMC8- \(all locations and properties\), to be confirmed$/);
  await page.getByLabel("Home property (optional)", { exact: true }).selectOption({ label: "Demo Hill Resort (Supreme)" });
  await expect(series.locator("option:checked")).toHaveText(`${PREFIX}- (Demo Hill Resort (Supreme))`);
  await expect(page.getByText(`Leave blank for the next number, ${PREFIX}-500.`)).toBeVisible();
  await page.getByLabel("Sales venue (location)", { exact: true }).selectOption({ label: "Demo Thane Showroom" });
  await expect(series.locator("option:checked")).toHaveText(/^C8MTHN- \(Demo Thane Showroom \+ Demo Hill Resort \(Supreme\)\)/);
  await expect(page.locator('input[type="date"], input[type="month"]')).toHaveCount(0);

  // 3. A member in the new series (set up through the API, as in cancellation.spec), then found by search
  const a = await apiAs(page, "demo.sales");
  const n = Math.floor(Math.random() * 900_000) + 100_000;
  const member = await a.call<{ id: string; membership_number: string }>("POST", "/members", {
    applicant1: { full_name: `Series Demo ${n}`, dob: "1984-05-06", mobile: `95${String(Date.now()).slice(-8)}`, kyc: [{ id_type: "PAN", value: fakePan() }] },
    address: { line1: "3 Demo Street", city: "Ooty", postcode: "643001", state: "Tamil Nadu" },
    email: `series.${n}@example.com`,
    company_id: (await a.master("companies", "CLUB8")).id,
    home_property_id: (await a.master("properties", "OOTY-DEMO-SUP")).id,
    purchase_date: istToday(),
    tenure_years: 10,
    first_year_of_use: Number(istToday().slice(0, 4)),
    resort_category_id: (await a.master("resort-categories", "PREMIUM")).id,
    season_id: (await a.master("seasons", "RED")).id,
    unit_type_id: (await a.master("unit-types", "T0")).id,
    nights_per_year: "7",
    purchase_price: "100000.00",
    admin_fees: "0.00",
    down_payment_amount: "100000.00",
    down_payment_method_id: (await a.master("payment-methods", "CARD")).id,
    down_payment: { payment_date: istToday(), transaction_ref: `DP-${n}`, card_last4: "1111" },
    balance_mode: "NONE",
  });
  expect(member.membership_number).toBe(`${PREFIX}-500`);

  await signIn(page, "demo.sales");
  await page.goto(`/members/${member.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${PREFIX}-500`);
  await expect(page.getByText("Demo Hill Resort (Supreme)").first()).toBeVisible(); // home property on the profile
  for (const q of ["500", `${PREFIX.toLowerCase()}-500`]) {
    await page.goto("/members");
    await page.getByLabel("Search (no., name, mobile, email)", { exact: true }).fill(q);
    await expect(page.getByRole("row").filter({ hasText: `${PREFIX}-500` })).toBeVisible();
  }
});
