/**
 * axe-core scan (WCAG 2.1 A/AA rules) of key screens at desktop and phone widths, against recorded FICTITIOUS data.
 * Fails on any serious or critical violation.
 */
import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";
import { expect, test } from "./support/clock";
import { loadRecording, mockApi } from "./support/fixtures";

const rec = loadRecording();
test.skip(!!rec.missing, "no API recording: run RECORD_FIXTURES=1 npx playwright test record-fixtures");
const M = rec.ids.member ?? "missing";
const SCREENS: [string, string][] = [
  ["login", "/login"],
  ["dashboard", "/"],
  ["leads", "/leads"],
  ["members", "/members"],
  ...["profile", "finance", "reservations", "entitlement", "correspondence", "history"].map((t): [string, string] => [`member ${t}`, `/members/${M}?tab=${t}`]),
  ["reservation", `/reservations/${rec.ids.reservation}`],
  ["finance", "/finance"],
  ["activity log", "/activity"],
  ["style guide", "/styleguide"],
];

async function scan(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[aria-busy=true]:not([data-demo] *)")).toHaveCount(0);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

for (const [size, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  test.describe(`a11y ${size}`, () => {
    test.use({ viewport });
    for (const [name, url] of SCREENS) {
      test(`${name} has no serious or critical violations (${size})`, async ({ page }) => {
        if (url !== "/login") await mockApi(page, rec);
        await page.goto(url);
        await scan(page);
      });
    }
  });
}
