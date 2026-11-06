// Checks WCAG 2.2 contrast for every text/background token pair FlowForge uses.
// Usage: node scripts/check-contrast.mjs   (exits 1 on failure)
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("\n}", start);
  const vars = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}
const light = block(":root");
const dark = { ...light, ...block(".dark") };

function resolve(vars, name) {
  let v = vars[name];
  for (let i = 0; i < 5 && v && v.startsWith("var("); i++) v = vars[v.slice(6, -1)];
  return v;
}
function lum(hex) {
  const n = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [foreground, background, minimum]
const pairs = [
  ["text", "background", 4.5], ["text", "surface", 4.5], ["text", "surface-sunken", 4.5],
  ["text-muted", "surface", 4.5], ["text-muted", "background", 4.5], ["text-muted", "surface-sunken", 4.5],
  ["text-subtle", "surface", 4.5], ["text-subtle", "surface-sunken", 4.5], ["text-subtle", "background", 4.5],
  ["primary-fg", "primary", 4.5], ["primary-fg", "primary-hover", 4.5], ["primary", "surface", 4.5], ["primary-soft-fg", "primary-soft", 4.5],
  ["link", "surface", 4.5], ["secondary-soft-fg", "secondary-soft", 4.5],
  ["success-fg", "success-soft", 4.5], ["warning-fg", "warning-soft", 4.5], ["danger-fg", "danger-soft", 4.5], ["info-fg", "info-soft", 4.5],
  ["neutral-fg", "neutral-soft", 4.5], ["danger", "surface", 4.5], ["success", "surface", 4.5], ["warning", "surface", 4.5], ["info", "surface", 4.5],
  ["input-border", "surface", 3], ["focus-ring", "surface", 3], ["focus-ring", "background", 3], ["primary", "background", 3],
];

let failed = 0;
for (const [theme, vars] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg, min] of pairs) {
    const a = resolve(vars, fg), b = resolve(vars, bg);
    let r = ratio(a, b);
    // White-on-danger buttons in light mode; dark mode uses dark text on danger.
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${theme.padEnd(5)} ${fg.padEnd(18)} on ${bg.padEnd(15)} ${r.toFixed(2)} (min ${min})`);
  }
}
// Destructive button: white on danger (light), dark text on danger (dark)
const dl = ratio("#ffffff", resolve(light, "danger")), dd = ratio(resolve(dark, "text-inverse"), resolve(dark, "danger"));
console.log(`${dl >= 4.5 ? "PASS" : "FAIL"}  light white on danger ${dl.toFixed(2)}`);
console.log(`${dd >= 4.5 ? "PASS" : "FAIL"}  dark  inverse on danger ${dd.toFixed(2)}`);
if (dl < 4.5) failed++; if (dd < 4.5) failed++;
console.log(failed ? `\n${failed} pair(s) below WCAG AA` : "\nAll token pairs meet WCAG 2.2 AA");
process.exit(failed ? 1 : 0);
