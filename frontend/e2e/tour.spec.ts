/**
 * Client demo tour: the Section 14 flow driven through the UI, saving a screenshot at each step to
 * docs/demo-tour/ for the illustrated walkthrough. Not a regression test (demo.spec.ts is). Runs only when TOUR=1:
 *   TOUR=1 npx playwright test tour --project=desktop --workers=1
 * Needs the demo master data and users (fictitious data only).
 */
import { expect, type Locator, type Page, test } from "@playwright/test";
import path from "node:path";

const PASSWORD = process.env.CRM_DEMO_PASSWORD ?? "Demo-Passw0rd!";
const OUT = path.join(__dirname, "..", "..", "docs", "demo-tour");
const tag = Math.random().toString(36).slice(2, 5).toUpperCase();
const NAME = `Priya Demo ${tag}`;
const MOBILE = `97${String(Date.now()).slice(-8)}`;
const EMAIL = `priya.${tag.toLowerCase()}@example.com`;
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test.skip(!process.env.TOUR, "set TOUR=1 to capture the demo tour screenshots");
test.use({ viewport: { width: 1440, height: 900 } });

function istToday(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + offsetDays * 86_400_000));
}
function stay(): [string, string, string, string] {
  let d = new Date(Date.now() + 21 * 86_400_000);
  if (d.getMonth() === 11 && d.getDate() > 10) d = new Date(d.getFullYear() + 1, 1, 2);
  const iso = (x: Date) => new Intl.DateTimeFormat("en-CA").format(x);
  const plus = (n: number) => new Date(d.getTime() + n * 86_400_000);
  return [iso(d), iso(plus(4)), iso(plus(7)), iso(plus(9))];
}

/** Settles spinners, hides toasts and focus, optionally scrolls `at` to `offset` px below the top of the viewport,
 * and saves docs/demo-tour/<name>.png. */
async function shot(page: Page, name: string, at?: Locator, fullPage = false, offset = 80) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]:not([data-demo])')).toHaveCount(0);
  await page.addStyleTag({ content: '[aria-live="polite"].fixed { display: none !important; }' });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  if (at) await at.evaluate((el, off) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off }), offset);
  else await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  // full-page: grow the viewport instead, so the full-height sidebar is drawn down the whole image
  const vp = page.viewportSize()!;
  if (fullPage) await page.setViewportSize({ width: vp.width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: "disabled", caret: "hide" });
  if (fullPage) await page.setViewportSize(vp);
}

