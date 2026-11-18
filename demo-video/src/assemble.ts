/**
 * Post-production with ffmpeg: phone clip on a brand background, 300 ms crossfades, H.264 MP4, captions (SRT),
 * chapters and a quality-check report. Reads the section files and their metadata from one folder (out/clips/ for
 * the main video, out/clip<n>/ for a follow-up clip).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import type { ClipMeta } from "./scene";
import { OVERLAY_SCRIPT } from "./overlay";
import { execFileSync } from "node:child_process";
import { FFMPEG, FFPROBE, PHONE, RGB_TO_TV, TV_TAGS, ffmpeg, probeDuration } from "./screencast";
import { ROOT } from "./stack";

const OUT = path.join(ROOT, "demo-video", "out");
const CLIPS = path.join(OUT, "clips");
const FADE = 0.3;

/** What to assemble and where: the section folder and count, the output files, and the QC limits. */
export type Output = {
  dir: string; sections: number;
  mp4: string; srt: string; chapters: string; qcReport: string; qcDir: string;
  minS: number; maxS: number; maxMB: number;
};
/** The main video. 6:30 upper limit: docs/DEMO_VIDEO_PROMPT.md, the same as the voiced main video. */
export const MAIN_OUTPUT: Output = {
  dir: CLIPS, sections: 13,
  mp4: path.join(OUT, "club8-crm-demo.mp4"), srt: path.join(OUT, "club8-crm-demo.srt"), chapters: path.join(OUT, "chapters.txt"),
  qcReport: path.join(OUT, "qc-report.txt"), qcDir: path.join(OUT, "qc"),
  minS: 300, maxS: 390, maxMB: 100,
};
/** A follow-up clip (docs/DEMO_CLIPS_PROMPT.md): sections in out/clip<n>/, outputs in out/clips/, 2:00-3:15, < 50 MB. */
export function clipOutput(n: number, slug: string, sections: number): Output {
  const base = path.join(CLIPS, `club8-crm-clip${n}-${slug}`);
  return {
    dir: path.join(OUT, `clip${n}`), sections,
    mp4: `${base}.mp4`, srt: `${base}.srt`, chapters: path.join(CLIPS, `chapters-clip${n}.txt`),
    qcReport: path.join(CLIPS, `qc-clip${n}.txt`), qcDir: path.join(OUT, `clip${n}`, "qc"),
    minS: 120, maxS: 195, maxMB: 50,
  };
}
export type QcResult = { total: number; mb: number; chapters: string[]; problems: string[] };

const ts = (s: number, sep = ",") => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The caption bar as in the app recordings, rendered to a transparent 1920×1080 PNG (phone clip). `left`: place the
 * bar there, vertically centred and left-aligned (beside the phone), instead of the centred lower third. */
async function captionPngs(captions: { text: string }[], dir: string, left?: number): Promise<string[]> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(OVERLAY_SCRIPT);
  await page.setContent("<!doctype html><html><head></head><body style='margin:0;background:transparent'></body></html>");
  await page.evaluate(OVERLAY_SCRIPT);
  if (left !== undefined) {
    await page.addStyleTag({ content: `#demo-caption{left:${left}px!important;right:auto!important;top:50%!important;bottom:auto!important;` +
      `transform:translateY(-50%)!important;max-width:${1920 - left - 140}px!important;text-align:left!important}` });
  }
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

/** The phone section: the PHONE-sized recording on #F7F7FB with a soft shadow, left of centre at 1.46 video pixels per
 * CSS pixel (readable text), with the captions beside it rather than over its lower half. */
