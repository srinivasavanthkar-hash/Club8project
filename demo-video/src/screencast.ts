/**
 * Clip capture through Chrome's own screencast (CDP Page.startScreencast), not Playwright's recordVideo.
 *
 * Why: recordVideo encodes VP8 at under 1 Mbit/s for 1080p, which visibly blurs small UI text (see README). The
 * screencast hands over each repainted frame as a high-quality JPEG with its timestamp; ffmpeg then turns the
 * variable-rate frames into a constant 30 fps clip. Overlays are part of the page, so they are captured too.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CDPSession, Page } from "playwright";

export const FFMPEG_DIR = path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..", "..", ".local", "ffmpeg", "ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1", "bin");
export const FFMPEG = path.join(FFMPEG_DIR, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
export const FFPROBE = path.join(FFMPEG_DIR, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

export function ffmpeg(args: string[]): void {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"], maxBuffer: 1 << 26 });
}

export function probeDuration(file: string): number {
  return Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
}

/** Filter: full-range BT.601 frames (JPEG screenshots) to limited-range BT.709 yuv420p. */
export const TO_TV = "scale=in_range=full:out_range=limited:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709";
/** Filter: RGB(A) images (caption bars, solid backgrounds) to limited-range BT.709, keeping alpha. */
export const RGB_TO_TV = "scale=out_range=limited:out_color_matrix=bt709";
/** Encoder flags: yuv420p, limited ("tv") range, BT.709, so every player decodes the colours the same way. */
export const TV_TAGS = ["-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];

type Frame = { file: string; t: number };

export class Screencast {
  private cdp: CDPSession | null = null;
  private frames: Frame[] = [];
  private frozen = false;
  private pending: Promise<void>[] = [];
  /** Wall-clock seconds of the first frame: time zero of the clip (captions are measured from it). */
  start = 0;

  /** `scale`: device pixel ratio of the page (2 for the phone clip), so frames keep full resolution. */
  constructor(private readonly page: Page, private readonly dir: string, private readonly scale = 1) {}

  async begin(): Promise<void> {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    await this.attach();
    // Make sure there is a first frame now (a repaint), so time zero is "now".
    await this.page.evaluate(() => { document.body.style.outline = "0 solid transparent"; requestAnimationFrame(() => { document.body.style.outline = ""; }); });
    const t0 = Date.now();
    while (!this.frames.length && Date.now() - t0 < 3000) await this.page.waitForTimeout(30);
    this.start = this.frames[0]?.t ?? Date.now() / 1000;
  }

  /** After navigating to another site (e.g. Mailpit), the page runs in a new process and the old screencast session
   * stops sending frames: start a new one on the same page. Frames keep accumulating in the same clip. */
  async reattach(): Promise<void> {
    await this.cdp?.detach().catch(() => undefined);
    await this.attach();
  }

  /** Keep showing the current frame (time still runs) until thaw(): used while a page reloads. */
  freeze(): void { this.frozen = true; }

  async thaw(): Promise<void> {
    this.frozen = false;
    // a still page sends no frames: force one repaint so the video moves on to the loaded page now
    await this.page.evaluate(() => { document.body.style.outline = "0 solid transparent"; requestAnimationFrame(() => { document.body.style.outline = ""; }); });
  }

  private async attach(): Promise<void> {
    const vp = this.page.viewportSize()!;
    this.cdp = await this.page.context().newCDPSession(this.page);
    // The first frame carries the time it was originally painted, which can be seconds before now: clamp, so the
    // clip doesn't open with a long still frame.
    const beganAt = Date.now() / 1000;
    this.cdp.on("Page.screencastFrame", (e: { data: string; metadata: { timestamp?: number }; sessionId: number }) => {
      if (this.frozen) { void this.cdp?.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => undefined); return; }
      const file = path.join(this.dir, `f${String(this.frames.length).padStart(6, "0")}.jpg`);
      // arrival time on the same clock as the captions (the frame metadata timestamp runs on a different clock)
      const t = Math.max(Date.now() / 1000, beganAt);
      this.frames.push({ file, t });
      this.pending.push(fs.promises.writeFile(file, Buffer.from(e.data, "base64")));
      void this.cdp?.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => undefined);
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: vp.width * this.scale, maxHeight: vp.height * this.scale, everyNthFrame: 1 });
  }

  /** Stop capturing and encode the clip (constant 30 fps, near-lossless intermediate). Returns its duration. */
  async end(out: string, opts: { holdLast?: number } = {}): Promise<number> {
    const stopAt = Date.now() / 1000 + (opts.holdLast ?? 0);
    await this.cdp?.send("Page.stopScreencast").catch(() => undefined);
    await this.cdp?.detach().catch(() => undefined);
    await Promise.all(this.pending);
    if (!this.frames.length) throw new Error(`no frames captured for ${out}`);
    // concat demuxer: each frame lasts until the next one (screencast only sends repaints)
    const lines: string[] = [];
    this.frames.forEach((f, i) => {
      const next = this.frames[i + 1]?.t ?? stopAt;
      lines.push(`file '${f.file.replace(/\\/g, "/")}'`, `duration ${Math.max(next - f.t, 0.001).toFixed(4)}`);
    });
    lines.push(`file '${this.frames[this.frames.length - 1]!.file.replace(/\\/g, "/")}'`);
    const list = path.join(this.dir, "frames.txt");
    fs.writeFileSync(list, lines.join("\n"));
    // The trailing repeat of the last file makes the concat demuxer honour the last duration, but ffmpeg 8 then adds
    // that duration once more: cut the output to the true length.
    const total = stopAt - this.frames[0]!.t;
    // The JPEG frames are full-range BT.601 (JFIF). Players expect limited-range (16–235) BT.709 for HD video, so
    // convert explicitly and tag the stream, instead of leaving the range to ffmpeg's guess (washed-out or crushed
    // blacks on some players).
    ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=30,${TO_TV}`, "-t", total.toFixed(3), "-c:v", "libx264", "-preset", "medium", "-crf", "14", ...TV_TAGS, "-movflags", "+faststart", out]);
    fs.rmSync(this.dir, { recursive: true, force: true });
    return probeDuration(out);
  }
}
