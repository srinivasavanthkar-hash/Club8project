import { defineConfig, devices } from "@playwright/test";

/** Runs against a full stack (docker-compose in CI, or scripts/run-e2e-local.sh). */
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  retries: process.env.CI ? 1 : 0,
  // visual.spec.ts: always compare; a missing reference image FAILS (never silently created). References are made
  // on purpose in the official Playwright image: sh scripts/visual.sh --update
  updateSnapshots: "none",
  expect: { timeout: 15_000, toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css" } },
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    // as the staff use it: Indian English (date pickers day-first) and IST
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});
