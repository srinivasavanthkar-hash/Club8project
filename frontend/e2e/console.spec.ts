/**
 * Key pages load without console errors: no React hydration errors (#418: server and browser rendering different
 * text, e.g. dates in different time zones), no uncaught exceptions, no failed API calls. Live stack, signed in.
 */
import { expect, type Page, test } from "@playwright/test";
import { requireIsolatedStack, signIn } from "./support/stack";

test.beforeAll(requireIsolatedStack); // signing in writes activity-log entries

const PAGES: [string, string][] = [
  ["dashboard", "/"],
  ["activity log", "/activity"],
  ["members", "/members"],
  ["leads", "/leads"],
  ["reservations", "/reservations"],
  ["finance", "/finance"],
  ["administration", "/admin"],
];

function collect(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

test.describe("no console errors", () => {
  test.use({ timezoneId: "America/New_York" }); // a browser outside India must render the same IST dates as the server

  for (const [name, url] of PAGES) {
    test(`${name} loads without console errors`, async ({ page }) => {
      await signIn(page, "demo.manager");
      const problems = collect(page);
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main")).toBeVisible();
      if (url === "/admin") {
        await page.getByRole("tab", { name: "Master data & rates" }).click();
        await page.waitForLoadState("networkidle");
      }
      expect(problems).toEqual([]);
    });
  }

  test("a member record loads without console errors", async ({ page }) => {
    await signIn(page, "demo.manager");
    const list = (await (await page.request.get("/api/v1/members?page_size=1")).json()) as { items: { id: string }[] };
    test.skip(list.items.length === 0, "no members on this stack (run_e2e.py --scenario adds them)");
    const problems = collect(page);
    await page.goto(`/members/${list.items[0]!.id}`); // a full page load: the record is server-rendered, then hydrated
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
