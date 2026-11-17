/**
 * Brand screenshots for docs/ui-audit/brand/<BRAND_AUDIT_DIR>/ (login, dashboard, member record at 1440px and 390px).
 * Opt-in: BRAND_AUDIT_DIR=after npx playwright test brand-audit --project=desktop. Fictitious demo data only.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./support/stack";
import path from "node:path";

const DIR = process.env.BRAND_AUDIT_DIR;
const OUT = path.join(__dirname, "..", "..", "docs", "ui-audit", "brand", DIR ?? "unused");
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;

test.skip(!DIR, "set BRAND_AUDIT_DIR to capture brand screenshots");

test("capture brand screens", async ({ page }) => {
  test.setTimeout(180_000);
  const shoot = async (name: string) => {
    for (const [w, size] of Object.entries(SIZES)) {
      await page.setViewportSize(size);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: true });
    }
    await page.setViewportSize(SIZES.desktop);
  };
  await page.setViewportSize(SIZES.desktop);
  await page.goto("/login");
  await shoot("login");
  await signIn(page, "demo.admin"); // completes the 2FA step (demo authenticator key)
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await shoot("dashboard");
  const members = await (await page.request.get("/api/v1/members?q=MSMC8-9001")).json();
  await page.goto(`/members/${members.items[0].id}?tab=profile`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shoot("member-record");
});
