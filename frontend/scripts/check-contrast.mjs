#!/usr/bin/env node
/* WCAG 2.1 contrast check of the design tokens in src/app/globals.css, for BOTH brand themes (Club8 default and
 * [data-brand="k8"]). Prints the table used in docs/DESIGN_SYSTEM.md (`--markdown`) and fails if any required pair
 * is below its threshold. */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const block = (selector) => {
  const i = css.indexOf(selector);
  return css.slice(i, css.indexOf("}", i));
};
const parse = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const root = parse(block(":root {"));
const themes = { "Club8 (default)": { ...root }, K8: { ...root, ...parse(block('[data-brand="k8"] {')) } };

function hsl(tokens, name, depth = 0) {
  const v = tokens[name];
  if (!v) throw new Error(`unknown token --${name}`);
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  if (ref) return hsl(tokens, ref[1], depth + 1);
  const m = v.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!m) throw new Error(`--${name} is not an HSL triple: ${v}`);
  return [+m[1], +m[2], +m[3]];
}
function rgb([h, s, l]) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const lum = (c) => { const [r, g, b] = rgb(c).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (t, a, b) => { const [x, y] = [lum(hsl(t, a)), lum(hsl(t, b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground, background, minimum, usage]
const PAIRS = [
  ["text", "surface", 4.5, "Body text on cards"],
  ["text", "bg", 4.5, "Body text on page"],
  ["text-muted", "surface", 4.5, "Secondary text"],
  ["text-muted", "surface-sunken", 4.5, "Secondary text in table headers"],
  ["text-subtle", "surface", 4.5, "Tertiary text, hints"],
  ["text-subtle", "bg", 4.5, "Tertiary text on page"],
  ["text-subtle", "surface-sunken", 4.5, "Hints on sunken wells"],
  ["brand-primary", "surface", 4.5, "Links, active nav text, IDs"],
  ["brand-primary", "bg", 4.5, "Links on the page background"],
  ["brand-primary", "brand-primary-subtle", 4.5, "Active nav / tab / selected chip"],
  ["on-fill", "brand-primary", 4.5, "Primary button"],
  ["on-fill", "brand-primary-hover", 4.5, "Primary button hover"],
  ["brand-accent-text", "surface", 4.5, "Accent-coloured text (on white only)"],
  ["text", "brand-accent", 4.5, "DEV ribbon (dark text on accent fill)"],
  ["on-fill", "brand-secondary", 4.5, "Secondary fills with white text"],
  ["brand-secondary", "surface", 4.5, "Secondary text / info highlights"],
  ["on-fill", "danger", 4.5, "Danger button, critical badge"],
  ["success", "success-subtle", 4.5, "Success badge / alert"],
  ["warning", "warning-subtle", 4.5, "Warning-subtle badge"],
  ["warning", "warning-strong", 4.5, "Warning badge"],
  ["danger", "danger-subtle", 4.5, "Danger-subtle badge, errors"],
  ["danger", "surface", 4.5, "Error text"],
  ["info", "info-subtle", 4.5, "Info badge / alert"],
  ["season-red", "season-red-bg", 4.5, "Red season chip"],
  ["season-blue", "season-blue-bg", 4.5, "Blue season chip"],
  ["border-strong", "surface", 3, "Input borders (UI component)"],
  ["brand-primary", "surface", 3, "Focus ring"],
];
// Documented, intentionally decorative only:
const INFO = [["brand-accent", "surface", "Accent (orange / gold) on white: NEVER text; thin indicators and fills only"]];

let failed = 0;
const out = [];
for (const [theme, t] of Object.entries(themes)) {
  const brandOnly = theme !== "Club8 (default)";
  for (const [fg, bg, min, use] of PAIRS) {
    if (brandOnly && !fg.startsWith("brand") && !bg.startsWith("brand")) continue; // non-brand pairs are theme-independent
    const r = ratio(t, fg, bg);
    if (r < min) failed++;
    out.push(`| ${theme} | \`--${fg}\` on \`--${bg}\` | ${r.toFixed(2)}:1 | ${min}:1 | ${r >= min ? "Pass" : "**FAIL**"} | ${use} |`);
  }
  for (const [fg, bg, use] of INFO) out.push(`| ${theme} | \`--${fg}\` on \`--${bg}\` | ${ratio(t, fg, bg).toFixed(2)}:1 | n/a | Decorative only | ${use} |`);
}
if (process.argv.includes("--markdown")) console.log(["| Theme | Pair | Ratio | Required | Result | Used for |", "|---|---|---|---|---|---|", ...out].join("\n"));
else console.log(out.join("\n"));
if (failed) { console.error(`${failed} contrast pair(s) below WCAG 2.1 AA`); process.exit(1); }
