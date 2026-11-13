/**
 * Forgot password and reset by email (docs/PASSWORD_PROMPT.md Phase 2), end to end with Mailpit. Writes data, so it
 * only runs against a throwaway stack: `python scripts/run_e2e.py reset` (starts its own Mailpit, MAILPIT_URL).
 * With TOUR=1 it also saves the walkthrough screenshots (chapter 11). Fictitious people and @example.test addresses.
 */
import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, request as pwRequest, test } from "@playwright/test";
import path from "node:path";
import { BASE, DEMO_PASSWORD, DEMO_TOTP, requireIsolatedStack, signIn, totp } from "./support/stack";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:8026";
const OUT = path.join(__dirname, "..", "..", "docs", "demo-tour");
const TOUR = !!process.env.TOUR;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeAll(requireIsolatedStack);

async function snap(page: Page, name: string) {
  if (!TOUR) return;
  await page.waitForLoadState("networkidle");
  // hide toasts for the screenshot only, then show them again (later assertions may look for one)
  const hide = await page.addStyleTag({ content: '[aria-live="polite"].fixed { display: none !important; }' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: "disabled", caret: "hide" });
  await hide.evaluate((el) => el.remove());
}

async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

type Mail = { ID: string; Subject: string };

/** Newest email to `to` in this run's Mailpit (waits for the background send). */
async function latestMail(to: string, subject: RegExp): Promise<{ id: string; text: string; subject: string }> {
  const ctx = await pwRequest.newContext();
  try {
    for (let i = 0; i < 40; i++) {
      const r = await ctx.get(`${MAILPIT}/api/v1/search`, { params: { query: `to:"${to}"` } });
      const list = ((await r.json()) as { messages: Mail[] }).messages.filter((m) => subject.test(m.Subject));
      if (list.length) {
        const msg = await (await ctx.get(`${MAILPIT}/api/v1/message/${list[0]!.ID}`)).json();
        return { id: list[0]!.ID, text: String(msg.Text), subject: list[0]!.Subject };
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`no email to ${to} matching ${subject}`);
  } finally {
    await ctx.dispose();
  }
}

const linkIn = (text: string) => {
  const m = text.match(/https?:\/\/\S+\/reset-password\?token=[A-Za-z0-9_-]+/);
  if (!m) throw new Error("no reset link in the email");
  return m[0];
};

/** A fictitious staff member with a registered email who has set their own password (via the API). */
async function staff(username: string, fullName: string, password: string) {
  const admin = await pwRequest.newContext({ baseURL: BASE });
  let r = await admin.post("/api/v1/auth/login", { data: { username: "demo.admin", password: DEMO_PASSWORD } });
  if (r.status() === 401) r = await admin.post("/api/v1/auth/login", { data: { username: "demo.admin", password: DEMO_PASSWORD, totp_code: totp(DEMO_TOTP["demo.admin"]!) } });
  const csrf = async (c: typeof admin) => ({ "X-CSRF-Token": (await c.storageState()).cookies.find((k) => k.name === "crm_csrf")?.value ?? "" });
  const email = `${username}@example.test`;
  const created = await admin.post("/api/v1/admin/users", { data: { username, full_name: fullName, roles: ["SALES"], email }, headers: await csrf(admin) });
  expect(created.status(), await created.text()).toBe(201);
  const temp = (await created.json()).temporary_password as string;
  await admin.dispose();
  const me = await pwRequest.newContext({ baseURL: BASE });
  await me.post("/api/v1/auth/login", { data: { username, password: temp } });
  const ch = await me.post("/api/v1/auth/change-password", { data: { current_password: temp, new_password: password }, headers: await csrf(me) });
  expect(ch.status(), await ch.text()).toBe(200);
  return { username, email, password, api: me, csrf: () => csrf(me) };
}

test("forgot password → email → reset → sign in", async ({ page }) => {
  const u = await staff("priya.sharma", "Priya Sharma", "Lotus-Granite-Ember-61");
  await u.api.dispose();
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await axe(page);
  await page.getByLabel("Username or email").fill(u.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText("If an account matches, we've sent password reset instructions to its registered email.")).toBeVisible();
  await snap(page, "38-forgot-confirmation");

  const mail = await latestMail(u.email, /Reset your Club8 CRM password/);
  expect(mail.text).toContain("valid for 30 minutes");
  expect(mail.text).toContain("If you didn't request this, you can ignore this email");
  if (TOUR) {
    const inbox = await page.context().newPage();
    await inbox.setViewportSize({ width: 1440, height: 900 });
    await inbox.goto(`${MAILPIT}/view/${mail.id}`);
    await inbox.waitForLoadState("networkidle");
    await snap(inbox, "39-reset-email-mailpit");
    await inbox.close();
  }

  await page.goto(linkIn(mail.text));
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/); // the token is removed from the address bar
  await page.getByLabel("New password", { exact: true }).fill("Saffron-Kestrel-Lagoon-47");
  await page.getByLabel("Confirm new password").fill("Saffron-Kestrel-Lagoon-47");
  await expect(page.getByTestId("strength-meter")).toContainText(/Strong|Very strong/);
  await snap(page, "40-reset-form");
  await axe(page);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("heading", { name: "Your password has been changed" })).toBeVisible();
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await expect(page.getByText("Your password has been changed. Sign in with your new password.")).toBeVisible();
  await signIn(page, u.username, "Saffron-Kestrel-Lagoon-47");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const notice = await latestMail(u.email, /Your password was changed/);
  expect(notice.text).toContain("If this wasn't you, contact your administrator immediately.");

  // the same link again: used links are refused with the generic message
  await page.context().clearCookies();
  await page.goto(linkIn(mail.text));
  await expect(page.getByRole("heading", { name: "This reset link is invalid or has expired" })).toBeVisible();
  await snap(page, "41-reset-link-invalid");
  await page.getByRole("link", { name: "Request a new link" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
});

test("an older link stops working when a newer one is requested; unknown accounts get the same answer", async ({ page }) => {
  const u = await staff("rohan.das", "Rohan Das", "Tamarind-Beacon-Orbit-23");
  await u.api.dispose();
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  for (const id of [u.username, "nobody.at.all"]) {
    const r = await ctx.post("/api/v1/auth/forgot-password", { data: { identifier: id } });
    expect(r.status()).toBe(202);
    expect((await r.json()).message).toContain("If an account matches");
  }
  const first = linkIn((await latestMail(u.email, /Reset your/)).text);
  await ctx.post("/api/v1/auth/forgot-password", { data: { identifier: u.email } });
  await expect.poll(async () => linkIn((await latestMail(u.email, /Reset your/)).text)).not.toBe(first);
  await ctx.dispose();
  await page.goto(first);
  await expect(page.getByRole("heading", { name: "This reset link is invalid or has expired" })).toBeVisible();
});

test("a reset needs the 2FA code when 2FA is on", async ({ page }) => {
  const u = await staff("ishaan.kapoor", "Ishaan Kapoor", "Monsoon-Quartz-Pebble-82");
  const setup = await (await u.api.post("/api/v1/auth/totp/setup", { headers: await u.csrf() })).json();
  expect((await u.api.post("/api/v1/auth/totp/confirm", { data: { code: totp(setup.secret) }, headers: await u.csrf() })).status()).toBe(200);
  await u.api.dispose();
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await ctx.post("/api/v1/auth/forgot-password", { data: { identifier: u.username } });
  await ctx.dispose();
  await page.goto(linkIn((await latestMail(u.email, /Reset your/)).text));
  const code = page.getByLabel("6-digit code from your authenticator app");
  await expect(code).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill("Harvest-Cobalt-Willow-35");
  await page.getByLabel("Confirm new password").fill("Harvest-Cobalt-Willow-35");
  await code.fill("000000");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText("That code didn't match")).toBeVisible();
  await code.fill(totp(setup.secret));
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("heading", { name: "Your password has been changed" })).toBeVisible();
});

test("admin option A: send a reset link (demo.admin)", async ({ page }) => {
  const u = await staff("ananya.bose", "Ananya Bose", "Coral-Thistle-Meteor-58");
  await u.api.dispose();
  await signIn(page, "demo.admin");
  await page.goto("/admin");
  const row = page.getByRole("row").filter({ hasText: u.username });
  await row.getByRole("button", { name: "Reset password…" }).click();
  const dlg = page.getByRole("dialog", { name: `Reset password for ${u.username}?` });
  await expect(dlg.getByRole("radio", { name: /Email a reset link/ })).toBeChecked(); // default when there's an email
  await dlg.getByLabel("Reason (required)").fill("Locked out; asked for a link by phone");
  await snap(page, "42-admin-reset-options");
  await dlg.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/Reset link sent to a\*\*\*@example.test/)).toBeVisible();
  const mail = await latestMail(u.email, /Reset your/);
  expect(mail.text).toContain("An administrator has sent you a link");
  await page.context().clearCookies();
  await page.goto(linkIn(mail.text));
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
});
