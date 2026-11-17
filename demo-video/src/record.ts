/**
 * Records the Club8 CRM demo video (docs/DEMO_VIDEO_PROMPT.md). See demo-video/README.md.
 *
 *   npm run record                     full run: fresh crm_video stack, all sections, assemble the MP4
 *   npm run record -- --section 6      re-record one section (earlier sections replay unrecorded to recreate data)
 *   npm run record -- --no-build       reuse the previous recording frontend build
 *   npm run record -- --db embedded    database in embedded PostgreSQL instead of a Docker container (no Docker)
 *   npm run assemble                   only re-assemble out/clips into the MP4 (e.g. after editing nothing)
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as OTPAuth from "otpauth";
import { type Browser, type BrowserContext, type Cookie, type Page, chromium, request } from "playwright";
import { assemble } from "./assemble";
import { type CaptionEvent, Director, NAME_SHIM, OVERLAY_SCRIPT, PACE, TOUCH_SCRIPT } from "./overlay";
import { PHONE, Screencast } from "./screencast";
import { BASE, DB_MODES, type DbMode, MAILPIT, ROOT, startStack } from "./stack";

export const OUT = path.join(ROOT, "demo-video", "out");
export const CLIPS = path.join(OUT, "clips");
const PASSWORD = "Demo-Passw0rd!"; // FICTITIOUS demo password (backend/app/seed_demo.py)
const DEMO_TOTP_KEY = "DEMOADMINTWOFACTORKEY234"; // FICTITIOUS demo authenticator key (seed_demo.py)
const ROLES: Record<string, string> = {
  "demo.sales": "Sales", "demo.manager": "Management", "demo.finance": "Finance", "demo.reservations": "Reservations",
  "demo.service": "Member services", "demo.admin": "Administrator",
};

// ---------------------------------------------------------------- fictitious people (title card says so)
const LEAD = { name: "Ananya Rao", mobile: "9000000001", email: "ananya.rao@example.com", city: "Bengaluru", pan: "ABCDE1234F" };

export type ClipMeta = { id: number; title: string; file: string; duration: number; captions: CaptionEvent[]; phone?: boolean };
type Shared = { leadUrl?: string; memberUrl?: string; resUrl?: string; checkIn?: string; checkOut?: string };
type MasterRow = { id: string; code: string };

const totp = () => new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(DEMO_TOTP_KEY), digits: 6, period: 30 }).generate();

/** Session cookies for a role, from a sign-in through the API (the visible sign-ins are in sections 1 and 8). */
async function sessionCookies(user: string): Promise<Cookie[]> {
  const ctx = await request.newContext({ baseURL: BASE });
  let r = await ctx.post("/api/v1/auth/login", { data: { username: user, password: PASSWORD } });
  if (r.status() === 401) r = await ctx.post("/api/v1/auth/login", { data: { username: user, password: PASSWORD, totp_code: totp() } });
  if (!r.ok()) throw new Error(`sign-in for ${user} failed: ${r.status()} ${await r.text()}`);
  const cookies = (await ctx.storageState()).cookies as Cookie[];
  await ctx.dispose();
  return cookies;
}

