/**
 * The sign-in page and its images load quickly, every time: a hang in serving an image (Next's image optimiser once
 * left an icon pending for good, Phase 2 report) must fail a test, not a demo. Read-only; any stack. In CI this runs
 * on a fresh stack, right after it starts.
 */
import { expect, test } from "@playwright/test";

const BUDGET_MS = 2000;

test("the login page and its icons load in under 2 seconds, as plain files", async ({ page }) => {
  const images: string[] = [];
  page.on("request", (r) => { if (r.resourceType() === "image") images.push(new URL(r.url()).pathname); });
  const started = Date.now();
  await page.goto("/login", { waitUntil: "load", timeout: BUDGET_MS });
  // every <img> finished and drew something (a pending or broken image keeps complete/naturalWidth false)
  await page.waitForFunction(
    () => [...document.images].length > 0 && [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    undefined,
    { timeout: Math.max(1, BUDGET_MS - (Date.now() - started)) },
  );
  const elapsed = Date.now() - started;
  expect(elapsed, `login page and images took ${elapsed} ms`).toBeLessThan(BUDGET_MS);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // brand images come straight from /brand, never through the image optimiser
  expect(images.length).toBeGreaterThan(0);
  expect(images.filter((p) => p.startsWith("/_next/image"))).toEqual([]);
  const srcs = await page.locator("img").evaluateAll((els) => els.map((e) => new URL((e as HTMLImageElement).currentSrc).pathname));
  expect(srcs.every((s) => s.startsWith("/brand/"))).toBe(true);
});
