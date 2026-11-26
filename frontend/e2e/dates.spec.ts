/**
 * Dates are DD-MM-YYYY on every PC. Native date inputs follow the browser's language, and many office PCs run English
 * (United States), which shows and expects month-first dates. This spec runs the browser in en-US with a US time zone:
 * every date field must still show and accept day-first dates, and the API must still get ISO dates.
 * Times typed into date-and-time fields are India time on any PC. Live stack, signed in; changes the week-start
 * setting (then puts it back), adds a season-calendar entry and a lead.
 */
import { type Page } from "@playwright/test";
import { expect, test } from "./support/clock";
import { requireIsolatedStack, signIn } from "./support/stack";

test.beforeAll(requireIsolatedStack);
test.use({ locale: "en-US", timezoneId: "America/New_York" });

const NATIVE = 'input[type="date"], input[type="month"]';

async function noNativeDateInputs(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toBeVisible();
  expect(await page.locator(NATIVE).count(), `native date input on ${url}`).toBe(0);
}

test("no page uses the browser's own date or month picker", async ({ page }) => {
  await signIn(page, "demo.manager");
  for (const url of ["/members", "/members/new", "/leads", "/leads/new", "/reservations", "/activity", "/exports"]) {
    await noNativeDateInputs(page, url);
  }
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Master data & rates" }).click();
  await page.getByRole("navigation", { name: "Master data tables" }).getByRole("button", { name: "Season calendar" }).click();
  await page.getByRole("button", { name: "Add entry" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.locator(NATIVE).count()).toBe(0);
});

test("typed day-first dates stay day-first and reach the API as ISO, in an en-US browser", async ({ page }) => {
  await signIn(page, "demo.manager");
  expect(await page.evaluate(() => navigator.language)).toBe("en-US");
  await page.goto("/members");
  await page.waitForLoadState("networkidle");
  const from = page.getByLabel("Purchased from", { exact: true });
  await expect(from).toHaveAttribute("placeholder", "DD-MM-YYYY");
  const request = page.waitForRequest((r) => r.url().includes("/api/v1/members?") && r.url().includes("purchase_from=2027-03-05"));
  await from.pressSequentially("05032027");
  await expect(from).toHaveValue("05-03-2027"); // 5 March, not 3 May
  await request;

  // 03/05/2027 typed the US way is read day-first: 3 May
  const to = page.getByLabel("Purchased to", { exact: true });
  await to.fill("03/05/2027");
  await to.blur();
  await expect(to).toHaveValue("03-05-2027");

  // an impossible date is reported, not guessed
  await to.fill("31-02-2027");
  await to.blur();
  await expect(page.getByText("Enter a date as DD-MM-YYYY, e.g. 05-03-2027.")).toBeVisible();
  await expect(to).toHaveAttribute("aria-invalid", "true");
});

test("the calendar picks a date and starts the week on the configured day", async ({ page }) => {
  await signIn(page, "demo.manager");
  await page.goto("/members");
  await page.waitForLoadState("networkidle");
  const field = page.locator('[data-field="mf"]');
  await field.getByRole("button", { name: "Choose date" }).click();
  const cal = page.getByRole("dialog", { name: "Choose date" });
  await cal.getByLabel("Year", { exact: true }).selectOption("2027");
  await cal.getByLabel("Month", { exact: true }).selectOption({ label: "March" });
  await expect(cal.getByRole("grid", { name: "March 2027" })).toBeVisible();
  await expect(cal.getByRole("columnheader").first()).toHaveAttribute("abbr", "Monday"); // default setting
  await cal.getByRole("button", { name: "Friday 5 March 2027" }).click();
  await expect(cal).toBeHidden();
  await expect(page.getByLabel("Purchased from", { exact: true })).toHaveValue("05-03-2027");

  // Admin switches the week to start on Sunday
  const setWeekStart = async (label: string) => {
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Master data & rates" }).click();
    await page.getByRole("navigation", { name: "Master data tables" }).getByRole("button", { name: "Business-rule settings" }).click();
    await page.getByRole("button", { name: "Edit ui.week_start" }).click();
    await page.getByRole("dialog").getByLabel("Value", { exact: true }).selectOption({ label });
    await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("row").filter({ hasText: "ui.week_start" })).toContainText(label);
  };
  await setWeekStart("Sunday");
  try {
    await page.goto("/members");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-field="mf"]').getByRole("button", { name: "Choose date" }).click();
    await expect(page.getByRole("dialog", { name: "Choose date" }).getByRole("columnheader").first()).toHaveAttribute("abbr", "Sunday");
  } finally {
    await setWeekStart("Monday");
  }
});

test("a date saved through a form is stored as the day that was typed", async ({ page }) => {
  await signIn(page, "demo.manager");
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Master data & rates" }).click();
  await page.getByRole("navigation", { name: "Master data tables" }).getByRole("button", { name: "Season calendar" }).click();
  await page.getByRole("button", { name: "Add entry" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Season", { exact: true }).click();
  await page.getByRole("option").filter({ hasText: /^Red/ }).first().click();
  await form.getByLabel("First day", { exact: true }).pressSequentially("01052039");
  await form.getByLabel("Last day", { exact: true }).pressSequentially("10052039");
  const posted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/v1/admin/master/season-calendar"));
  await form.getByRole("button", { name: "Add entry" }).click();
  const body = (await posted).postDataJSON() as { start_date: string; end_date: string };
  expect(body).toMatchObject({ start_date: "2039-05-01", end_date: "2039-05-10" }); // not 5 January / 5 October
  await expect(page.getByRole("row").filter({ hasText: "01-05-2039" })).toContainText("10-05-2039");
});

test("a time typed on a PC in another time zone is recorded as India time", async ({ page }) => {
  await signIn(page, "demo.sales");
  await page.goto("/leads/new");
  await page.getByLabel("Prospect name", { exact: true }).fill("Dates Demo Prospect");
  await page.getByLabel("Mobile", { exact: true }).fill(`96${String(Date.now()).slice(-8)}`);
  await page.getByLabel("Email", { exact: true }).fill("dates.demo@example.com");
  await page.getByLabel("City", { exact: true }).fill("Pune");
  await page.getByLabel("OPC / marketer name", { exact: true }).fill("Demo OPC");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByTestId("lead-status")).toHaveText("NEW");
  await page.getByRole("button", { name: "CONTACTED" }).click();
  await expect(page.getByTestId("lead-status")).toHaveText("CONTACTED");
  expect(await page.locator(NATIVE + ', input[type="datetime-local"]').count()).toBe(0);
  await page.getByLabel(/Presentation date & time/).pressSequentially("20112026");
  await page.getByLabel("Presentation time", { exact: true }).fill("4:30 pm");
  const posted = page.waitForRequest((r) => r.method() === "POST" && /\/api\/v1\/leads\/[^/]+\/status$/.test(r.url()));
  await page.getByRole("button", { name: "PRESENTATION SCHEDULED" }).click();
  // 4:30 pm in India is 11:00 UTC, although this browser is in New York (where 4:30 pm would be 21:30 UTC)
  expect((await posted).postDataJSON()).toMatchObject({ status: "PRESENTATION_SCHEDULED", presentation_at: "2026-11-20T11:00:00.000Z" });
  await expect(page.getByText("20-11-2026 4:30 pm")).toBeVisible();
});
