import { defineConfig, devices } from "@playwright/test";

/** Runs against a full stack (docker-compose in CI, or scripts/run-e2e-local.sh). */
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  retries: process.env.CI ? 1 : 0,
  // visual.spec.ts: write a baseline the first time a screen/platform is seen, then compare
  updateSnapshots: "missing",
  expect: { timeout: 15_000, toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css" } },
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});