async function login(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(user);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("client demo tour", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/login");
  await shot(page, "01-login");

  // 1. Lead
  await login(page, "demo.sales");
  await shot(page, "02-dashboard");
  await page.goto("/leads/new");
  await page.getByLabel("Prospect name", { exact: true }).fill(NAME);
  await page.getByLabel("Mobile", { exact: true }).fill(MOBILE);
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("City", { exact: true }).fill("Bengaluru");
  await page.getByLabel("OPC / marketer name", { exact: true }).fill("Demo OPC");
  await shot(page, "03-new-lead");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(NAME) })).toBeVisible();
  const leadUrl = page.url();
  const leadStatus = page.getByTestId("lead-status");
  await page.getByRole("button", { name: "CONTACTED" }).click();
  await expect(leadStatus).toHaveText("CONTACTED");
  await page.getByLabel(/Presentation date & time/).fill(`${istToday()}T11:00`);
  await page.getByRole("button", { name: "PRESENTATION SCHEDULED" }).click();
  await expect(leadStatus).toHaveText("PRESENTATION SCHEDULED");
  await page.getByRole("button", { name: "ATTENDED" }).click();
  await expect(leadStatus).toHaveText("ATTENDED");
  await shot(page, "04-lead-attended");

  // Convert to member
  await page.getByRole("link", { name: "Convert to member" }).click();
  await expect(page.getByLabel("1st Applicant Name", { exact: true })).toHaveValue(NAME);
  await page.getByLabel("D.O.B", { exact: true }).fill("1988-06-21");
  await page.getByLabel("ID number", { exact: true }).fill(`ABCDE${MOBILE.slice(-4)}F`);
  await page.getByLabel("Address Line 1", { exact: true }).fill("14 Demo Gardens, Indiranagar");
  await page.getByLabel("Post Code", { exact: true }).fill("560038");
  await page.getByLabel("State", { exact: true }).selectOption("Karnataka");
  await shot(page, "05-application-purchaser");
  await page.getByLabel("Company / brand", { exact: true }).selectOption({ label: "CLUB8 Holidays (MSMC8-)" });
  await page.getByLabel("Category (Membership Type)", { exact: true }).selectOption({ label: "Premium (PREMIUM)" });
  await page.getByLabel("Season", { exact: true }).selectOption({ label: "Red (RED)" });
  await page.getByLabel("Unit Type", { exact: true }).selectOption({ label: "T0 = Studio (2 adults + 2 children below 10 years)" });
  await page.getByLabel("No. of Nights per Year", { exact: true }).fill("7");
  await page.getByLabel("Purchase Price", { exact: true }).fill("250000");
  await page.getByLabel("Admin Fees", { exact: true }).fill("5000");
  await page.getByLabel("Down Payment", { exact: true }).fill("55000");
  await page.getByLabel("By (payment method)", { exact: true }).selectOption({ label: "Card (CARD)" });
  await page.getByLabel("Transaction / approval reference", { exact: true }).fill(`TOUR-CARD-${tag}`);
  await page.getByLabel("Card last 4 digits (optional)", { exact: true }).fill("4242");
  await page.getByLabel("Balance Mode", { exact: true }).selectOption("EMI");
  await page.getByLabel("EMI Amount", { exact: true }).fill("20000");
  await page.getByLabel("No. of EMIs", { exact: true }).fill("10");
  await page.getByLabel("Starting From (MM/YYYY)", { exact: true }).fill(istToday(35).slice(0, 7));
  await page.getByLabel("Purchase Price", { exact: true }).blur();
  await shot(page, "06-application-payment", page.getByLabel("Purchase Price", { exact: true }));
  await page.getByLabel("1st Applicant signed", { exact: true }).check();
  await page.getByLabel("Signed on behalf of the Company", { exact: true }).check();
  await page.getByRole("button", { name: "Create member & convert lead" }).click();
  await expect(page.getByRole("heading", { name: /^MSMC8-/ })).toBeVisible();
  const memberUrl = page.url().split("?")[0]!;
  await shot(page, "07-member-pending");

  // 2. Signed agreement, approval
  await page.goto(`${memberUrl}?tab=correspondence`);
  await page.getByLabel("Document type", { exact: true }).selectOption({ label: "Membership Agreement (signed)" });
  await page.getByLabel("File (PDF, JPEG, PNG)", { exact: true }).setInputFiles({ name: "signed-agreement.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByText("signed-agreement.pdf", { exact: true })).toBeVisible();
  await login(page, "demo.manager");
  await page.goto(`${memberUrl}?tab=profile`);
  await expect(page.getByText("All checks passed")).toBeVisible();
  await shot(page, "08-approval-panel", page.getByText("All checks passed"), false, 300);
  await page.getByRole("button", { name: "Approve member" }).click();
  await expect(page.getByText("ACTIVE", { exact: true }).first()).toBeVisible();
  await page.goto(`${memberUrl}?tab=entitlement`);
  await shot(page, "09-entitlement-active");

  // 3. Finance
  await login(page, "demo.finance");
  await page.goto(`${memberUrl}?tab=finance`);
  await page.getByRole("button", { name: "Generate EMI schedule" }).click();
  await expect(page.getByRole("cell", { name: "10", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  const dlg = page.getByRole("dialog", { name: "Record payment" });
  await dlg.getByLabel("Amount", { exact: true }).fill("20000");
  await dlg.getByLabel("Method", { exact: true }).selectOption({ label: "UPI" });
  await dlg.getByLabel("Transaction / approval reference", { exact: true }).fill(`TOUR-UPI-${tag}`);
  await page.screenshot({ path: path.join(OUT, "10-record-payment.png") });
  await dlg.getByRole("button", { name: /Save payment/ }).click();
  await expect(page.getByRole("cell", { name: "MEMBERSHIP_EMI" }).first()).toBeVisible();
  await shot(page, "11-finance-tab", undefined, true);

  // 4. Reservation with live quote
  const [ci, co, ci2, co2] = stay();
  await login(page, "demo.reservations");
  await page.goto(`${memberUrl}?tab=reservations`);
  await page.getByRole("button", { name: "New reservation" }).click();
  await page.getByLabel("Destination", { exact: true }).selectOption({ label: "Goa" });
  await page.getByLabel("Property", { exact: true }).selectOption({ label: "Demo Beach Resort (Premium)" });
  await page.getByLabel("Check-in", { exact: true }).fill(ci);
  await page.getByLabel("Check-out", { exact: true }).fill(co);
  await expect(page.getByText(/ASF payable: \d{4}: ₹12,600\.00 incl\. GST/)).toBeVisible();
  await shot(page, "12-reservation-quote", page.getByLabel("Destination", { exact: true }), false, 300);
  await page.getByRole("button", { name: "Submit request" }).click();
  await page.getByRole("link", { name: /^R-/ }).first().click();
  await page.waitForURL(/\/reservations\/[0-9a-f-]+$/);
  const resUrl = page.url();

  // 5. Approve, confirm blocked by unpaid ASF, pay ASF, confirm
  await page.getByRole("button", { name: "Approve (deduct entitlement)" }).click();
  await page.getByLabel("Property confirmation number", { exact: true }).fill(`CNF-${tag}`);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "non-confirmation" })).toBeVisible();
  await shot(page, "13-confirm-blocked");
  await login(page, "demo.finance");
  await page.goto(`${memberUrl}?tab=finance`);
  await page.getByRole("button", { name: /^Pay ASF/ }).click();
  const asfDlg = page.getByRole("dialog", { name: "Record payment" });
  await asfDlg.getByLabel("Method", { exact: true }).selectOption({ label: "Card" });
  await asfDlg.getByLabel("Transaction / approval reference", { exact: true }).fill(`TOUR-ASF-${tag}`);
  await asfDlg.getByRole("button", { name: /Save payment/ }).click();
  await expect(page.getByText("PAID", { exact: true }).first()).toBeVisible();
  await login(page, "demo.reservations");
  await page.goto(resUrl);
  await page.getByLabel("Property confirmation number", { exact: true }).fill(`CNF-${tag}`);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("CONFIRMED", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Generate confirmation \/ voucher PDF/ }).click();
  await expect(page.getByText("Open voucher")).toBeVisible();
  await shot(page, "14-reservation-confirmed");
  await page.goto(`${memberUrl}?tab=entitlement`);
  await shot(page, "15-entitlement-used");
  await page.goto(`${memberUrl}?tab=reservations`);
  await page.getByRole("button", { name: "New reservation" }).click();
  await page.getByLabel("Destination", { exact: true }).selectOption({ label: "Goa" });
  await page.getByLabel("Property", { exact: true }).selectOption({ label: "Demo Beach Resort (Premium)" });
  await page.getByLabel("Check-in", { exact: true }).fill(ci2);
  await page.getByLabel("Check-out", { exact: true }).fill(co2);
  await expect(page.getByText(/ASF payable: none/)).toBeVisible();
  await page.getByRole("button", { name: "Submit request" }).click();

  // 6-7. Correspondence and documents
  await login(page, "demo.service");
  await page.goto(`${memberUrl}?tab=correspondence`);
  await page.getByLabel("To (comma separated)", { exact: true }).fill("reservations@example.com");
  await page.getByLabel("Subject", { exact: true }).fill("Early check-in request");
  await page.getByLabel("Body", { exact: true }).fill("Could we check in early? (demo)");
  await page.getByRole("button", { name: "Add email" }).click();
  await expect(page.getByText("Early check-in request (1)")).toBeVisible();
  await page.getByLabel("Summary", { exact: true }).fill("Welcome call (demo)");
  await page.getByRole("button", { name: "Add call" }).click();
  await expect(page.getByText(/Welcome call \(demo\)/).first()).toBeVisible();
  await shot(page, "16-correspondence");

  // 8. Edit with reason, history, activity log
  await login(page, "demo.manager");
  await page.goto(`${memberUrl}?tab=profile`);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Comments", { exact: true }).fill("Prefers sea-facing rooms");
  await page.getByLabel("Reason for change (recorded in history)", { exact: true }).fill("Welcome call");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  await page.goto(`${memberUrl}?tab=history`);
  await expect(page.getByText(/"Prefers sea-facing rooms"/).first()).toBeVisible();
  await shot(page, "17-member-history");
  await login(page, "demo.admin");
  await page.goto("/activity");
  await page.getByRole("button", { name: "Verify integrity" }).click();
  await expect(page.getByText(/Hash chain intact/)).toBeVisible();
  await shot(page, "18-activity-log");

  // Lists and dashboards
  await page.goto("/members");
  await shot(page, "19-members-list");
  await page.goto("/reservations");
  await shot(page, "20-reservations-list");
  await page.goto("/finance");
  await shot(page, "21-finance-dashboard");
  await page.goto("/admin");
  await shot(page, "22-admin");
  await page.goto("/leads");
  await shot(page, "23-leads-list");
  await page.goto(leadUrl);
  await shot(page, "24-lead-converted");
});

test("client demo tour: phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "demo.sales");
  await shot(page, "25-phone-dashboard");
  await page.getByLabel("Search members and leads", { exact: true }).fill("Priya");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "26-phone-search.png") });
});