/** API calls as a role, for set-up the video doesn't show (CSRF double-submit header included). */
async function apiAs(user: string) {
  const ctx = await request.newContext({ baseURL: BASE });
  let r = await ctx.post("/api/v1/auth/login", { data: { username: user, password: PASSWORD } });
  if (r.status() === 401) r = await ctx.post("/api/v1/auth/login", { data: { username: user, password: PASSWORD, totp_code: totp() } });
  if (!r.ok()) throw new Error(`sign-in for ${user} failed: ${r.status()} ${await r.text()}`);
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === "crm_csrf")?.value ?? "";
  const call = async <T>(method: "GET" | "POST", p: string, data?: unknown): Promise<T> => {
    const res = await ctx.fetch(`/api/v1${p}`, { method, data, headers: { "X-CSRF-Token": csrf } });
    if (!res.ok()) throw new Error(`${method} ${p}: ${res.status()} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const master = async (slug: string, code: string) => (await call<MasterRow[]>("GET", `/admin/master/${slug}`)).find((x) => x.code === code)!;
  return { call, master, dispose: () => ctx.dispose() };
}

const addDays = (iso: string, n: number) => new Intl.DateTimeFormat("en-CA").format(new Date(new Date(`${iso}T12:00:00`).getTime() + n * 86_400_000));

function stay(): [string, string] {
  let d = new Date(Date.now() + 21 * 86_400_000);
  if (d.getMonth() === 11 && d.getDate() > 10) d = new Date(d.getFullYear() + 1, 1, 2);
  const iso = (x: Date) => new Intl.DateTimeFormat("en-CA").format(x);
  return [iso(d), iso(new Date(d.getTime() + 4 * 86_400_000))];
}
const istMonth = (offsetDays: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + offsetDays * 86_400_000)).slice(0, 7);
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

// ---------------------------------------------------------------- error guard (the run fails on any of these)
class Guard {
  readonly errors: string[] = [];
  private allowed: { status: number; path: RegExp }[] = [];
  private responses: { url: string; status: number }[] = [];
  watch(page: Page): void {
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (/Failed to load resource/.test(text)) return; // judged from the response itself, below
      this.errors.push(`console: ${text}`);
    });
    page.on("pageerror", (e) => this.errors.push(`page error: ${e.message}`));
    page.on("response", (r) => {
      const s = r.status();
      if (s < 400) return;
      const url = r.url();
      if (this.allowed.some((a) => a.status === s && a.path.test(url))) return;
      this.errors.push(`HTTP ${s} ${r.request().method()} ${url}`);
    });
    page.on("requestfailed", (r) => {
      const f = r.failure()?.errorText ?? "";
      if (/ERR_ABORTED/.test(f)) return; // navigations that replace a pending request
      this.errors.push(`request failed: ${r.url()} ${f}`);
    });
  }
  /** Declare an expected refusal (e.g. Confirm while the ASF is unpaid) for the duration of `fn`. */
  async expect<T>(status: number, pathRe: RegExp, fn: () => Promise<T>): Promise<T> {
    const a = { status, path: pathRe };
    this.allowed.push(a);
    try { return await fn(); } finally { this.allowed = this.allowed.filter((x) => x !== a); }
  }
  async check(page: Page): Promise<void> {
    const toasts = await page.locator('[aria-live="polite"].fixed [role="alert"]').allTextContents().catch(() => []);
    for (const t of toasts) this.errors.push(`error toast: ${t}`);
    const h1 = (await page.locator("h1").first().textContent({ timeout: 500 }).catch(() => "")) ?? "";
    if (/Page not found|Something went wrong/.test(h1)) this.errors.push(`error page: ${h1}`);
  }
}

// ---------------------------------------------------------------- one clip
type Ctx = { browser: Browser; shared: Shared; record: boolean };
type Section = { id: number; title: string; phone?: boolean; card?: string; hold?: number; run?: (s: Scene) => Promise<void> };

class Scene {
  /** Starts the recording once the section's first screen is settled (set per clip). */
  begin: () => Promise<void> = async () => undefined;
  /** Continue recording after navigating to another site (set per clip). */
  reattach: () => Promise<void> = async () => undefined;
  /** Hold the picture while a page loads (set per clip). */
  freeze: () => void = () => undefined;
  thaw: () => Promise<void> = async () => undefined;

  constructor(readonly page: Page, readonly ctx: BrowserContext, readonly d: Director, readonly guard: Guard, readonly shared: Shared) {}

  /** Switch the signed-in user without showing a sign-in: swap the session cookies and reload. */
  async signInAs(user: string, opts: { announce?: boolean; path?: string } = {}): Promise<void> {
    await this.ctx.clearCookies();
    const cookies = await sessionCookies(user);
    if (process.env.DEMO_DEBUG) console.log(`    [debug] ${user}: ${cookies.map((c) => `${c.name}@${c.domain}${c.path}`).join(", ")}`);
    await this.ctx.addCookies(cookies);
    if (opts.announce !== false) await this.d.caption(`Now signed in as ${ROLES[user]}`);
    const target = opts.path ?? this.page.url();
    this.freeze();
    await this.page.goto(target);
    await this.d.settle();
    if (new URL(this.page.url()).pathname.startsWith("/login")) {
      // seen once in a full run right after the visible 2FA sign-in, not reproducible: sign in again and retry
      console.warn(`    session for ${user} was not accepted; signing in again`);
      await this.ctx.clearCookies();
      await this.ctx.addCookies(await sessionCookies(user));
      await this.page.goto(target);
      await this.d.settle();
      if (new URL(this.page.url()).pathname.startsWith("/login")) throw new Error(`could not sign in as ${user}`);
    }
    await this.thaw();
    if (opts.announce !== false) await this.d.pause(2600);
  }

  async go(p: string): Promise<void> {
    this.freeze();
    await this.page.goto(p);
    await this.d.settle();
    await this.thaw();
  }

  async tab(name: string): Promise<void> {
    await this.d.click(this.page.getByRole("tab", { name: new RegExp(`^${name}`) }));
    await this.d.settle();
  }

  async step(caption: string, ms = PACE.read): Promise<void> {
    await this.d.caption(caption);
    await this.d.pause(ms);
  }
}

/** Runs a section; `scene.begin()` (called by the section once its first screen is settled) starts the recording. */
async function runSection(c: Ctx, sec: Section): Promise<ClipMeta | null> {
  const phone = !!sec.phone;
  const vp = phone ? PHONE : { width: 1920, height: 1080 };
  // The screencast captures the browser window (not the emulated viewport): the phone clip gets its own window,
  // at device pixel ratio 2 so the phone screen stays sharp when it is placed on the 1080p background.
  const phoneBrowser = phone ? await chromium.launch(browserOptions([`--window-size=${PHONE.width},${PHONE.height}`, "--force-device-scale-factor=2"])) : null;
  const context = await (phoneBrowser ?? c.browser).newContext({
    viewport: vp,
    deviceScaleFactor: phone ? 2 : 1,
    isMobile: phone,
    hasTouch: phone,
    baseURL: BASE,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  });
  await context.addInitScript(NAME_SHIM); // every page, recorded or not
  if (phone || sec.card) await context.addInitScript(TOUCH_SCRIPT); // no pointer on the phone or the cards
  if (c.record) await context.addInitScript(OVERLAY_SCRIPT);
  const page = await context.newPage();
  const guard = new Guard();
  guard.watch(page);
  const d = new Director(page, { fast: !c.record, touch: phone, externalCaptions: phone });
  const scene = new Scene(page, context, d, guard, c.shared);
  const file = path.join(CLIPS, `${String(sec.id).padStart(2, "0")}.mp4`);
  const cast = c.record ? new Screencast(page, path.join(OUT, "frames", String(sec.id)), phone ? 2 : 1) : null;
  scene.reattach = async () => { await cast?.reattach(); };
  scene.freeze = () => cast?.freeze();
  scene.thaw = async () => { await cast?.thaw(); };
  scene.begin = async () => {
    await d.settle();
    if (!cast) return;
    await cast.begin();
    d.t0 = cast.start * 1000;
  };
  try {
    if (sec.card) {
      await page.goto(pathToFileURL(path.join(ROOT, "demo-video", "cards", sec.card)).href);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      // restart the card's entrance animation once capture is running
      await scene.begin();
      await page.evaluate(() => { const el = document.querySelector(".card") as HTMLElement; el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; });
      await page.waitForTimeout(sec.hold ?? 6000);
    } else {
      await sec.run!(scene);
      await d.caption(null);
      await d.pause(400);
    }
    await guard.check(page);
    d.finish();
    if (guard.errors.length) throw new Error(`Section ${sec.id} (${sec.title}) had errors:\n  ${guard.errors.join("\n  ")}`);
    if (!cast) return null;
    const duration = await cast.end(file);
    const meta: ClipMeta = { id: sec.id, title: sec.title, file, duration, captions: d.captions, phone };
    fs.writeFileSync(file.replace(/\.mp4$/, ".json"), JSON.stringify(meta, null, 1));
    console.log(`    recorded ${sec.title}: ${duration.toFixed(1)} s, ${d.captions.length} captions`);
    return meta;
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, `failed-section-${sec.id}.png`) }).catch(() => undefined);
    console.error(`    section ${sec.id} failed; screen saved to out/failed-section-${sec.id}.png`);
    throw e;
  } finally {
    await context.close();
    await phoneBrowser?.close();
  }
}

// ---------------------------------------------------------------- the storyboard
const SECTIONS: Section[] = [
  { id: 0, title: "Title", card: "title.html", hold: 6000 },

  {
    id: 1, title: "Sign in and dashboard",
    run: async (s: Scene) => {
      const { page, d } = s;
      await s.go("/login");
      await s.begin();
      await s.step("Every member of staff signs in with their own account.", 2200);
      await d.type(page.getByLabel("Username", { exact: true }), "demo.sales");
      await d.type(page.getByLabel("Password", { exact: true }), PASSWORD);
      await d.caption("The eye button shows what was typed, then hides it again.");
      await d.click(page.getByRole("button", { name: "Show password" }));
      await d.pause(1500);
      await d.click(page.getByRole("button", { name: "Hide password" }));
      await d.pause(800);
      await d.click(page.getByRole("button", { name: "Sign in" }));
      await page.getByRole("heading", { name: "Dashboard" }).waitFor();
      await d.settle();
      await s.step("The dashboard opens on what needs attention today.", 3200);
      await d.caption("Find any member or lead in seconds: membership number, name or mobile.");
      await d.click(page.getByLabel("Search membership no., lead ID, name, mobile").or(page.getByLabel("Search members and leads")).first());
      await page.keyboard.type("9001", { delay: d.mode.fast ? 0 : PACE.typeMs });
      await page.getByRole("listbox").waitFor();
      await d.pause(2800);
      await page.keyboard.press("Escape");
    },
  },

  {
    id: 2, title: "Capture a lead",
    run: async (s: Scene) => {
      const { page, d } = s;
      await s.signInAs("demo.sales", { announce: false, path: "/leads/new" });
      await s.begin();
      await d.caption("A street lead is captured in under a minute.");
      await d.type(page.getByLabel("Prospect name", { exact: true }), LEAD.name);
      await d.type(page.getByLabel("Mobile", { exact: true }), LEAD.mobile);
      await d.type(page.getByLabel("Email", { exact: true }), LEAD.email);
      await d.type(page.getByLabel("City", { exact: true }), LEAD.city);
      await d.type(page.getByLabel("OPC / marketer name", { exact: true }), "Demo OPC");
      await d.click(page.getByRole("button", { name: "Save lead" }));
      await page.getByRole("heading", { name: new RegExp(LEAD.name) }).waitFor();
      await d.settle();
      s.shared.leadUrl = page.url();
      await s.step("Each lead gets its own number and starts as New.", 2800);
      await d.caption("The lead moves through the sales stages as the conversation progresses.");
      await d.click(page.getByRole("button", { name: "CONTACTED" }));
      await page.getByTestId("lead-status").filter({ hasText: "CONTACTED" }).waitFor();
      await d.fill(page.getByLabel(/Presentation date & time/), `${istToday()}T11:00`);
      await d.click(page.getByRole("button", { name: "PRESENTATION SCHEDULED" }));
      await page.getByTestId("lead-status").filter({ hasText: "PRESENTATION SCHEDULED" }).waitFor();
      await d.click(page.getByRole("button", { name: "ATTENDED" }));
      await page.getByTestId("lead-status").filter({ hasText: "ATTENDED" }).waitFor();
      await d.settle();
      await d.caption("Every status change is kept in the lead's history.");
      await d.scrollTo(page.getByText(/history/i).last());
      await d.pause(2800);
    },
  },

  {
    id: 3, title: "Convert to member",
    run: async (s: Scene) => {
      const { page, d } = s;
      await s.signInAs("demo.sales", { announce: false, path: s.shared.leadUrl });
      await s.begin();
      await d.caption("After the presentation, the lead converts to a member in one step.");
      await d.pause(1800);
      await d.click(page.getByRole("link", { name: "Convert to member" }));
      await page.getByLabel("1st Applicant Name", { exact: true }).waitFor();
      await d.settle();
      await s.step("The form follows the paper membership form, top to bottom, already filled from the lead.", 2600);
      await d.fill(page.getByLabel("D.O.B", { exact: true }), "1990-04-12");
      await d.type(page.getByLabel("ID number", { exact: true }), LEAD.pan);
      await d.type(page.getByLabel("Address Line 1", { exact: true }), "21 Demo Layout");
      await d.type(page.getByLabel("Post Code", { exact: true }), "560001");
      await d.select(page.getByLabel("State", { exact: true }), "Karnataka");
      await d.caption("Membership: brand, category, season, unit and nights per year.");
      await d.select(page.getByLabel("Company / brand", { exact: true }), "CLUB8 Holidays (MSMC8-)");
      await d.select(page.getByLabel("Category (Membership Type)", { exact: true }), "Premium (PREMIUM)");
      await d.select(page.getByLabel("Season", { exact: true }), "Red (RED)");
      await d.select(page.getByLabel("Unit Type", { exact: true }), "T0 = Studio (2 adults + 2 children below 10 years)");
      await d.type(page.getByLabel("No. of Nights per Year", { exact: true }), "7");
      await d.caption("Payment: totals and balance are calculated as you type.");
      await d.type(page.getByLabel("Purchase Price", { exact: true }), "250000");
      await d.type(page.getByLabel("Admin Fees", { exact: true }), "5000");
      await d.type(page.getByLabel("Down Payment", { exact: true }), "55000");
      await d.star(page.getByLabel("Balance", { exact: true }).locator("xpath=ancestor::div[contains(@class,'grid')][1]"), 3800);
      await d.select(page.getByLabel("By (payment method)", { exact: true }), "Card (CARD)");
      await d.type(page.getByLabel("Transaction / approval reference", { exact: true }), "DEMO-CARD-001");
      await d.type(page.getByLabel("Card last 4 digits (optional)", { exact: true }), "4242");
      await d.caption("The balance is paid in monthly EMIs. Only the last 4 card digits are ever stored.");
      await d.select(page.getByLabel("Balance Mode", { exact: true }), "EMI");
      // The form validates a field when it is left, and the "EMI amount, number and starting month are required" rule
      // fires on the first of the three left while the others are empty. Hold those blur events back until all three
      // are filled, so the error doesn't flash; the typing itself stays real.
      await page.evaluate(() => {
        const ids = ["emi", "emin", "emis"];
        const hold = (e: Event) => { if (ids.includes((e.target as HTMLElement | null)?.id ?? "")) e.stopImmediatePropagation(); };
        (window as unknown as { __demoHold: typeof hold }).__demoHold = hold;
        window.addEventListener("focusout", hold, true);
        window.addEventListener("blur", hold, true);
      });
      await d.type(page.getByLabel("EMI Amount", { exact: true }), "20000");
      await d.type(page.getByLabel("No. of EMIs", { exact: true }), "10");
      await d.fill(page.getByLabel("Starting From (MM/YYYY)", { exact: true }), istMonth(35));
      await page.evaluate(() => {
        const hold = (window as unknown as { __demoHold: (e: Event) => void }).__demoHold;
        window.removeEventListener("focusout", hold, true);
        window.removeEventListener("blur", hold, true);
      });
      await d.check(page.getByLabel("1st Applicant signed", { exact: true }));
      await d.check(page.getByLabel("Signed on behalf of the Company", { exact: true }));
      await d.click(page.getByRole("button", { name: "Create member & convert lead" }));
      await page.getByRole("heading", { name: /^MSMC8-/ }).waitFor();
      await d.settle();
      s.shared.memberUrl = page.url().split("?")[0]!;
      // the recording must show the right numbers: fail rather than record a typo
      await page.getByText("7.0 nights / year").first().waitFor({ timeout: 5000 });
      await page.getByText("₹2,00,000.00").first().waitFor({ timeout: 5000 });
      await s.step("The new member gets a membership number and waits for a manager's approval.", 3200);
    },
  },

  {
    id: 4, title: "Approve",
    run: async (s: Scene) => {
      const { page, d } = s;
      await s.signInAs("demo.sales", { announce: false, path: `${s.shared.memberUrl}?tab=correspondence` });
      await s.begin();
      await d.caption("Sales uploads the signed membership agreement.");
      await d.select(page.getByLabel("Document type", { exact: true }), "Membership Agreement (signed)");
      await d.moveTo(page.getByLabel("File (PDF, JPEG, PNG)", { exact: true }));
      await page.getByLabel("File (PDF, JPEG, PNG)", { exact: true }).setInputFiles({ name: "signed-agreement-ananya-rao.pdf", mimeType: "application/pdf", buffer: PDF });
      await page.getByText("signed-agreement-ananya-rao.pdf", { exact: true }).waitFor();
      await d.pause(2000);
      await s.signInAs("demo.manager", { path: `${s.shared.memberUrl}?tab=profile` });
      await d.caption("The approval panel checks everything the agreement requires.");
      await d.star(page.getByText("All checks passed").locator("xpath=ancestor::*[contains(@class,'rounded')][1]"), 3800);
      await d.click(page.getByRole("button", { name: "Approve member" }));
      await page.getByText("ACTIVE", { exact: true }).first().waitFor();
      await d.settle();
      await s.step("Approved: the member is now Active.", 2800);
      await d.caption("Entitlement appears straight away: 7 nights for each of the 10 years.");
      await s.tab("Entitlement");
      // the caption promises 7 nights: fail rather than record a stale 0.0 (header or table)
      const thisYear = page.getByRole("row").filter({ hasText: "(current year)" });
      await thisYear.getByRole("cell").nth(1).filter({ hasText: /^7\.0$/ }).waitFor({ timeout: 5000 });
      await page.getByRole("link", { name: /Nights left in/ }).filter({ hasText: "7.0" }).waitFor({ timeout: 5000 });
      await d.pause(3200);
    },
  },

  {
    id: 5, title: "Payments",
    run: async (s: Scene) => {
      const { page, d } = s;
      await s.signInAs("demo.finance", { announce: false, path: `${s.shared.memberUrl}?tab=finance` });
      await s.begin();
      await d.caption("Signed in as Finance. The card down payment is already in the ledger.");
      await d.pause(2800);
      await d.caption("One click creates the EMI schedule from the application.");
      await d.click(page.getByRole("button", { name: "Generate EMI schedule" }));
      await page.getByRole("cell", { name: "10", exact: true }).first().waitFor();
      await d.settle();
      await d.pause(2000);
      await d.caption("Recording a payment: Cash is not offered, and a reference is required.");
      await d.click(page.getByRole("button", { name: "Record payment" }));
      const dlg = page.getByRole("dialog", { name: "Record payment" });
      await d.type(dlg.getByLabel("Amount", { exact: true }), "20000");
      await d.select(dlg.getByLabel("Method", { exact: true }), "UPI");
      await d.type(dlg.getByLabel("Transaction / approval reference", { exact: true }), "DEMO-UPI-0001");
      await d.click(dlg.getByRole("button", { name: /Save payment/ }));
      await page.getByRole("cell", { name: "MEMBERSHIP_EMI" }).first().waitFor();
      await d.settle();
      await d.caption("Instalment 1 is now Paid, and a receipt is produced.");
      await d.scrollTo(page.getByRole("cell", { name: "PAID", exact: true }).first());
      await d.pause(2400);
      await d.click(page.getByRole("button", { name: "Receipt" }).first());
      await page.getByTestId("doc-preview").waitFor();
      await page.waitForTimeout(d.mode.fast ? 0 : 6500); // the PDF viewer renders the receipt
      await d.pause(2000);
      await page.keyboard.press("Escape");
      await d.pause(500);
    },
  },

  {
    id: 6, title: "Book a stay",
    run: async (s: Scene) => {
      const { page, d, guard } = s;
      const [ci, co] = stay();
      s.shared.checkIn = ci; s.shared.checkOut = co;
      await s.signInAs("demo.reservations", { announce: false, path: `${s.shared.memberUrl}?tab=reservations` });
      await s.begin();
      await d.caption("Reservations books a stay for the member: Goa, 4 nights.");
      await d.click(page.getByRole("button", { name: "New reservation" }));
      await d.select(page.getByLabel("Destination", { exact: true }), "Goa");
      await d.select(page.getByLabel("Property", { exact: true }), "Demo Beach Resort (Premium)");
      await d.fill(page.getByLabel("Check-in", { exact: true }), ci);
      await d.fill(page.getByLabel("Check-out", { exact: true }), co);
      await page.getByText(/ASF payable: \d{4}: ₹12,600\.00 incl\. GST/).waitFor();
      await d.settle();
      await d.caption("The system calculates nights and the annual fee before anything is submitted.");
      const calc = page.locator("div").filter({ hasText: "Entitlement calculation" }).filter({ hasText: "Annual Subscription Fee" }).last();
      await d.scrollTo(calc);
      if (!d.mode.fast) await page.screenshot({ path: path.join(OUT, "club8-crm-demo-thumb.png") });
      await d.star(calc, 4000);
      await d.click(page.getByRole("button", { name: "Submit request" }));
      await d.click(page.getByRole("link", { name: /^R-/ }).first());
      await page.waitForURL(/\/reservations\/[0-9a-f-]+$/);
      await d.settle();
      s.shared.resUrl = page.url();
      await d.caption("Approving deducts the nights from the member's entitlement, exactly once.");
      await d.click(page.getByRole("button", { name: "Approve (deduct entitlement)" }));
      await d.settle();
      await d.type(page.getByLabel("Property confirmation number", { exact: true }), "GOA-48213");
      await d.caption("Confirming is refused: this year's ASF hasn't been paid yet.");
      await guard.expect(422, /\/api\/v1\/reservations\//, async () => {
        await d.click(page.getByRole("button", { name: "Confirm" }));
        await page.getByRole("alert").filter({ hasText: "non-confirmation" }).waitFor();
        await d.star(page.getByRole("alert").filter({ hasText: "non-confirmation" }), 4000);
      });
      await s.signInAs("demo.finance", { path: `${s.shared.memberUrl}?tab=finance` });
      await d.caption("Finance records the ASF payment: base fee plus 5% GST.");
      await d.click(page.getByRole("button", { name: /^Pay ASF/ }));
      const dlg = page.getByRole("dialog", { name: "Record payment" });
      await d.select(dlg.getByLabel("Method", { exact: true }), "Card");
      await d.type(dlg.getByLabel("Transaction / approval reference", { exact: true }), "DEMO-ASF-0001");
      await d.click(dlg.getByRole("button", { name: /Save payment/ }));
      await page.getByText("PAID", { exact: true }).first().waitFor();
      await d.settle();
      await d.pause(2200);
      await s.signInAs("demo.reservations", { path: s.shared.resUrl });
      await d.caption("With the ASF paid, the stay can be confirmed.");
      await d.type(page.getByLabel("Property confirmation number", { exact: true }), "GOA-48213");
      await d.click(page.getByRole("button", { name: "Confirm" }));
      await page.getByText("CONFIRMED", { exact: true }).first().waitFor();
      await d.settle();
      await d.star(page.getByText("CONFIRMED", { exact: true }).first().locator("xpath=ancestor::*[self::header or self::div][1]"), 3200);
      await d.caption("The confirmation voucher is generated as a PDF.");
      await d.click(page.getByRole("button", { name: /Generate confirmation \/ voucher PDF/ }));
      await page.getByText("Open voucher").waitFor();
      await d.pause(2200);
      await d.caption("Entitlement now shows 4 nights used and 3 left for this year.");
      await s.go(`${s.shared.memberUrl}?tab=entitlement`);
      const yearRow = page.getByRole("row", { name: new RegExp(`^${ci.slice(0, 4)}\\b`) });
      if ((await yearRow.getByRole("cell").nth(4).textContent())?.trim() !== "4.0" || (await yearRow.getByRole("cell").last().textContent())?.trim() !== "3.0") {
        throw new Error("entitlement row does not show 4.0 used / 3.0 left");
      }
      await d.star(yearRow, 3500);
    },
  },

  {
    id: 7, title: "Cancel a stay",
    run: async (s: Scene) => {
      const { page, d } = s;
      // Set-up the video doesn't show: a second confirmed 2-night stay a few days after the first (the year's ASF is
      // already paid), and the member's email asking to cancel it, logged by member services.
      const memberId = s.shared.memberUrl!.split("/").pop()!;
      const ci = addDays(s.shared.checkOut!, 2);
      let api = await apiAs("demo.reservations");
      const res = await api.call<{ id: string }>("POST", `/members/${memberId}/reservations`, {
        destination_id: (await api.master("destinations", "GOA")).id,
        property_id: (await api.master("properties", "GOA-DEMO-PREM")).id,
        unit_type_id: (await api.master("unit-types", "T0")).id,
        adults: 2, check_in: ci, check_out: addDays(ci, 2),
      });
      await api.call("POST", `/reservations/${res.id}/status`, { to_status: "APPROVED" });
      await api.call("POST", `/reservations/${res.id}/status`, { to_status: "CONFIRMED", confirmation_number: "GOA-48390" });
      await api.call("POST", `/reservations/${res.id}/voucher`);
      await api.dispose();
      api = await apiAs("demo.service");
      const subject = "Please cancel our second Goa stay";
      await api.call("POST", `/members/${memberId}/emails`, {
        direction: "INCOMING", sent_at: new Date().toISOString(), sender: LEAD.email, to: ["reservations@example.com"],
        subject, body: "Sorry, we can only make the first trip. Please cancel the second one.",
      });
      await api.dispose();

      // open on the member's reservations list, so it is clear this is a second stay and not the Goa stay just booked
      await s.signInAs("demo.reservations", { announce: false, path: `${s.shared.memberUrl}?tab=reservations` });
      const second = page.getByRole("row").filter({ has: page.locator(`a[href="/reservations/${res.id}"]`) });
      await second.waitFor();
      await s.begin();
      const month = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(new Date(`${ci}T00:00:00Z`));
      await d.caption(`A second stay, 2 nights, already confirmed for ${month}.`);
      await d.star(second, 3200);
      await d.click(second.getByRole("link", { name: /^R-/ }));
      await page.waitForURL(new RegExp(`/reservations/${res.id}$`));
      await page.getByLabel("Member's written request", { exact: true }).waitFor();
      await d.settle();
      await d.caption("The member emails to cancel this second stay.");
      await d.select(page.getByLabel("Decline / cancel reason", { exact: true }), "Member request");
      await d.type(page.getByLabel("Explanation", { exact: true }), "Member can only make the first trip");
      const today = istToday().split("-").reverse().join("-");
      await d.select(page.getByLabel("Member's written request", { exact: true }), `${today} · Email: ${subject}`);
      const outcome = page.getByRole("status").filter({ hasText: /days' notice → \d+%: [\d.]+ nights credited, [\d.]+ forfeited/ });
      await outcome.waitFor();
      await d.settle();
      await d.caption("Notice counts from the day the email arrived. The outcome shows before anything changes.");
      await d.star(outcome, 4000);
      await d.click(page.getByRole("button", { name: "Cancel reservation…" }));
      const dlg = page.getByRole("dialog", { name: "Cancel this reservation?" });
      await d.pause(1200);
      await d.click(dlg.getByRole("button", { name: "Cancel reservation" }));
      await page.getByText("CANCELLED", { exact: true }).first().waitFor();
      await d.settle();
      await d.caption("Cancelled: nights credited back by the policy, a letter generated, the voucher marked cancelled.");
      const card = page.locator("section").filter({ hasText: "Cancellation date" }).first();
      await page.locator("section").filter({ hasText: "Letters and vouchers" }).getByText("CANCELLED", { exact: true }).waitFor();
      await d.star(card, 3500);
      await d.star(page.locator("section").filter({ hasText: "Letters and vouchers" }).first(), 3000);
    },
  },

  {
    id: 8, title: "Member services",
    run: async (s: Scene) => {
      const { page, d } = s;
      await s.signInAs("demo.service", { announce: false, path: `${s.shared.memberUrl}?tab=correspondence` });
      await s.begin();
      await d.caption("Member services logs every email and call on the member's record.");
      await d.type(page.getByLabel("To (comma separated)", { exact: true }), "reservations@example.com");
      await d.type(page.getByLabel("Subject", { exact: true }), "Early check-in request");
      await d.type(page.getByLabel("Body", { exact: true }), "Could we check in at 10 am?");
      await d.click(page.getByRole("button", { name: "Add email" }));
      await page.getByText("Early check-in request (1)").waitFor();
      await d.type(page.getByLabel("Summary", { exact: true }), "Welcome call");
      await d.click(page.getByRole("button", { name: "Add call" }));
      await page.getByText(/Welcome call/).first().waitFor();
      await d.settle();
      await d.caption("The timeline shows everything about the member in date order.");
      await d.scrollTo(page.getByText(/Welcome call/).last());
      await d.pause(2800);
    },
  },

  {
    id: 9, title: "Audit trail",
    run: async (s: Scene) => {
      const { page, d } = s;
      await s.signInAs("demo.manager", { announce: false, path: `${s.shared.memberUrl}?tab=profile` });
      await s.begin();
      await d.caption("Changes need a reason, and the reason is recorded.");
      await d.click(page.getByRole("button", { name: "Edit" }));
      await d.type(page.getByLabel("Comments", { exact: true }), "Prefers sea-facing rooms");
      await d.type(page.getByLabel("Reason for change (recorded in history)", { exact: true }), "Welcome call");
      await d.click(page.getByRole("button", { name: "Save" }));
      await page.getByRole("button", { name: "Edit" }).waitFor();
      await d.settle();
      await d.caption("History shows who changed what, when, and the old and new values.");
      await s.tab("History");
      await d.star(page.getByText(/"Prefers sea-facing rooms"/).first().locator("xpath=ancestor::table[1]"), 3500);
      // a visible sign-in for the administrator, with two-step verification
      await s.ctx.clearCookies();
      await d.caption("Administrators sign in with a code from their authenticator app.");
      await s.go("/login");
      await d.type(page.getByLabel("Username", { exact: true }), "demo.admin");
      await d.type(page.getByLabel("Password", { exact: true }), PASSWORD);
      await s.guard.expect(401, /\/api\/v1\/auth\/login/, async () => {
        await d.click(page.getByRole("button", { name: "Sign in" }));
        await page.getByLabel("Two-factor code").waitFor();
      });
      await d.pause(1200);
      await d.type(page.getByLabel("Two-factor code"), totp());
      await d.click(page.getByRole("button", { name: "Sign in" }));
      await page.getByRole("heading", { name: "Dashboard" }).waitFor();
      await d.settle();
      await d.click(page.getByRole("link", { name: "Activity log" }));
      // only caption the log once its rows are on screen: no loading skeleton, and a non-zero entry count
      await page.getByRole("table", { name: "User activity log" }).getByRole("row").nth(1).waitFor();
      await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached" });
      await page.getByRole("navigation", { name: "Pagination" }).getByText(/^[1-9][\d,]* entries$/).waitFor();
      await d.settle();
      await d.caption("The activity log records every sign-in, view of sensitive data and change.");
      await d.pause(2800); // hold on the populated table
      await d.caption("Verify integrity proves the log has not been altered.");
      await d.pause(900);
      await d.click(page.getByRole("button", { name: "Verify integrity" }));
      await page.getByText(/Hash chain intact/).waitFor();
      await d.star(page.getByText(/Hash chain intact/), 3800);
    },
  },

  {
    id: 10, title: "Passwords and access",
    run: async (s: Scene) => {
      const { page, d } = s;
      await s.signInAs("demo.admin", { announce: false, path: "/admin" });
      await s.begin();
      await d.caption("New staff get a temporary password, created by the system and shown only once.");
      await d.click(page.getByRole("button", { name: "New user" }));
      const drawer = page.getByRole("dialog", { name: "New user" });
      await d.type(drawer.getByLabel("Username", { exact: true }), "neha.joshi");
      await d.type(drawer.getByLabel("Full name", { exact: true }), "Neha Joshi");
      await d.click(drawer.getByRole("button", { name: "Create user" }));
      const shown = page.getByRole("dialog", { name: "User neha.joshi created" });
      await shown.getByText("This password won't be shown again").waitFor();
      await d.star(shown, 3500);
      await d.click(shown.getByRole("button", { name: /passed it on/ }));
      await d.caption("Resetting someone else's password always needs a reason.");
      const row = page.getByRole("row").filter({ hasText: "demo.team" });
      await d.click(row.getByRole("button", { name: "Reset password…" }));
      const confirm = page.getByRole("dialog", { name: "Reset password for demo.team?" });
      await d.type(confirm.getByLabel("Reason (required)"), "Forgot password, confirmed by phone");
      await d.pause(2400);
      await d.click(confirm.getByRole("button", { name: "Keep as is" }));
      await d.caption("Forgot your password? A reset link goes to your registered email.");
      await s.go("/forgot-password");
      await d.type(page.getByLabel("Username or email"), "demo.sales@example.test");
      await d.click(page.getByRole("button", { name: "Send reset link" }));
      await page.getByRole("heading", { name: "Check your email" }).waitFor();
      await d.pause(2200);
      // the email, as it arrives (this recording's own Mailpit)
      let id = "";
      for (let i = 0; i < 40 && !id; i++) {
        const r = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:"demo.sales@example.test"')}`)).json() as { messages: { ID: string }[] };
        id = r.messages[0]?.ID ?? "";
        if (!id) await page.waitForTimeout(250);
      }
      if (!id) throw new Error("reset email did not arrive");
      await d.caption("The email: one link, valid for 30 minutes. Emails never contain a password.");
      await page.goto(`${MAILPIT}/view/${id}`);
      await s.reattach(); // Mailpit is another site: the page moved to a new process
      await page.waitForLoadState("networkidle");
      await d.pause(3200);
    },
  },

  {
    id: 11, title: "On the phone", phone: true,
    run: async (s: Scene) => {
      const { page, d } = s;
      await s.signInAs("demo.sales", { announce: false, path: "/" });
      await s.begin();
      await d.caption("The same CRM works on a phone.");
      await d.pause(3600);
      await d.caption("Look up a member while out on the street.");
      await d.type(page.getByLabel("Search members and leads", { exact: true }), "Ananya");
      await page.getByRole("listbox").waitFor();
      await d.pause(2800);
      await d.click(page.getByRole("option").filter({ hasText: "MSMC8-9002" }).first());
      // only caption the member page once its data is on screen: no loading skeletons, the summary tiles filled
      await page.getByRole("heading", { name: /^MSMC8-9002/ }).waitFor();
      await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached" });
      await page.getByText(/^of [\d.]+ available$/).first().waitFor(); // the nights tile shows "…" until entitlement loads
      await d.settle();
      await d.caption("Every detail of the membership is one tap away.");
      await d.pause(3600);
    },
  },

  { id: 12, title: "End", card: "end.html", hold: 8000 },
];

