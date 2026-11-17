/**
 * Recording-only overlays, injected with context.addInitScript (never part of the app): a cursor that follows the
 * mouse, a ring on each click, a lower-third caption bar and a highlight outline for ★ moments. Plus the paced
 * actions the sections use (human-speed typing, animated mouse moves, smooth scrolling, readable pauses).
 */
import type { Locator, Page } from "playwright";

export const PACE = { typeMs: 60, moveMs: 400, read: 2000, star: 3500 };

/** Runs in the page before any app script. Re-installs itself on every navigation. */
function installOverlay(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__demoOverlay) return;
  w.__demoOverlay = true;
  // The app's dialogs and drawers are native <dialog>s in the browser's top layer, above any z-index. The overlays
  // are top-layer popovers too, re-raised whenever a dialog opens, so captions and the cursor stay on top.
  const css = `
    #demo-cursor,#demo-caption,#demo-highlight,.demo-ring{inset:auto;margin:0;border:0;padding:0;background:transparent;overflow:visible;color:inherit}
    #demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;z-index:2147483647;pointer-events:none;
      transition:transform 400ms cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
    .demo-ring{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border:3px solid #EF7F1B;border-radius:50%;
      z-index:2147483646;pointer-events:none;animation:demo-ring 600ms ease-out forwards}
    @keyframes demo-ring{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
    #demo-caption{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);width:max-content;max-width:1400px;z-index:2147483645;
      background:rgba(57,49,134,.9);color:#fff;font:600 30px/1.3 Inter,"Segoe UI",system-ui,sans-serif;padding:18px 36px 20px;
      border-top:4px solid #EF7F1B;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:center;
      opacity:0;transition:opacity 200ms ease;pointer-events:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    #demo-caption.on{opacity:1}
    #demo-highlight{position:fixed;z-index:2147483644;pointer-events:none;border:4px solid #EF7F1B;border-radius:10px;
      box-shadow:0 0 0 9999px rgba(28,26,51,.18),0 0 24px rgba(239,127,27,.55);opacity:0;transition:opacity 250ms ease}
    #demo-highlight.on{opacity:1}`;
  const add = () => {
    if (document.getElementById("demo-cursor") || !document.body) return;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7.5 19 2.6-7.8L21 10.6z" fill="#fff" stroke="#1c1a33" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    if (w.__demoTouch) cursor.style.visibility = "hidden"; // phone and title cards: no pointer
    const caption = document.createElement("div");
    caption.id = "demo-caption";
    const hl = document.createElement("div");
    hl.id = "demo-highlight";
    for (const el of [hl, caption, cursor]) el.setAttribute("popover", "manual");
    document.body.append(hl, caption, cursor);
    raise();
    new MutationObserver(raise).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });
  };
  const raise = () => {
    for (const id of ["demo-highlight", "demo-caption", "demo-cursor"]) {
      const el = document.getElementById(id) as (HTMLElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
      if (!el?.showPopover) continue;
      try { if (el.matches(":popover-open")) el.hidePopover!(); el.showPopover(); } catch { /* not connected yet */ }
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
  w.__demoMove = (x: number, y: number, ms: number) => {
    add();
    const c = document.getElementById("demo-cursor")!;
    c.style.transitionDuration = `${ms}ms`;
    c.style.transform = `translate(${x}px,${y}px)`;
  };
  w.__demoRing = (x: number, y: number) => {
    const r = document.createElement("div") as HTMLElement & { showPopover?: () => void };
    r.className = "demo-ring";
    r.setAttribute("popover", "manual");
    r.style.left = `${x}px`; r.style.top = `${y}px`;
    document.body.appendChild(r);
    try { r.showPopover?.(); } catch { /* ignore */ }
    setTimeout(() => r.remove(), 700);
  };
  w.__demoCaption = (text: string | null, instant?: boolean) => {
    add();
    const c = document.getElementById("demo-caption")!;
    if (!text) { c.classList.remove("on"); return; }
    if (instant) { c.style.transition = "none"; c.textContent = text; c.classList.add("on"); void c.offsetWidth; c.style.transition = ""; return; }
    if (c.classList.contains("on") && c.textContent !== text) {
      c.classList.remove("on");
      setTimeout(() => { c.textContent = text; c.classList.add("on"); }, 210);
    } else { c.textContent = text; c.classList.add("on"); }
  };
  w.__demoHighlight = (rect: { x: number; y: number; width: number; height: number } | null) => {
    add();
    const h = document.getElementById("demo-highlight")!;
    if (!rect) { h.classList.remove("on"); return; }
    const pad = 8;
    Object.assign(h.style, { left: `${rect.x - pad}px`, top: `${rect.y - pad}px`, width: `${rect.width + 2 * pad}px`, height: `${rect.height + 2 * pad}px` });
    h.classList.add("on");
  };
}
/** tsx (esbuild) wraps named functions in __name(...) calls; functions sent into the page as text need it defined. */
export const NAME_SHIM = "globalThis.__name = globalThis.__name || ((f) => f);";
export const OVERLAY_SCRIPT = `${NAME_SHIM}(${installOverlay.toString()})()`;
export const TOUCH_SCRIPT = "window.__demoTouch = true;";

export type CaptionEvent = { text: string; start: number; end: number };
export type DirectorMode = {
  /** Unrecorded catch-up run (re-recording one section): no pacing, no overlays. */
  fast?: boolean;
  /** Phone clip: no cursor, tap rings only. */
  touch?: boolean;
  /** Captions are drawn afterwards by ffmpeg (phone clip); only their times are recorded here. */
  externalCaptions?: boolean;
};

type W = Record<string, (...a: unknown[]) => void>;

/** Paced actions and caption bookkeeping for one clip. Caption times are seconds since the clip's first frame. */
export class Director {
  readonly captions: CaptionEvent[] = [];
  private current: CaptionEvent | null = null;
  private pos = { x: 960, y: 540 };
  t0 = Date.now();

  constructor(readonly page: Page, readonly mode: DirectorMode = {}) {
    // A full page load wipes the overlay; put the cursor and the current caption back straight away.
    page.on("load", () => { void this.restore(); });
  }

  now(): number { return (Date.now() - this.t0) / 1000; }

  private async run(fn: string, ...args: unknown[]): Promise<void> {
    if (this.mode.fast) return;
    await this.page.evaluate(([f, a]) => (window as unknown as W)[f as string]?.(...(a as unknown[])), [fn, args] as const).catch(() => undefined);
  }

  private async restore(): Promise<void> {
    await this.run("__demoMove", this.pos.x, this.pos.y, 0);
    if (this.current && !this.mode.externalCaptions) await this.run("__demoCaption", this.current.text, true);
  }

  async caption(text: string | null): Promise<void> {
    if (this.mode.fast) return;
    // every caption stays readable for at least 2.6 s (plus its 0.2 s fade-in)
    if (this.current) {
      const shown = this.now() - this.current.start;
      if (shown < 2.6) await this.page.waitForTimeout((2.6 - shown) * 1000);
    }
    if (this.current) { this.current.end = this.now(); this.captions.push(this.current); this.current = null; }
    if (text) this.current = { text, start: this.now() + 0.2, end: 0 };
    if (!this.mode.externalCaptions) await this.run("__demoCaption", text);
  }

  finish(): void { if (this.current) { this.current.end = this.now(); this.captions.push(this.current); this.current = null; } }

  async pause(ms = PACE.read): Promise<void> { if (!this.mode.fast) await this.page.waitForTimeout(ms); }

  /** Wait until the screen is settled: network idle and no skeleton loaders. */
  async settle(): Promise<void> {
    await this.page.waitForLoadState("networkidle").catch(() => undefined);
    await this.page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
    await this.page.locator(".animate-shimmer").first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
  }

  async scrollTo(target: Locator, block: "center" | "start" = "center"): Promise<void> {
    await target.evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b as ScrollLogicalPosition }), block);
    await this.page.waitForFunction(() => new Promise((res) => {
      let last = window.scrollY, still = 0;
      const tick = () => { if (window.scrollY === last) { if (++still > 6) return res(true); } else { still = 0; last = window.scrollY; } requestAnimationFrame(tick); };
      tick();
    }), undefined, { timeout: 5000 }).catch(() => undefined);
  }

  /** Animated move to the element's centre (scrolling it into view smoothly first if it is near an edge). */
  async moveTo(target: Locator): Promise<{ x: number; y: number }> {
    await target.waitFor({ state: "visible" });
    if (this.mode.fast) return this.pos;
    const vp = this.page.viewportSize()!;
    let box = await target.boundingBox();
    if (!box || box.y < 70 || box.y + box.height > vp.height - 190) { await this.scrollTo(target); box = await target.boundingBox(); }
    if (!box) throw new Error("element has no box");
    const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
    await this.run("__demoMove", x, y, PACE.moveMs);
    await this.page.mouse.move(x, y, { steps: 10 });
    await this.page.waitForTimeout(PACE.moveMs);
    this.pos = { x, y };
    return { x, y };
  }

  private async ring(): Promise<void> { await this.run("__demoRing", this.pos.x, this.pos.y); }

  async click(target: Locator): Promise<void> {
    await this.moveTo(target);
    await this.ring();
    await target.click();
    if (!this.mode.fast) await this.page.waitForTimeout(250);
  }

  async type(target: Locator, text: string): Promise<void> {
    await this.click(target);
    if (this.mode.fast) await target.fill(text);
    else {
      await target.fill(""); // fields may be pre-filled (e.g. nights per year): typing must replace, not append
      await target.pressSequentially(text, { delay: PACE.typeMs });
    }
    if (!this.mode.fast) await this.page.waitForTimeout(150);
  }

  /** Date / month inputs: click, then set the value (typing into them is locale-dependent). */
  async fill(target: Locator, value: string): Promise<void> {
    await this.click(target);
    await target.fill(value);
    if (!this.mode.fast) await this.page.waitForTimeout(350);
  }

  async select(target: Locator, label: string): Promise<void> {
    await this.moveTo(target);
    await this.ring();
    await target.selectOption({ label });
    if (!this.mode.fast) await this.page.waitForTimeout(450);
  }

  async check(target: Locator): Promise<void> {
    await this.moveTo(target);
    await this.ring();
    await target.check();
    if (!this.mode.fast) await this.page.waitForTimeout(250);
  }

  /** Outline an element for a ★ moment, hold, then remove the outline. */
  async star(target: Locator, ms = PACE.star): Promise<void> {
    if (this.mode.fast) return;
    await this.scrollTo(target);
    const box = await target.boundingBox();
    await this.run("__demoHighlight", box);
    await this.page.waitForTimeout(ms);
    await this.run("__demoHighlight", null);
    await this.page.waitForTimeout(300);
  }
}
