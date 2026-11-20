/**
 * Recording one section (one clip file): the browser context, overlays, error guard and screencast. Shared by the main
 * video (record.ts) and the follow-up clips (clips.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { ROLES, sessionCookies } from "./api";
import { type CaptionEvent, Director, NAME_SHIM, OVERLAY_SCRIPT, PACE, TOUCH_SCRIPT } from "./overlay";
import { PHONE, Screencast } from "./screencast";
import { BASE, ROOT } from "./stack";

export const OUT = path.join(ROOT, "demo-video", "out");
/** The main video's section files, and the finished follow-up clips. */
export const CLIPS = path.join(OUT, "clips");

export type ClipMeta = { id: number; title: string; file: string; duration: number; captions: CaptionEvent[]; phone?: boolean };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Shared = Record<string, any>;
export type Section = {
  id: number; title: string; phone?: boolean;
  /** title/end cards: the HTML file in cards/, an optional query string for it, and how long it stays */
  card?: string; cardQuery?: string; hold?: number;
  run?: (s: Scene) => Promise<void>;
};
export type Ctx = { browser: Browser; shared: Shared; record: boolean };

// ---------------------------------------------------------------- error guard (the run fails on any of these)
export class Guard {
  readonly errors: string[] = [];
  private allowed: { status: number; path: RegExp }[] = [];
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

// ---------------------------------------------------------------- one section
export class Scene {
  /** Starts the recording once the section's first screen is settled (set per clip). */
  begin: () => Promise<void> = async () => undefined;
  /** Continue recording after navigating to another site (set per clip). */
  reattach: () => Promise<void> = async () => undefined;
  /** Hold the picture while a page loads (set per clip). */
  freeze: () => void = () => undefined;
  thaw: () => Promise<void> = async () => undefined;
  /** A real cut: `ms` pass in the app (timers run) but are taken out of the clip and the caption times. */
  cut: (ms: number) => Promise<void> = async (ms) => { await this.page.waitForTimeout(ms); };

  constructor(readonly page: Page, readonly ctx: BrowserContext, readonly d: Director, readonly guard: Guard, readonly shared: Shared) {}

  /** Switch the signed-in user without showing a sign-in: swap the session cookies and reload. */
  async signInAs(user: string, opts: { announce?: boolean; path?: string } = {}): Promise<void> {
    await this.ctx.clearCookies();
    const cookies = await sessionCookies(user);
    if (process.env.DEMO_DEBUG) console.log(`    [debug] ${user}: ${cookies.map((c) => `${c.name}@${c.domain}${c.path}`).join(", ")}`);
    await this.ctx.addCookies(cookies);
    if (opts.announce !== false) await this.d.caption(`Now signed in as ${ROLES[user]}.`);
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

/** The newer headless mode includes Chrome's PDF viewer (receipts); the old one shows a blank frame. The window
 * size must equal the viewport, or the screencast frames come out smaller (e.g. 1904×985). */
export function browserOptions(args: string[]) {
  return { channel: "chromium", args };
}

/** Runs a section; `scene.begin()` (called by the section once its first screen is settled) starts the recording.
 * The clip goes to `<dir>/NN.mp4` (+ NN.json with its caption times). */
export async function runSection(c: Ctx, sec: Section, dir = CLIPS): Promise<ClipMeta | null> {
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
    acceptDownloads: true,
  });
  await context.addInitScript(NAME_SHIM); // every page, recorded or not
  if (phone || sec.card) await context.addInitScript(TOUCH_SCRIPT); // no pointer on the phone or the cards
  if (c.record) await context.addInitScript(OVERLAY_SCRIPT);
  const page = await context.newPage();
  const guard = new Guard();
  guard.watch(page);
  const d = new Director(page, { fast: !c.record, touch: phone, externalCaptions: phone });
  const scene = new Scene(page, context, d, guard, c.shared);
  fs.mkdirSync(dir, { recursive: true });
  const key = `${path.basename(dir)}-${String(sec.id).padStart(2, "0")}`;
  const file = path.join(dir, `${String(sec.id).padStart(2, "0")}.mp4`);
  const cast = c.record ? new Screencast(page, path.join(OUT, "frames", key), phone ? 2 : 1) : null;
  scene.reattach = async () => { await cast?.reattach(); };
  scene.freeze = () => cast?.freeze();
  scene.thaw = async () => { await cast?.thaw(); };
  scene.cut = async (ms) => {
    if (!cast) { await page.waitForTimeout(ms); return; }
    const cutS = await cast.cut(ms);
    d.t0 += cutS * 1000; // captions on the clip's timeline, which no longer contains the cut
  };
  let begun = false;
  scene.begin = async () => {
    begun = true;
    await d.settle();
    if (!cast) return;
    await cast.begin();
    d.t0 = cast.start * 1000;
  };
  try {
    if (sec.card) {
      await page.goto(pathToFileURL(path.join(ROOT, "demo-video", "cards", sec.card)).href + (sec.cardQuery ?? ""));
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      // restart the card's entrance animation once capture is running
      await scene.begin();
      await page.evaluate(() => { const el = document.querySelector(".card") as HTMLElement; el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; });
      await page.waitForTimeout(sec.hold ?? 6000);
    } else {
      await sec.run!(scene);
      // a scene that never starts the recording captures nothing: catch it in a dry run, not after a full recording
      if (!begun) throw new Error(`Section ${sec.id} (${sec.title}) never called scene.begin()`);
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
    const shot = path.join(OUT, `failed-${key}.png`);
    await page.screenshot({ path: shot }).catch(() => undefined);
    console.error(`    section ${sec.id} failed; screen saved to ${path.relative(path.join(ROOT, "demo-video"), shot)}`);
    throw e;
  } finally {
    await context.close();
    await phoneBrowser?.close();
  }
}