async function composePhone(meta: ClipMeta): Promise<string> {
  const dir = path.join(OUT, "phone");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const H = 972, W = Math.round((PHONE.width / PHONE.height) * H / 2) * 2, X = 380, Y = (1080 - H) / 2;
  const caps = await captionPngs(meta.captions, dir, X + W + 100);
  const D = meta.duration;
  const inputs = ["-f", "lavfi", "-i", `color=c=0xF7F7FB:s=1920x1080:r=30:d=${D.toFixed(3)}`, "-i", meta.file];
  caps.forEach((f) => inputs.push("-loop", "1", "-t", D.toFixed(3), "-i", f));
  // RGB sources (background colour, caption PNGs) go to limited-range BT.709 like the clips, so colours match
  const graph = [
    `[0:v]format=rgb24,${RGB_TO_TV},format=yuv420p[bg]`,
    // area averaging: lanczos rings at the text edges when shrinking, overshooting the limited range
    `[1:v]${toTv(meta.file)},scale=${W}:${H}:flags=area,format=yuva420p[ph]`,
    // soft shadow: a translucent phone-sized block on a transparent margin, blurred so its edges fade out
    `color=c=black@0.22:s=${W}x${H}:r=30:d=${D.toFixed(3)},format=rgba,pad=${W + 120}:${H + 120}:60:60:color=black@0,boxblur=24:3,${RGB_TO_TV},format=yuva420p[sh]`,
    `[bg][sh]overlay=${X - 60}:${Y - 60 + 14}[b0]`,
    `[b0][ph]overlay=${X}:${Y}[b1]`,
  ];
  let last = "b1";
  meta.captions.forEach((c, i) => {
    const s = c.start, e = Math.max(c.end, c.start + 0.5);
    graph.push(`[${i + 2}:v]format=rgba,fade=t=in:st=${s.toFixed(2)}:d=0.2:alpha=1,fade=t=out:st=${(e - 0.2).toFixed(2)}:d=0.2:alpha=1,${RGB_TO_TV},format=yuva420p[c${i}]`);
    graph.push(`[${last}][c${i}]overlay=0:0:enable='between(t,${s.toFixed(2)},${e.toFixed(2)})'[o${i}]`);
    last = `o${i}`;
  });
  const out = path.join(CLIPS, `${String(meta.id).padStart(2, "0")}-composed.mp4`);
  graph.push(`[${last}]format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[pout]`);
  ffmpeg([...inputs, "-filter_complex", graph.join(";"), "-map", "[pout]", "-t", D.toFixed(3), "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "14", ...TV_TAGS, out]);
  return out;
}

export async function assemble(o: Output = MAIN_OUTPUT): Promise<QcResult> {
  const metas: ClipMeta[] = [];
  for (let i = 0; i < o.sections; i++) {
    const f = path.join(o.dir, `${String(i).padStart(2, "0")}.json`);
    if (!fs.existsSync(f)) throw new Error(`missing section ${i} in ${path.relative(OUT, o.dir)}: record it first`);
    metas.push(JSON.parse(fs.readFileSync(f, "utf8")) as ClipMeta);
  }
  console.log(`==> Assembling ${path.basename(o.mp4)}`);
  fs.mkdirSync(path.dirname(o.mp4), { recursive: true });
  const files = await Promise.all(metas.map(async (m) => (m.phone ? composePhone(m) : m.file)));
  const durations = files.map((f) => probeDuration(f));

  // crossfade chain: clip k starts at sum(d0..dk-1) - k*FADE
  const starts: number[] = [];
  let acc = 0;
  durations.forEach((dur, k) => { starts.push(acc - k * FADE); acc += dur; });
  // every clip to limited-range BT.709 first, so the crossfades mix like with like
  const graph: string[] = files.map((f, k) => `[${k}:v]${toTv(f)}[n${k}]`);
  let prev = "n0";
  for (let k = 1; k < files.length; k++) {
    graph.push(`[${prev}][n${k}]xfade=transition=fade:duration=${FADE}:offset=${(starts[k]!).toFixed(3)}[x${k}]`);
    prev = `x${k}`;
  }
  graph.push(`[${prev}]format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[vout]`);
  const mp4 = o.mp4;
  ffmpeg([
    ...files.flatMap((f) => ["-i", f]),
    "-filter_complex", graph.join(";"), "-map", "[vout]",
    "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "20", ...TV_TAGS, "-movflags", "+faststart", mp4,
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
  fs.writeFileSync(o.srt, srt.join("\n"));
  const chapters = metas.map((m, k) => `${mmss(starts[k]!)} ${m.title}`);
  fs.writeFileSync(o.chapters, chapters.join("\n") + "\n");

  // quality check: a frame every 5 s (and contact sheets to review), length, size
  const qc = o.qcDir;
  fs.rmSync(qc, { recursive: true, force: true });
  fs.mkdirSync(qc, { recursive: true });
  ffmpeg(["-i", mp4, "-vf", "fps=1/5", path.join(qc, "f%03d.png")]);
  ffmpeg(["-i", mp4, "-vf", "fps=1/5,scale=640:-1,tile=3x3", path.join(qc, "sheet%02d.png")]);
  const total = probeDuration(mp4);
  const mb = fs.statSync(mp4).size / 1024 / 1024;
  const fmt = videoFormat(mp4);
  const luma = lumaRange(mp4);
  const fmtOk = fmt.pix_fmt === "yuv420p" && fmt.color_range === "tv" && fmt.color_space === "bt709";
  const lumaOk = luma.low >= 16 && luma.high <= 235;
  const report = [
    `file: ${mp4}`,
    `length: ${mmss(total)} (${total.toFixed(1)} s)`,
    `size: ${mb.toFixed(1)} MB`,
    `format: ${fmt.codec_name} ${fmt.width}x${fmt.height} ${fmt.pix_fmt}, range ${fmt.color_range}, ${fmt.color_space} ${fmtOk ? "(ok)" : "(NOT yuv420p / tv / bt709)"}`,
    `luma (1 frame/s): body ${luma.low}-${luma.high} ${lumaOk ? "(limited range 16-235)" : "(OUTSIDE 16-235: full range?)"}; ` +
      `peaks ${luma.min}-${luma.max} (single pixels at sharp edges, H.264 overshoot, clipped by players)`,
    "chapters:", ...chapters.map((c) => `  ${c}`),
    `captions: ${n}, shorter than 2.5 s: ${short.length}`, ...short.map((s) => `  ${s}`),
  ].join("\n");
  fs.writeFileSync(o.qcReport, report + "\n");
  console.log(report);
  const problems: string[] = [];
  if (total < o.minS || total > o.maxS) problems.push(`length ${mmss(total)} is outside ${mmss(o.minS)}-${mmss(o.maxS)}`);
  if (mb >= o.maxMB) problems.push(`file is ${o.maxMB} MB or larger`);
  if (!fmtOk) problems.push("video is not tagged yuv420p, limited range, BT.709");
  if (!lumaOk) problems.push("luma body leaves the limited range 16-235 (full-range video?)");
  if (short.length) problems.push(`${short.length} caption(s) shorter than 2.5 s`);
  for (const p of problems) console.warn(`!! ${p}`);
  return { total, mb, chapters, problems };
}

/** Filter converting a clip to limited-range BT.709 yuv420p from whatever it is (clips recorded before the explicit
 * conversion are full-range BT.601 yuvj420p). */
function toTv(file: string): string {
  const f = videoFormat(file);
  const full = f.color_range === "pc" || f.pix_fmt?.startsWith("yuvj");
  const matrix = f.color_space === "bt709" ? "bt709" : "bt601";
  return `scale=in_range=${full ? "full" : "limited"}:out_range=limited:in_color_matrix=${matrix}:out_color_matrix=bt709,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709`;
}

/** Pixel format and colour tags of the first video stream. */
function videoFormat(file: string): Record<string, string> {
  const out = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=codec_name,width,height,pix_fmt,color_range,color_space", "-of", "default=noprint_wrappers=1", file], { encoding: "utf8" });
  return Object.fromEntries(out.trim().split(/\r?\n/).map((l) => l.split("=") as [string, string]));
}

/** Luma over one frame a second. `low`/`high`: the darkest 10th and brightest 90th percentile of any frame; a
 * limited-range video keeps them within 16-235 (full-range white UI reads 255). `min`/`max`: single-pixel peaks. */
function lumaRange(file: string): { low: number; high: number; min: number; max: number } {
  // ffmpeg prints the per-frame stats to stdout; the filter graph names no paths (Windows drive letters need escaping)
  const out = execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", "fps=1,signalstats,metadata=print:file=-", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 1 << 26 });
  const nums = (key: string) => [...out.matchAll(new RegExp(`lavfi\\.signalstats\\.${key}=(\\d+)`, "g"))].map((m) => Number(m[1]));
  return { low: Math.min(...nums("YLOW")), high: Math.max(...nums("YHIGH")), min: Math.min(...nums("YMIN")), max: Math.max(...nums("YMAX")) };
}
