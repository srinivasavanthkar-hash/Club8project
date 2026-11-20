/** Records API responses for the visual / accessibility suites (see e2e/support/fixtures.ts). Opt-in only. */
import { expect, test } from "@playwright/test";
import { signIn } from "./support/stack";
import fs from "node:fs";
import { FIXTURE_FILE, keyOf, type Recording } from "./support/fixtures";

test.skip(!process.env.RECORD_FIXTURES, "set RECORD_FIXTURES=1 to re-record");

test("record API fixtures from the demo stack", async ({ page }) => {
  test.setTimeout(240_000);
  const rec: Recording = { recordedAt: new Date().toISOString(), ids: {}, responses: {} };
  page.on("response", async (res) => {
    const url = new URL(res.url());
    const method = res.request().method();
    const isQuote = url.pathname.endsWith("/reservations/quote");
    const isPreview = url.pathname.endsWith("/admin/letter-templates/preview"); // fictitious sample data only
    if (!url.pathname.startsWith("/api/v1/") || (method !== "GET" && !isQuote && !isPreview) || !res.ok()) return;
    try { rec.responses[`${method} ${keyOf(url)}`] = await res.json(); } catch { /* not JSON */ }
  });
  await page.goto("/login");
  await signIn(page, "demo.admin"); // completes the 2FA step (demo authenticator key)
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const members = await (await page.request.get("/api/v1/members?q=MSMC8-9001")).json();
  const member = members.items[0].id as string;
  const res = await (await page.request.get(`/api/v1/reservations?member_id=${member}`)).json();
  rec.ids = { member, reservation: res.items[0].id };
  const visit = async (url: string) => { await page.goto(url); await page.waitForLoadState("networkidle"); await page.waitForTimeout(500); };
  await visit("/");
  await visit("/leads");
  await visit("/members");
  for (const tab of ["profile", "finance", "reservations", "entitlement", "correspondence", "history"]) await visit(`/members/${member}?tab=${tab}`);
  await page.goto(`/members/${member}?tab=reservations`);
  await page.getByRole("button", { name: "New reservation" }).click();
  await page.getByLabel("Destination", { exact: true }).selectOption({ label: "Goa" });
  await page.getByLabel("Property", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Check-in", { exact: true }).fill("2026-11-16");
  await page.getByLabel("Check-out", { exact: true }).fill("2026-11-19");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await visit(`/reservations/${rec.ids.reservation}`);
  await visit("/activity");
  await visit("/finance");
  // Admin > Master data: the ASF rates form and the receipt template's preview (fictitious sample data)
  await visit("/admin");
  await page.getByRole("tab", { name: "Master data & rates" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Add entry" }).click();
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Master data tables" }).getByRole("button", { name: "Letter templates" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("row").filter({ hasText: "RECEIPT" }).getByRole("button", { name: /Edit/ }).click();
  await page.getByRole("button", { name: "Preview with sample data" }).click();
  await page.getByTestId("letter-preview").waitFor();
  await page.waitForTimeout(500);
  // never keep auth/session data in the recording
  for (const k of Object.keys(rec.responses)) if (k.includes("/auth/") && !k.includes("/auth/me")) delete rec.responses[k];
  fs.mkdirSync(require("node:path").dirname(FIXTURE_FILE), { recursive: true });
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify(rec, null, 1));
});
