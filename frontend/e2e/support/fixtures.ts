/* Recorded API responses for deterministic visual-regression and accessibility tests.
 * Recorded from the Section 14 demo (FICTITIOUS data only) with:
 *   RECORD_FIXTURES=1 npx playwright test record-fixtures --project=desktop
 * Replayed by mockApi(): GET /api/v1/* is answered from the recording, so these tests need only the Next.js server. */
import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const FIXTURE_FILE = path.join(__dirname, "..", "fixtures", "api-recording.json");

export type Recording = { recordedAt: string; ids: Record<string, string>; responses: Record<string, unknown> };

export const keyOf = (url: URL) => {
  const params = [...url.searchParams.entries()].sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y));
  return `${url.pathname}?${new URLSearchParams(params).toString()}`;
};

/** The recording, or an empty stub (tests then skip) when it has not been recorded yet. */
export function loadRecording(): Recording & { missing?: boolean } {
  if (!fs.existsSync(FIXTURE_FILE)) return { recordedAt: new Date().toISOString(), ids: {}, responses: {}, missing: true };
  return JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8")) as Recording;
}

/** Serve the recording; freeze the clock at the recording time so relative dates ("in 12 days") are stable. */
export async function mockApi(page: Page, rec: Recording) {
  await page.clock.setFixedTime(new Date(rec.recordedAt));
  await page.context().addCookies([{ name: "crm_csrf", value: "visual-test", url: "http://127.0.0.1:3000" }, { name: "crm_csrf", value: "visual-test", url: "http://localhost:3000" }]);
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" && !url.pathname.endsWith("/reservations/quote")) {
      return route.fulfill({ status: 204 });
    }
    const exact = rec.responses[`${route.request().method()} ${keyOf(url)}`];
    const loose = exact ?? Object.entries(rec.responses).find(([k]) => k.startsWith(`${route.request().method()} ${url.pathname}?`))?.[1];
    if (loose === undefined) return route.fulfill({ status: 404, json: { title: "Not recorded", status: 404, detail: "Not recorded", code: "NotRecorded" } });
    return route.fulfill({ status: 200, json: loose });
  });
}
