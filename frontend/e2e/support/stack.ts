/**
 * Shared helpers for specs that run against a live stack.
 *
 * requireIsolatedStack(): specs that WRITE data (demo, passwords, tour) call it in beforeAll. It refuses to run
 * unless the API reports `e2e_target: true`, which only the throwaway stack started by scripts/run_e2e.py (or CI)
 * sets. So the suites can never write to the demo database (or any real one).
 *
 * signIn(): the sign-in form, completing the two-step verification step for demo users that have it (demo.admin
 * uses the FICTITIOUS demo authenticator key from backend/app/seed_demo.py).
 */
import { expect, type Page, request } from "@playwright/test";
import { createHmac } from "node:crypto";

export const DEMO_PASSWORD = process.env.CRM_DEMO_PASSWORD ?? "Demo-Passw0rd!";
export const DEMO_TOTP: Record<string, string> = {
  "demo.admin": process.env.CRM_DEMO_TOTP_SECRET ?? "DEMOADMINTWOFACTORKEY234",
};
export const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export async function requireIsolatedStack(): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE });
  try {
    const r = await ctx.get("/api/v1/meta");
    const meta = r.ok() ? ((await r.json()) as { e2e_target?: boolean }) : {};
    if (!meta.e2e_target) {
      throw new Error(
        `Refusing to run: ${BASE} is not a throwaway e2e stack (the API does not report e2e_target). These specs ` +
          "create users and records. Run them with `python scripts/run_e2e.py` (fresh database) instead of against the demo.",
      );
    }
  } finally {
    await ctx.dispose();
  }
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits): acts as the user's authenticator app. */
export function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/\s|=/g, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Sign in through the form; answers the 2FA step for users in DEMO_TOTP (or with `totpSecret`). Waits until the
 * browser has left /login (dashboard or a forced account step). `beforeCode` runs on the 2FA step (screenshots). */
export async function signIn(
  page: Page,
  username: string,
  password = DEMO_PASSWORD,
  opts: { totpSecret?: string; beforeCode?: () => Promise<void> } = {},
): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const secret = opts.totpSecret ?? DEMO_TOTP[username];
  if (secret) {
    const code = page.getByLabel("Two-factor code");
    await expect(code).toBeVisible();
    await opts.beforeCode?.();
    await code.fill(totp(secret));
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
