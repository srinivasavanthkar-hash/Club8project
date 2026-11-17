/**
 * Section 14 initial-delivery demo, driven through the UI with FICTITIOUS data only.
 * Pre-requisite: demo master data + users (scripts/seed-demo.sh --no-scenario).
 */
import { expect, type Page, test } from "@playwright/test";
import { requireIsolatedStack } from "./support/stack";

const PASSWORD = process.env.CRM_DEMO_PASSWORD ?? "Demo-Passw0rd!";
const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
const NAME = `Kiran Demo ${tag}`;
const MOBILE = `98${String(Date.now()).slice(-8)}`;
const EMAIL = `kiran.${tag.toLowerCase()}@example.com`;
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

function istToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}
/** A Monday-to-Thursday stay ~3 weeks out, inside the 7-working-day / 12-month window and the same year. */
function stay(): [string, string, string, string] {
  let d = new Date(Date.now() + 21 * 86_400_000);
  if (d.getMonth() === 11 && d.getDate() > 10) d = new Date(d.getFullYear() + 1, 1, 2);
  const iso = (x: Date) => new Intl.DateTimeFormat("en-CA").format(x);
  const plus = (n: number) => new Date(d.getTime() + n * 86_400_000);
  return [iso(d), iso(plus(4)), iso(plus(7)), iso(plus(9))];
}

/** Fails with the visible validation / server messages instead of a bare timeout. */
test.beforeAll(requireIsolatedStack); // creates leads, members and payments: never against the demo database

async function expectNavigated(page: Page, heading: RegExp) {
  try {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 10_000 });
  } catch (e) {
    const alerts = await page.getByRole("alert").allTextContents();
    throw new Error(`Form did not submit. Alerts: ${JSON.stringify(alerts)}
${e}`);
  }
}