/** The newer headless mode includes Chrome's PDF viewer (receipts); the old one shows a blank frame. The window
 * size must equal the viewport, or the screencast frames come out smaller (e.g. 1904×985). */
function browserOptions(args: string[]) {
  return { channel: "chromium", args };
}

// ---------------------------------------------------------------- main
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.includes("--section") ? Number(args[args.indexOf("--section") + 1]) : null;
  if (args.includes("--assemble-only")) { await assemble(); return; }
  const db = (args.includes("--db") ? args[args.indexOf("--db") + 1] : "docker") as DbMode;
  if (!DB_MODES.includes(db)) throw new Error(`--db must be one of: ${DB_MODES.join(", ")}`);
  fs.mkdirSync(CLIPS, { recursive: true });
  const stack = await startStack({ build: !args.includes("--no-build"), db });
  const browser = await chromium.launch(browserOptions(["--window-size=1920,1080"]));
  try {
    const shared: Shared = {};
    for (const sec of SECTIONS) {
      if (only !== null && sec.id > only) break;
      const record = only === null || sec.id === only;
      if (!record && (sec.card || sec.phone)) continue; // nothing to recreate
      if (!record && only !== null && SECTIONS[only]?.card) continue; // a card needs no data
      console.log(`==> ${record ? "Recording" : "Replaying (not recorded)"} ${sec.id}. ${sec.title}`);
      await runSection({ browser, shared, record }, sec);
    }
  } finally {
    await browser.close();
    stack.stop();
  }
  await assemble();
}

main().catch((e) => { console.error(e); process.exit(1); });
