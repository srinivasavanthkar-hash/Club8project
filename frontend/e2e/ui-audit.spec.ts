/**
 * UI audit screenshots (docs/ui-audit/<UI_AUDIT_DIR>/), not a regression test. Runs only when UI_AUDIT_DIR is set:
 *   UI_AUDIT_DIR=after npx playwright test ui-audit --project=desktop
 * Needs the demo master data and the Section 14 scenario (fictitious data only).
 */
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./support/stack";
import path from "node:path";

const DIR = process.env.UI_AUDIT_DIR;
const PASSWORD = process.env.CRM_DEMO_PASSWORD ?? "Demo-Passw0rd!";
const OUT = path.join(__dirname, "..", "..", "docs", "ui-audit", DIR ?? "unused");
const WIDTHS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;

test.skip(!DIR, "set UI_AUDIT_DIR to capture audit screenshots");
test.describe.configure({ mode: "serial" });

async function login(page: Page, user = "demo.admin") {
  await signIn(page, user, PASSWORD); // completes the 2FA step for demo.admin
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function ids(page: Page) {
  const get = async <T,>(url: string) => (await (await page.request.get(url)).json()) as T;
  const members = await get<{ items: { id: string; membership_number: string }[] }>("/api/v1/members?q=MSMC8-9001");
  const member = members.items[0]!.id;
  const leads = await get<{ items: { id: string; member_id: string | null }[] }>("/api/v1/leads?page_size=100");
  const lead = (leads.items.find((l) => l.member_id === member) ?? leads.items[0]!).id;
  const res = await get<{ items: { id: string }[] }>(`/api/v1/reservations?member_id=${member}`);
  return { member, lead, reservation: res.items[0]!.id };
}

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  for (const [w, size] of Object.entries(WIDTHS)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: true });
  }
  await page.setViewportSize(WIDTHS.desktop);
}

test("capture main screens", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(WIDTHS.desktop);
  await page.goto("/login");
  await shot(page, "01-login");
  await login(page);
  const id = await ids(page);
  const screens: [string, string][] = [
    ["02-dashboard", "/"],
    ["03-leads", "/leads"],
    ["04-lead-detail", `/leads/${id.lead}`],
    ["05-lead-new", "/leads/new"],
    ["06-members", "/members"],
    ["07-member-profile", `/members/${id.member}?tab=profile`],
    ["08-member-finance", `/members/${id.member}?tab=finance`],
    ["09-member-reservations", `/members/${id.member}?tab=reservations`],
    ["10-member-entitlement", `/members/${id.member}?tab=entitlement`],
    ["11-member-correspondence", `/members/${id.member}?tab=correspondence`],
    ["12-member-history", `/members/${id.member}?tab=history`],
    ["13-member-application", "/members/new"],
    ["14-reservations", "/reservations"],
    ["15-reservation-detail", `/reservations/${id.reservation}`],
    ["16-finance", "/finance"],
    ["17-activity-log", "/activity"],
    ["18-exports", "/exports"],
    ["19-admin", "/admin"],
  ];
  for (const [name, url] of screens) {
    await page.goto(url);
    await shot(page, name);
  }
  await page.goto(`/members/${id.member}?tab=reservations`);
  const newRes = page.getByRole("button", { name: "New reservation" });
  if (await newRes.isVisible()) {
    await newRes.click();
    await shot(page, "20-reservation-form");
  }
});