async function login(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(user);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("Section 14 demo: lead → member → finance → reservation → correspondence → activity log", async ({ page }) => {
  // 1. Lead -> ATTENDED -> convert with Premium / Red / Studio / 7 nights / 10 years / EMI balance
  await login(page, "demo.sales");
  await page.goto("/leads/new");
  await page.getByLabel("Prospect name", { exact: true }).fill(NAME);
  await page.getByLabel("Mobile", { exact: true }).fill(MOBILE);
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("City", { exact: true }).fill("Bengaluru");
  await page.getByLabel("OPC / marketer name", { exact: true }).fill("Demo OPC");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(NAME) })).toBeVisible();
  const leadUrl = page.url();
  const leadStatus = page.getByTestId("lead-status");
  await expect(leadStatus).toHaveText("NEW");
  await page.getByRole("button", { name: "CONTACTED" }).click();
  await expect(leadStatus).toHaveText("CONTACTED");
  await page.getByLabel(/Presentation date & time/).fill(`${istToday()}T11:00`);
  await page.getByRole("button", { name: "PRESENTATION SCHEDULED" }).click();
  await expect(leadStatus).toHaveText("PRESENTATION SCHEDULED");
  await page.getByRole("button", { name: "ATTENDED" }).click();
  await expect(leadStatus).toHaveText("ATTENDED");
  await page.getByRole("link", { name: "Convert to member" }).click();

  await expect(page.getByLabel("1st Applicant Name", { exact: true })).toHaveValue(NAME);
  await page.getByLabel("D.O.B", { exact: true }).fill("1987-03-14");
  await page.getByLabel("ID number", { exact: true }).fill(`ABCDE${MOBILE.slice(-4)}F`);
  await page.getByLabel("Address Line 1", { exact: true }).fill("21 Demo Layout");
  await page.getByLabel("Post Code", { exact: true }).fill("560001");
  await page.getByLabel("State", { exact: true }).selectOption("Karnataka");
  await page.getByLabel("Company / brand", { exact: true }).selectOption({ label: "CLUB8 Holidays (MSMC8-)" });
  await page.getByLabel("Category (Membership Type)", { exact: true }).selectOption({ label: "Premium (PREMIUM)" });
  await page.getByLabel("Season", { exact: true }).selectOption({ label: "Red (RED)" });
  await page.getByLabel("Unit Type", { exact: true }).selectOption({ label: "T0 = Studio (2 adults + 2 children below 10 years)" });
  await page.getByLabel("No. of Nights per Year", { exact: true }).fill("7");
  await expect(page.getByLabel("Annual Subscription Fee (current rate)", { exact: true })).toHaveValue(/GST/);
  await page.getByLabel("Purchase Price", { exact: true }).fill("250000");
  await page.getByLabel("Admin Fees", { exact: true }).fill("5000");
  await page.getByLabel("Down Payment", { exact: true }).fill("55000");
  await expect(page.getByLabel("Balance", { exact: true })).toHaveValue("₹2,00,000.00");
  await page.getByLabel("By (payment method)", { exact: true }).selectOption({ label: "Card (CARD)" });
  await page.getByLabel("Transaction / approval reference", { exact: true }).fill(`E2E-CARD-${tag}`);
  await page.getByLabel("Card last 4 digits (optional)", { exact: true }).fill("4242");
  await page.getByLabel("Balance Mode", { exact: true }).selectOption("EMI");
  await page.getByLabel("EMI Amount", { exact: true }).fill("20000");
  await page.getByLabel("No. of EMIs", { exact: true }).fill("10");
  await page.getByLabel("Starting From (MM/YYYY)", { exact: true }).fill(istToday(35).slice(0, 7));
  await page.getByLabel("1st Applicant signed", { exact: true }).check();
  await page.getByLabel("Signed on behalf of the Company", { exact: true }).check();
  await page.getByRole("button", { name: "Create member & convert lead" }).click();
  await expectNavigated(page, /^MSMC8-/);
  const memberUrl = page.url().split("?")[0]!;
  await expect(page.getByText("PENDING APPROVAL").first()).toBeVisible();

  // lead retained and linked
  await page.goto(leadUrl);
  await expect(page.getByText("CONVERTED").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open member" })).toBeVisible();

  // 2. Upload the signed agreement, approve -> ACTIVE
  await page.goto(`${memberUrl}?tab=correspondence`);
  await page.getByLabel("Document type", { exact: true }).selectOption({ label: "Membership Agreement (signed)" });
  await page.getByLabel("File (PDF, JPEG, PNG)", { exact: true }).setInputFiles({ name: "signed-agreement.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByText("signed-agreement.pdf", { exact: true })).toBeVisible();
  await login(page, "demo.manager");
  await page.goto(`${memberUrl}?tab=profile`);
  await expect(page.getByText("All checks passed")).toBeVisible();
  await page.getByRole("button", { name: "Approve member" }).click();
  await expect(page.getByText("ACTIVE", { exact: true }).first()).toBeVisible();
  // approval creates the entitlement: the header and the Entitlement tab show it straight away, without a reload
  await expect(page.getByRole("link", { name: /Nights left in/ })).toContainText("7.0");
  await page.getByRole("tab", { name: /^Entitlement/ }).click();
  const thisYear = page.getByRole("row").filter({ hasText: "(current year)" });
  await expect(thisYear.getByRole("cell").nth(1)).toHaveText("7.0"); // Allocated
  await expect(thisYear.getByRole("cell").last()).toHaveText("7.0"); // Remaining

  // 3. Down payment by card (recorded at conversion), EMI schedule, one EMI payment with receipt
  await login(page, "demo.finance");
  await page.goto(`${memberUrl}?tab=finance`);
  await expect(page.getByRole("cell", { name: "DOWN_PAYMENT" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Generate EMI schedule" }).click();
  await expect(page.getByRole("cell", { name: "10", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  const dlg = page.getByRole("dialog", { name: "Record payment" });
  await dlg.getByLabel("Amount", { exact: true }).fill("20000");
  await dlg.getByLabel("Method", { exact: true }).selectOption({ label: "UPI" });
  await dlg.getByLabel("Transaction / approval reference", { exact: true }).fill(`E2E-UPI-${tag}`);
  await dlg.getByRole("button", { name: /Save payment/ }).click();
  await expect(page.getByRole("cell", { name: "MEMBERSHIP_EMI" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Receipt" }).first()).toBeVisible();

  // 4. Reservation raises ASF (+5% GST) for the membership year
  const [ci, co, ci2, co2] = stay();
  await login(page, "demo.reservations");
  await page.goto(`${memberUrl}?tab=reservations`);
  await page.getByRole("button", { name: "New reservation" }).click();
  await page.getByLabel("Destination", { exact: true }).selectOption({ label: "Goa" });
  await page.getByLabel("Property", { exact: true }).selectOption({ label: "Demo Beach Resort (Premium)" });
  await page.getByLabel("Check-in", { exact: true }).fill(ci);
  await page.getByLabel("Check-out", { exact: true }).fill(co);
  await expect(page.getByText(/Entitlement nights:\s*4/)).toBeVisible();
  await expect(page.getByText(/ASF payable: \d{4}: ₹12,600\.00 incl\. GST/)).toBeVisible();
  await page.getByRole("button", { name: "Submit request" }).click();
  await page.getByRole("link", { name: /^R-/ }).first().click();
  await page.waitForURL(/\/reservations\/[0-9a-f-]+$/);
  const resUrl = page.url();
  await expect(page.getByText(/ASF unpaid/)).toBeVisible();

  // 5. Approve; confirmation blocked until ASF paid; pay ASF; confirm
  await page.getByRole("button", { name: "Approve (deduct entitlement)" }).click();
  await page.getByLabel("Property confirmation number", { exact: true }).fill(`CNF-${tag}`);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "non-confirmation" })).toBeVisible();
  await login(page, "demo.finance");
  await page.goto(`${memberUrl}?tab=finance`);
  await page.getByRole("button", { name: /^Pay ASF/ }).click();
  const asfDlg = page.getByRole("dialog", { name: "Record payment" });
  await asfDlg.getByLabel("Method", { exact: true }).selectOption({ label: "Card" });
  await asfDlg.getByLabel("Transaction / approval reference", { exact: true }).fill(`E2E-ASF-${tag}`);
  await asfDlg.getByRole("button", { name: /Save payment/ }).click();
  await expect(page.getByText("PAID", { exact: true }).first()).toBeVisible();
  await login(page, "demo.reservations");
  await page.goto(resUrl);
  await page.getByLabel("Property confirmation number", { exact: true }).fill(`CNF-${tag}`);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("CONFIRMED", { exact: true }).first()).toBeVisible();
  await page.goto(`${memberUrl}?tab=entitlement`);
  const yearRow = page.getByRole("row", { name: new RegExp(`^${ci.slice(0, 4)}\\b`) });
  await expect(yearRow.getByRole("cell").nth(4)).toHaveText("4.0"); // used once
  await expect(yearRow.getByRole("cell").last()).toHaveText("3.0"); // remaining
  // second booking in the same year: no new ASF
  await page.goto(`${memberUrl}?tab=reservations`);
  await page.getByRole("button", { name: "New reservation" }).click();
  await page.getByLabel("Destination", { exact: true }).selectOption({ label: "Goa" });
  await page.getByLabel("Property", { exact: true }).selectOption({ label: "Demo Beach Resort (Premium)" });
  await page.getByLabel("Check-in", { exact: true }).fill(ci2);
  await page.getByLabel("Check-out", { exact: true }).fill(co2);
  await expect(page.getByText(/ASF payable: none/)).toBeVisible();
  await page.getByRole("button", { name: "Submit request" }).click();

  // 6. One email and one call  7. Upload a PDF and preview it
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
  await page.getByLabel("Document type", { exact: true }).selectOption({ label: "Other" });
  await page.getByLabel("File (PDF, JPEG, PNG)", { exact: true }).setInputFiles({ name: "demo-note.pdf", mimeType: "application/pdf", buffer: PDF });
  const docRow = page.getByRole("listitem").filter({ hasText: "demo-note.pdf" });
  await docRow.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("doc-preview")).toBeVisible();

  // 8. Activity log for this member, with old/new values for an edit
  await login(page, "demo.manager");
  await page.goto(`${memberUrl}?tab=profile`);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Comments", { exact: true }).fill("Prefers sea-facing rooms");
  await page.getByLabel("Reason for change (recorded in history)", { exact: true }).fill("Welcome call");
  await page.getByRole("button", { name: "Save" }).click();
  // wait for the save to land (edit mode closes) before navigating, so the PATCH is not aborted mid-flight
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  await page.goto(`${memberUrl}?tab=history`);
  const trail = page.getByRole("region").filter({ hasText: "Activity trail" }).or(page.locator("section", { hasText: "Activity trail" }));
  for (const action of ["LEAD_CONVERTED", "MEMBER_APPROVED", "PAYMENT", "SCHEDULE_GENERATED", "ASF_RAISED", "ENTITLEMENT_DEDUCTED", "UPLOAD"]) {
    await expect(trail.getByText(new RegExp(`· ${action} ·`)).first()).toBeVisible();
  }
  await expect(trail.getByText(/"Prefers sea-facing rooms"/).first()).toBeVisible();
});

test("member search works on a phone screen @mobile", async ({ page }) => {
  await login(page, "demo.sales");
  await page.getByLabel("Search members and leads", { exact: true }).fill("MSMC8");
  await expect(page.getByRole("listbox")).toBeVisible();
});
