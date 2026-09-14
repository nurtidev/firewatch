#!/usr/bin/env node
/**
 * Asserts that the severity hex colors hardcoded in lib/risk.ts
 * (`SEVERITY[key].hex`) still match globals.css (`--critical`/`--high`/
 * `--elevated`/`--normal`/`--info`). The duplication itself is intentional
 * and unavoidable — MapLibre paint properties (`fill-color`, `circle-color`)
 * can't resolve `var(--color-*)` at all, so lib/risk.ts carries a literal
 * mirror for map layers (see lib/mapStyle.ts) — but a copy that can silently
 * drift needs a check, not just a comment asking nicely. Run in CI before
 * `npm run build` (see .github/workflows/ci.yml, web job) so a color change
 * in one file that forgets the other fails fast (CLAUDE.md hard rule 2).
 *
 * No dependencies — plain regex over the two source files, not a CSS/TS
 * parser. Exits 1 with a diff-style message on any mismatch or missing
 * declaration.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const cssPath = join(root, "src/app/globals.css");
const riskPath = join(root, "src/lib/risk.ts");

const css = readFileSync(cssPath, "utf8");
const risk = readFileSync(riskPath, "utf8");

// Severity keys as named in both files — lib/risk.ts SEVERITY object keys
// and globals.css `--<key>` custom properties share the same names.
const KEYS = ["critical", "high", "elevated", "normal", "info"];

function cssColor(key) {
  // First occurrence only (`:root`) — globals.css keeps severity hue
  // identical in light mode by design ("Severity — color IS data (identical
  // hue in light)"), so `.light` doesn't redefine these; if that ever
  // changes, only the `:root` value is checked here on purpose (this script
  // verifies the base palette, not every theme override).
  const re = new RegExp(`--${key}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`);
  const m = css.match(re);
  if (!m) throw new Error(`globals.css: no "--${key}:" declaration found`);
  return m[1].toLowerCase();
}

function riskHex(key) {
  // Scoped to the `<key>: { ... }` object literal in SEVERITY so a hex value
  // belonging to a different severity can't match by accident. Each entry is
  // a flat object (no nested braces), so the first closing `}` after `key: {`
  // reliably ends that entry.
  const blockRe = new RegExp(`\\b${key}:\\s*{([\\s\\S]*?)}`);
  const block = risk.match(blockRe);
  if (!block) throw new Error(`lib/risk.ts: no SEVERITY.${key} entry found`);
  const hexMatch = block[1].match(/hex:\s*"(#[0-9a-fA-F]{3,8})"/);
  if (!hexMatch) throw new Error(`lib/risk.ts: SEVERITY.${key} has no "hex" field`);
  return hexMatch[1].toLowerCase();
}

let failed = false;
for (const key of KEYS) {
  const fromCss = cssColor(key);
  const fromRisk = riskHex(key);
  if (fromCss !== fromRisk) {
    failed = true;
    console.error(
      `severity color drift: --${key} is ${fromCss} in globals.css but SEVERITY.${key}.hex is ${fromRisk} in lib/risk.ts`,
    );
  }
}

if (failed) {
  console.error(
    "\nFix: make globals.css and lib/risk.ts SEVERITY[key].hex agree (hard rule 2, CLAUDE.md).",
  );
  process.exit(1);
}

console.log(`check-severity-colors: ${KEYS.length} severity colors match (globals.css ↔ lib/risk.ts)`);
