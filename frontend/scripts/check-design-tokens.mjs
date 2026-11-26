#!/usr/bin/env node
/* Fails if a component bypasses the design tokens (docs/DESIGN_SYSTEM.md):
 *   - hex / rgb() / hsl() colours anywhere in src except globals.css
 *   - Tailwind's default palette classes (bg-red-500, text-zinc-900 ...)
 *   - arbitrary Tailwind values in px / rem / em / colours (text-[13px], w-[3px], bg-[#fff])
 *   - inline style colours or font sizes
 * Allow a single line with a trailing `// design-tokens-allow: <reason>` comment. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white";
const RULES = [
  [/#[0-9a-fA-F]{3,8}\b(?![\w-]*\})/, "hex colour"],
  [/\b(?:rgb|rgba|hsl|hsla)\(/, "raw colour function"],
  // our brand token is called `orange` (bg-orange, ring-orange-subtle): only numbered shades are Tailwind's palette
  [new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|accent|divide|placeholder|shadow)-(?:(?:${PALETTE})-\\d{2,3}|black|white)\\b`), "Tailwind palette colour"],
  // grid track templates (grid-cols-[16rem_1fr]) are layout, not spacing, and are allowed
  [/(?<=^|[\s"'`])(?!(?:[\w-]+:)*grid-cols-)[\w:-]+-\[[^\]]*(?:\d(?:px|rem|em)|#|rgb|hsl)[^\]]*\]/, "arbitrary px/rem/colour value"],
  [/style=\{\{[^}]*\b(?:color|background|fontSize|font-size)\b/, "inline colour / font size"],
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith("globals.css") && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

const problems = [];
for (const f of files(ROOT)) {
  readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => { // CRLF on Windows checkouts: "." never matches "\r"
    if (line.includes("design-tokens-allow")) return;
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    for (const [re, what] of RULES) {
      const m = code.match(re);
      if (m) problems.push(`${relative(process.cwd(), f)}:${i + 1}  ${what}: ${m[0]}`);
    }
  });
}
if (problems.length) {
  console.error(`Design token check failed (${problems.length}):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("Design token check passed: no hard-coded colours, font sizes or ad-hoc spacing in components.");
