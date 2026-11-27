/**
 * A fixed "today" for the live-stack suites, so results that depend on the date (year-end rules, booking lead times,
 * overdue instalments) do not change as the calendar moves. README "Tests".
 *
 * - The throwaway stacks run the API with CRM_FIXED_TODAY=E2E_TODAY (scripts/run_e2e.py, CI): the API's business date.
 * - Specs import `test` from here: before each test, the page's clock is set to the API's business date (keeping the
 *   real time of day), so dates the browser works out (defaults such as "payment date = today", "in 3 days") agree
 *   with the server. Only page scripts see it: cookies, tokens and two-step codes keep real time.
 * - Specs work out dates in Node with istToday() below, from the same fixed date.
 * requireIsolatedStack() (support/stack.ts) refuses a stack whose business date is not E2E_TODAY.
 */
import { test as base } from "@playwright/test";

export const E2E_TODAY = process.env.E2E_TODAY ?? "2026-11-16";

function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** E2E_TODAY plus a number of days, as YYYY-MM-DD. */
export function istToday(offsetDays = 0): string {
  return plusDays(E2E_TODAY, offsetDays);
}

/**
 * Two stays in the same membership year, about three weeks out (inside the 7-working-day / 12-month booking window):
 * [check-in, check-out, second check-in, second check-out]. From E2E_TODAY (a Monday) they are Monday-to-Friday and
 * Monday-to-Wednesday. Should E2E_TODAY ever be moved into late December, they move to February next year.
 */
export function stay(): [string, string, string, string] {
  let start = istToday(21);
  if (start.slice(5, 7) === "12" && Number(start.slice(8)) > 10) start = `${Number(start.slice(0, 4)) + 1}-02-02`;
  return [start, plusDays(start, 4), plusDays(start, 7), plusDays(start, 9)];
}

/** Current time of day in India, "HH:MM:SS". */
function istTimeOfDay(): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
}

export const test = base.extend<{ businessDate: string }>({
  businessDate: [
    async ({ page }, use) => {
      const r = await page.request.get("/api/v1/meta");
      const today = r.ok() ? ((await r.json()) as { today?: string }).today : undefined;
      if (today) await page.clock.setSystemTime(new Date(`${today}T${istTimeOfDay()}+05:30`));
      await use(today ?? "");
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
