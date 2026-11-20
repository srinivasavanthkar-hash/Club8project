/**
 * Visual regression for key screens at 1440px and 390px, against recorded FICTITIOUS API data (no backend needed).
 *
 * The reference images (visual.spec.ts-snapshots/*-linux.png) are made and compared ONLY in Playwright's official
 * Linux Docker image (the same version as @playwright/test), so fonts and rendering are identical locally and in CI:
 *   sh scripts/visual.sh            compare (what CI runs)
 *   sh scripts/visual.sh --update   re-create the references after an intended change, then review and commit them
 * Anywhere else this spec is skipped. A missing reference fails the run (playwright.config.ts: updateSnapshots none).
 */
import { expect, type Page, test } from "@playwright/test";
import { loadRecording, mockApi } from "./support/fixtures";

const rec = loadRecording();
test.skip(!process.env.PLAYWRIGHT_OFFICIAL_IMAGE, "visual references are compared only in the official Playwright image: sh scripts/visual.sh");
test.skip(!!rec.missing, "no API recording: run RECORD_FIXTURES=1 npx playwright test record-fixtures");
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
const M = rec.ids.member ?? "missing";
const SHOT = { fullPage: true, maxDiffPixelRatio: 0.01 } as const;

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

async function openMasterData(page: Page, table: string) {
  await mockApi(page, rec);
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Master data & rates" }).click();
  if (table !== "ASF rates") {
    const nav = page.getByRole("navigation", { name: "Master data tables" });
    if (await nav.isVisible()) await nav.getByRole("button", { name: table }).click();
    else await page.getByLabel("Table", { exact: true }).selectOption({ label: table });
  }
  await settle(page);
}

for (const [size, viewport] of Object.entries(SIZES)) {
  test.describe(`visual ${size}`, () => {
    test.use({ viewport });

    test(`login (${size})`, async ({ page }) => {
      await page.goto("/login");
      await settle(page);
      await expect(page).toHaveScreenshot(`login-${size}.png`, SHOT);
    });

    for (const [name, url] of SCREENS) {
      test(`${name} (${size})`, async ({ page }) => {
        await mockApi(page, rec);
        await page.goto(url);
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}-${size}.png`, SHOT);
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
      await expect(page).toHaveScreenshot(`reservation-form-${size}.png`, SHOT);
    });

    test(`master data form, ASF rates (${size})`, async ({ page }) => {
      await openMasterData(page, "ASF rates");
      await page.getByRole("button", { name: "Add entry" }).click();
      const form = page.getByRole("dialog");
      await form.getByRole("button", { name: "Add entry" }).click(); // the plain-language messages
      await expect(form.getByText("Unit type is required.")).toBeVisible();
      await settle(page);
      await expect(form).toHaveScreenshot(`master-asf-form-${size}.png`, { maxDiffPixelRatio: 0.01 });
    });

    test(`receipt, letter template preview (${size})`, async ({ page }) => {
      await openMasterData(page, "Letter templates");
      await page.getByRole("row").filter({ hasText: "RECEIPT" }).getByRole("button", { name: /Edit/ }).click();
      await page.getByRole("button", { name: "Preview with sample data" }).click();
      const preview = page.getByTestId("letter-preview");
      await expect(preview).toBeVisible();
      await expect(preview.contentFrame().getByText("Payment Receipt")).toBeVisible();
      // the sandboxed preview frame never reports "network idle": wait for its text and the page's fonts instead
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      await expect(preview).toHaveScreenshot(`receipt-preview-${size}.png`, { maxDiffPixelRatio: 0.01 });
    });
  });
}
