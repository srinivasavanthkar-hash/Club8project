/**
 * Post-production with ffmpeg: phone clip on a brand background, 300 ms crossfades, H.264 MP4, captions (SRT),
 * chapters and a quality-check report. Reads the clips and their metadata from out/clips/.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import type { ClipMeta } from "./record";
import { OVERLAY_SCRIPT } from "./overlay";
import { ffmpeg, probeDuration } from "./screencast";
import { ROOT } from "./stack";

const OUT = path.join(ROOT, "demo-video", "out");
const CLIPS = path.join(OUT, "clips");
const FADE = 0.3;
const SECTIONS = 12;

const ts = (s: number, sep = ",") => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The caption bar exactly as in the app recordings, rendered to a transparent 1920×1080 PNG (phone clip). */
async function captionPngs(captions: { text: string }[], dir: string): Promise<string[]> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(OVERLAY_SCRIPT);
  await page.setContent("<!doctype html><html><head></head><body style='margin:0;background:transparent'></body></html>");
  await page.evaluate(OVERLAY_SCRIPT);
  const files: string[] = [];
  for (const [i, c] of captions.entries()) {
    await page.evaluate((t) => (window as unknown as { __demoCaption: (t: string, i: boolean) => void }).__demoCaption(t, true), c.text);
    await page.evaluate(() => { document.getElementById("demo-cursor")!.style.display = "none"; });
    const f = path.join(dir, `cap${i}.png`);
    await page.screenshot({ path: f, omitBackground: true });
    files.push(f);
  }
  await browser.close();
  return files;
}

/** Section 10: the 390×844 phone recording centred on #F7F7FB with a soft shadow, captions drawn full-size. */
async function composePhone(meta: ClipMeta): Promise<string> {
  const dir = path.join(OUT, "phone");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const caps = await captionPngs(meta.captions, dir);
  const D = meta.duration;
  const H = 820, W = Math.round((390 / 844) * H / 2) * 2, X = (1920 - W) / 2, Y = 50;
  const inputs = ["-f", "lavfi", "-i", `color=c=0xF7F7FB:s=1920x1080:r=30:d=${D.toFixed(3)}`, "-i", meta.file];
  caps.forEach((f) => inputs.push("-loop", "1", "-t", D.toFixed(3), "-i", f));
  const graph = [
    `[1:v]scale=${W}:${H}:flags=lanczos,format=yuva420p[ph]`,
    `color=c=black@0.30:s=${W + 40}x${H + 40}:r=30:d=${D.toFixed(3)},format=yuva420p,boxblur=18:2[sh]`,
    `[0:v][sh]overlay=${X - 20}:${Y - 4}[b0]`,
    `[b0][ph]overlay=${X}:${Y}[b1]`,
  ];
  let last = "b1";
  meta.captions.forEach((c, i) => {
    const s = c.start, e = Math.max(c.end, c.start + 0.5);
    graph.push(`[${i + 2}:v]format=rgba,fade=t=in:st=${s.toFixed(2)}:d=0.2:alpha=1,fade=t=out:st=${(e - 0.2).toFixed(2)}:d=0.2:alpha=1[c${i}]`);
    graph.push(`[${last}][c${i}]overlay=0:0:enable='between(t,${s.toFixed(2)},${e.toFixed(2)})'[o${i}]`);
    last = `o${i}`;
  });
  const out = path.join(CLIPS, "10-composed.mp4");
  ffmpeg([...inputs, "-filter_complex", graph.join(";"), "-map", `[${last}]`, "-t", D.toFixed(3), "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", out]);
  return out;
}

export async function assemble(): Promise<void> {
  const metas: ClipMeta[] = [];
  for (let i = 0; i < SECTIONS; i++) {
    const f = path.join(CLIPS, `${String(i).padStart(2, "0")}.json`);
    if (!fs.existsSync(f)) throw new Error(`missing clip ${i}: record it first (npm run record -- --section ${i})`);
    metas.push(JSON.parse(fs.readFileSync(f, "utf8")) as ClipMeta);
  }
  console.log("==> Assembling");
  const files = await Promise.all(metas.map(async (m) => (m.phone ? composePhone(m) : m.file)));
  const durations = files.map((f) => probeDuration(f));

  // crossfade chain: clip k starts at sum(d0..dk-1) - k*FADE
  const starts: number[] = [];
  let acc = 0;
  durations.forEach((dur, k) => { starts.push(acc - k * FADE); acc += dur; });
  const graph: string[] = [];
  let prev = "0:v";
  for (let k = 1; k < files.length; k++) {
    const label = k === files.length - 1 ? "vout" : `x${k}`;
    graph.push(`[${prev}][${k}:v]xfade=transition=fade:duration=${FADE}:offset=${(starts[k]!).toFixed(3)}[${label}]`);
    prev = label;
  }
  const mp4 = path.join(OUT, "club8-crm-demo.mp4");
  ffmpeg([
    ...files.flatMap((f) => ["-i", f]),
    "-filter_complex", graph.join(";"), "-map", "[vout]",
    "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4,
  ]);

  // captions and chapters on the final timeline
  const srt: string[] = [];
  let n = 0;
  const short: string[] = [];
  metas.forEach((m, k) => {
    for (const c of m.captions) {
      const s = starts[k]! + c.start, e = starts[k]! + Math.min(c.end, durations[k]!);
      srt.push(String(++n), `${ts(s)} --> ${ts(e)}`, c.text, "");
      if (e - s < 2.5) short.push(`${(e - s).toFixed(1)} s  ${c.text}`);
    }
  });
  fs.writeFileSync(path.join(OUT, "club8-crm-demo.srt"), srt.join("\n"));
  const chapters = metas.map((m, k) => `${mmss(starts[k]!)} ${m.title}`);
  fs.writeFileSync(path.join(OUT, "chapters.txt"), chapters.join("\n") + "\n");

  // quality check: a frame every 5 s (and contact sheets to review), length, size
  const qc = path.join(OUT, "qc");
  fs.rmSync(qc, { recursive: true, force: true });
  fs.mkdirSync(qc, { recursive: true });
  ffmpeg(["-i", mp4, "-vf", "fps=1/5", path.join(qc, "f%03d.png")]);
  ffmpeg(["-i", mp4, "-vf", "fps=1/5,scale=640:-1,tile=3x3", path.join(qc, "sheet%02d.png")]);
  const total = probeDuration(mp4);
  const mb = fs.statSync(mp4).size / 1024 / 1024;
  const report = [
    `file: ${mp4}`,
    `length: ${mmss(total)} (${total.toFixed(1)} s)`,
    `size: ${mb.toFixed(1)} MB`,
    "chapters:", ...chapters.map((c) => `  ${c}`),
    `captions: ${n}, shorter than 2.5 s: ${short.length}`, ...short.map((s) => `  ${s}`),
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "qc-report.txt"), report + "\n");
  console.log(report);
  if (total < 300 || total > 360) console.warn(`!! length ${mmss(total)} is outside 5:00-6:00`);
  if (mb >= 100) console.warn("!! file is 100 MB or larger");
}
