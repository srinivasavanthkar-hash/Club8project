/**
 * Passwords and account access (docs/PASSWORD_PROMPT.md), end to end. Writes data, so it only runs against a
 * throwaway stack (scripts/run_e2e.py or CI; see support/stack.ts). Users created here have FICTITIOUS names.
 * With TOUR=1 it also saves the walkthrough screenshots to docs/demo-tour/ (chapter 11), all taken as demo.admin
 * or as the staff member concerned.
 *
 *   python scripts/run_e2e.py passwords            (add TOUR=1 for screenshots)
 */
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, type Browser, type Page, request as pwRequest } from "@playwright/test";
import { expect, test } from "./support/clock";
import path from "node:path";
import { BASE, DEMO_PASSWORD, DEMO_TOTP, requireIsolatedStack, signIn, totp } from "./support/stack";

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
  expect(bad.map((v) => `${v.id}: ${v.help} -> ${v.nodes.slice(0, 3).map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
}

type Api = APIRequestContext & { csrf: () => Promise<Record<string, string>> };

/** Plain API session (no browser), with the CSRF header and the 2FA step handled. */
async function apiAs(username: string, password: string): Promise<Api> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  let r = await ctx.post("/api/v1/auth/login", { data: { username, password } });
  if (r.status() === 401 && DEMO_TOTP[username]) {
    r = await ctx.post("/api/v1/auth/login", { data: { username, password, totp_code: totp(DEMO_TOTP[username]!) } });
  }
  expect(r.status(), await r.text()).toBe(200);
  return Object.assign(ctx, {
    csrf: async () => ({ "X-CSRF-Token": (await ctx.storageState()).cookies.find((c) => c.name === "crm_csrf")?.value ?? "" }),
  });
}

const OWN = () => `Amber-Falcon-Orchard-${10 + Math.floor(Math.random() * 89)}`;

/** A fictitious staff member who has already replaced the generated temporary password with their own. A suffix is
 * added only if the name is taken (re-running on the same database). */
async function readyUser(username: string, fullName: string, roles: string[], password = OWN()) {
  const admin = await apiAs("demo.admin", DEMO_PASSWORD);
  let created = await admin.post("/api/v1/admin/users", { data: { username, full_name: fullName, roles }, headers: await admin.csrf() });
  if (created.status() === 409) {
    username = `${username}${Date.now().toString(36).slice(-3)}`;
    created = await admin.post("/api/v1/admin/users", { data: { username, full_name: fullName, roles }, headers: await admin.csrf() });
  }
  expect(created.status(), await created.text()).toBe(201);
  const u = await created.json();
  await admin.dispose();
  const me = await apiAs(username, u.temporary_password);
  const changed = await me.post("/api/v1/auth/change-password", {
    data: { current_password: u.temporary_password, new_password: password },
    headers: await me.csrf(),
  });
  expect(changed.status(), await changed.text()).toBe(200);
  await me.dispose();
  return { username, id: u.id as string, password };
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  return ctx.newPage();
}

test("sign-in: show-password toggle, then the 2FA step for demo.admin", async ({ page }) => {
  await page.goto("/login");
  const pw = page.getByLabel("Password", { exact: true });
  await pw.fill("Quiet-Lantern-River-42");
  await expect(pw).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(pw).toHaveAttribute("type", "text");
  await expect(pw).toHaveValue("Quiet-Lantern-River-42");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  await snap(page, "27-login-show-password");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(pw).toHaveAttribute("type", "password");
  await axe(page);

  await signIn(page, "demo.admin", DEMO_PASSWORD, {
    beforeCode: async () => {
      await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
      await page.getByLabel("Two-factor code").fill("");
      await snap(page, "36-login-2fa-step");
      await axe(page);
    },
  });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("new user: generated temporary password shown once, forced change at first sign-in", async ({ page, browser }) => {
  await signIn(page, "demo.admin");
  await page.goto("/admin");
  await page.getByRole("button", { name: "New user" }).click();
  const drawer = page.getByRole("dialog", { name: "New user" });
  const username = "neha.joshi"; // fresh database on every run (scripts/run_e2e.py)
  await drawer.getByLabel("Username", { exact: true }).fill(username);
  await drawer.getByLabel("Full name", { exact: true }).fill("Neha Joshi");
  await expect(drawer.getByRole("checkbox", { name: "Sales" })).toBeChecked(); // roles: multi-select of existing roles
  await expect(drawer.getByLabel(/password/i)).toHaveCount(0); // admins never type a password for anyone
  await drawer.getByRole("button", { name: "Create user" }).click();
  const dlg = page.getByRole("dialog", { name: `User ${username} created` });
  await expect(dlg.getByText("This password won't be shown again")).toBeVisible();
  const temp = await dlg.getByLabel("Temporary password").inputValue();
  expect(temp).toMatch(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/);
  await expect(dlg.getByLabel("Temporary password")).toHaveAttribute("type", "password");
  await dlg.getByRole("button", { name: "Show password" }).click();
  await snap(page, "28-new-user-temporary-password");
  await axe(page);
  await dlg.getByRole("button", { name: /passed it on/ }).click();
  await expect(dlg).toBeHidden();

  const user = await newPage(browser);
  await signIn(user, username, temp);
  await expect(user).toHaveURL(/\/change-password$/);
  await expect(user.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await user.goto("/members"); // nothing else is reachable
  await expect(user).toHaveURL(/\/change-password$/);
  await user.getByLabel("Temporary password").fill(temp);
  await user.getByLabel("New password", { exact: true }).fill("Copper-Violin-Meadow-58");
  await user.getByLabel("Confirm new password").fill("Copper-Violin-Meadow-58");
  await expect(user.getByTestId("strength-meter")).toContainText(/Strong|Very strong/);
  await snap(user, "29-forced-change-password");
  await axe(user);
  await user.getByRole("button", { name: "Change password" }).click();
  await expect(user.getByRole("heading", { name: "Password changed" })).toBeVisible();
  await user.getByRole("button", { name: "Continue to the dashboard" }).click();
  await expect(user.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await user.context().close();
});

test("server rejects breached passwords with a clear message", async ({ page }) => {
  const u = await readyUser("sana.mirza", "Sana Mirza", ["SALES"]);
  await signIn(page, u.username, u.password);
  await page.goto("/change-password");
  await page.getByLabel("Current password").fill(u.password);
  await page.getByLabel("New password", { exact: true }).fill("password1234");
  await page.getByLabel("Confirm new password").fill("password1234");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("This password has appeared in a data breach. Choose a different one.")).toBeVisible();
  await snap(page, "30-change-password-breached");
});

test("admin reset: temporary password, other sessions end at once", async ({ page, browser }) => {
  const u = await readyUser("rahul.verma", "Rahul Verma", ["SALES"]);
  const userPage = await newPage(browser);
  await signIn(userPage, u.username, u.password);
  await expect(userPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await signIn(page, "demo.admin");
  await page.goto("/admin");
  const row = page.getByRole("row").filter({ hasText: u.username });
  await row.getByRole("button", { name: "Reset password…" }).click();
  const confirm = page.getByRole("dialog", { name: `Reset password for ${u.username}?` });
  await confirm.getByLabel("Reason (required)").fill("Locked out; identity checked by phone");
  await snap(page, "31-admin-reset-dialog");
  await confirm.getByRole("button", { name: "Reset password" }).click();
  const shown = page.getByRole("dialog", { name: `Temporary password for ${u.username}` });
  const temp = await shown.getByLabel("Temporary password").inputValue();
  await shown.getByRole("button", { name: /passed it on/ }).click();
  await expect(row.getByText("Must change password")).toBeVisible();

  await userPage.goto("/members");
  await expect(userPage).toHaveURL(/\/login\?.*reason=session-ended/);
  await expect(userPage.getByText(/Your session ended because your password/)).toBeVisible();
  await snap(userPage, "32-session-ended");
  await signIn(userPage, u.username, temp);
  await expect(userPage).toHaveURL(/\/change-password$/);
  await userPage.context().close();
});

test("change password signs out the other browser", async ({ page, browser }) => {
  const u = await readyUser("farah.khan", "Farah Khan", ["SALES"]);
  const other = await newPage(browser);
  await signIn(other, u.username, u.password);
  await expect(other.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await signIn(page, u.username, u.password);
  await page.getByRole("button", { name: /User menu/ }).click();
  await page.getByRole("menuitem", { name: "Change password" }).click();
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  await expect(page.getByLabel("Sign out of all other devices")).toBeChecked(); // ticked by default
  await page.getByLabel("Current password").fill(u.password);
  await page.getByLabel("New password", { exact: true }).fill("Harbour-Lantern-Velvet-77");
  await page.getByLabel("Confirm new password").fill("Harbour-Lantern-Velvet-77");
  await snap(page, "33-change-password");
  await axe(page);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your other devices have been signed out. This one stays signed in.")).toBeVisible();
  await page.getByRole("button", { name: "Continue to the dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await other.goto("/members");
  await expect(other).toHaveURL(/\/login\?.*reason=session-ended/);
  await other.context().close();
});

test("resetting an ADMIN needs a second admin's approval (demo.admin approves)", async ({ page, browser }) => {
  const target = await readyUser("vikram.iyer", "Vikram Iyer", ["ADMIN"]);
  const requester = await readyUser("meera.nair", "Meera Nair", ["ADMIN"]);
  const req = await newPage(browser);
  await signIn(req, requester.username, requester.password);
  await req.goto("/admin");
  const row = req.getByRole("row").filter({ hasText: target.username });
  await row.getByRole("button", { name: "Reset password…" }).click();
  const confirm = req.getByRole("dialog", { name: `Reset password for ${target.username}?` });
  await expect(confirm.getByText(/A different administrator must approve/)).toBeVisible();
  await confirm.getByLabel("Reason (required)").fill("Admin forgot password, confirmed in person");
  await confirm.getByRole("button", { name: "Request reset" }).click();
  await expect(req.getByText(/Request sent/)).toBeVisible();
  const mine = req.locator("section", { hasText: "waiting for approval" });
  await expect(mine.getByRole("button", { name: "Approve…" })).toHaveCount(0); // not the requester
  await req.context().close();

  await signIn(page, "demo.admin");
  await page.goto("/admin");
  const pending = page.locator("section", { hasText: "waiting for approval" });
  await expect(pending.getByText(target.username)).toBeVisible();
  await snap(page, "34-admin-reset-approval");
  await pending.getByRole("button", { name: "Approve…" }).first().click();
  const approve = page.getByRole("dialog", { name: `Approve the reset of ${target.username}?` });
  await approve.getByLabel("Reason (required)").fill("Confirmed with the requester");
  await approve.getByRole("button", { name: "Approve and issue password" }).click();
  await expect(page.getByRole("dialog", { name: `Temporary password for ${target.username}` })).toBeVisible();
});

test("Reset 2FA: the user must set it up again at next sign-in", async ({ page, browser }) => {
  const u = await readyUser("arjun.mehta", "Arjun Mehta", ["FINANCE"]);
  const me = await apiAs(u.username, u.password);
  const setup = await (await me.post("/api/v1/auth/totp/setup", { headers: await me.csrf() })).json();
  expect((await me.post("/api/v1/auth/totp/confirm", { data: { code: totp(setup.secret) }, headers: await me.csrf() })).status()).toBe(200);
  await me.dispose();

  await signIn(page, "demo.admin");
  await page.goto("/admin");
  const row = page.getByRole("row").filter({ hasText: u.username });
  await expect(row.getByText("2FA on")).toBeVisible();
  await row.getByRole("button", { name: "Reset 2FA…" }).click();
  const confirm = page.getByRole("dialog", { name: `Reset two-step verification for ${u.username}?` });
  await confirm.getByLabel("Reason (required)").fill("Lost phone; identity checked in person");
  await confirm.getByRole("button", { name: "Reset 2FA" }).click();
  await expect(row.getByText("2FA set-up due")).toBeVisible();

  const user = await newPage(browser);
  await signIn(user, u.username, u.password); // same password; no code until enrolled again
  await expect(user).toHaveURL(/\/setup-2fa$/);
  await expect(user.getByText("An administrator reset your two-step verification")).toBeVisible();
  const key = (await user.getByLabel("Set-up key").textContent()) ?? "";
  await snap(user, "35-setup-2fa");
  await axe(user);
  await user.getByLabel("6-digit code").fill(totp(key));
  await user.getByRole("button", { name: "Turn on two-step verification" }).click();
  await expect(user.getByRole("heading", { name: "Two-step verification is on" })).toBeVisible();
  await user.context().close();
});

test("roles are chosen from existing roles with a reason; 2FA policy per role", async ({ page }) => {
  const u = await readyUser("kavya.rao", "Kavya Rao", ["SALES"]);
  await signIn(page, "demo.admin");
  await page.goto("/admin");
  const row = page.getByRole("row").filter({ hasText: u.username });
  await row.getByRole("button", { name: `Edit roles for ${u.username}` }).click();
  const dlg = page.getByRole("dialog", { name: `Roles for ${u.username}` });
  await dlg.getByRole("checkbox", { name: "Finance" }).check();
  await expect(dlg.getByRole("button", { name: "Save roles" })).toBeDisabled(); // reason required
  await dlg.getByLabel("Reason for the change").fill("Also covers the finance desk");
  await dlg.getByRole("button", { name: "Save roles" }).click();
  await expect(row.getByRole("cell").nth(4)).toHaveText(/Finance.*Sales|Sales.*Finance/); // the Roles column

  const policy = page.locator("section", { hasText: "Two-step verification policy" });
  await expect(policy.getByText("Currently optional for everyone")).toBeVisible();
  for (const r of ["Administrator", "Management", "Finance"]) await expect(policy.getByRole("checkbox", { name: new RegExp(`^${r}`) })).not.toBeChecked();
  await policy.getByRole("checkbox", { name: /^Finance/ }).check();
  await policy.getByLabel("Reason for the change").fill("Preview only");
  await policy.scrollIntoViewIfNeeded();
  await snap(page, "37-roles-and-2fa-policy");
  await policy.getByRole("button", { name: "Cancel" }).click(); // leave the default (off) in place
  await expect(policy.getByRole("checkbox", { name: /^Finance/ })).not.toBeChecked();
});
