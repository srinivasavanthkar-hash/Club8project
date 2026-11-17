/**
 * Visual regression for key screens at 1440px and 390px, against recorded FICTITIOUS API data (no backend needed).
 * Baselines live next to this file (visual.spec.ts-snapshots/) and are per platform; update with
 *   npx playwright test visual --update-snapshots
 */
import { expect, type Page, test } from "@playwright/test";
import { loadRecording, mockApi } from "./support/fixtures";

const rec = loadRecording();
test.skip(!!rec.missing, "no API recording: run RECORD_FIXTURES=1 npx playwright test record-fixtures");
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
const M = rec.ids.member ?? "missing";

const SCREENS: [string, string][] = [
  ["dashboard", "/"],
  ...["profile", "finance", "reservations", "entitlement", "correspondence", "history"].map((t): [string, string] => [`member-${t}`, `/members/${M}?tab=${t}`]),
  ["activity-log", "/activity"],
];

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("[aria-busy=true]:not([data-demo] *)")).toHaveCount(0);
}

for (const [size, viewport] of Object.entries(SIZES)) {
  test.describe(`visual ${size}`, () => {
    test.use({ viewport });

    test(`login (${size})`, async ({ page }) => {
      await page.goto("/login");
      await settle(page);
      await expect(page).toHaveScreenshot(`login-${size}.png`, { fullPage: true, maxDiffPixelRatio: 0.01 });
    });

    for (const [name, url] of SCREENS) {
      test(`${name} (${size})`, async ({ page }) => {
        await mockApi(page, rec);
        await page.goto(url);
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${size}.png`, { fullPage: true, maxDiffPixelRatio: 0.01 });
      });
    }

    test(`reservation form (${size})`, async ({ page }) => {
      await mockApi(page, rec);
      await page.goto(`/members/${M}?tab=reservations`);
      await page.getByRole("button", { name: "New reservation" }).click();
      await page.getByLabel("Destination", { exact: true }).selectOption({ label: "Goa" });
      await page.getByLabel("Property", { exact: true }).selectOption({ index: 1 });
      await page.getByLabel("Check-in", { exact: true }).fill("2026-11-16");
      await page.getByLabel("Check-out", { exact: true }).fill("2026-11-19");
      await expect(page.getByText(/Entitlement nights:/)).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`reservation-form-${size}.png`, { fullPage: true, maxDiffPixelRatio: 0.01 });
    });
  });
}
