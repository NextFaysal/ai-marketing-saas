#!/usr/bin/env node
/**
 * ED18 (EB7) — Lighthouse budget runner for the E-Commerce Design
 * & Experience Program.
 *
 * Runs Lighthouse (via npx, mobile emulation by default) against a
 * DEPLOYED shop's home / listing / PDP / checkout and asserts the
 * budgets in lighthouse-budgets.json (plan targets: Performance
 * >= 90, LCP <= 2.5s, CLS <= 0.1, TBT <= 200ms as the lab proxy
 * for INP <= 200ms, checkout interactive <= 3s).
 *
 * This is a POST-DEPLOY tool: the storefront needs a live API +
 * a real shop with products. It was NOT run in the build sandbox
 * (no seeded backend exists there) and no scores are claimed by
 * the program — see docs/design-eb7-acceptance.md.
 *
 * Usage:
 *   node scripts/lighthouse-budgets.mjs \
 *     --base https://app.qosprey.com \
 *     --org <shop-slug> --product <product-slug> \
 *     [--listing-url https://…/shop/<slug>?category=<slug>] \
 *     [--chrome-path /path/to/chrome] [--out ./lighthouse-out] \
 *     [--pages home,pdp] [--keep-reports]
 *
 * Exit code: 0 = every asserted budget passed; 1 = at least one
 * budget failed or a run errored. JSON reports land in --out
 * (default ./lighthouse-out) and are kept on failure either way.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const budgetsFile = join(here, "lighthouse-budgets.json");
const budgets = JSON.parse(readFileSync(budgetsFile, "utf8"));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const base = (arg("base", "") || "").replace(/\/$/, "");
const org = arg("org", "");
const product = arg("product", "");
const chromePath =
  arg("chrome-path", "") || process.env.CHROME_PATH || "/opt/meta-chromium/chrome";
const outDir = arg("out", join(process.cwd(), "lighthouse-out"));
const onlyPages = (arg("pages", "") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!base || !org) {
  console.error(
    "Usage: node scripts/lighthouse-budgets.mjs --base https://host --org <shop-slug> --product <product-slug> [--listing-url <url>] [--chrome-path <path>] [--out <dir>] [--pages home,listing,pdp,checkout]",
  );
  process.exit(2);
}

function pageUrl(key) {
  if (key === "listing" && arg("listing-url", "")) return arg("listing-url", "");
  const path = budgets.pages[key].path
    .replace("{org}", org)
    .replace("{product}", product || "");
  return base + path;
}

function auditValue(report, id) {
  const audit = report.audits?.[id];
  return typeof audit?.numericValue === "number" ? audit.numericValue : null;
}

function checkPage(key) {
  const spec = budgets.pages[key];
  const url = pageUrl(key);
  if (key === "pdp" && !product) {
    return { key, url, skipped: "no --product given" };
  }
  const reportPath = join(outDir, `lighthouse-${key}.json`);
  const args = [
    "-y",
    "lighthouse",
    url,
    "--output=json",
    `--output-path=${reportPath}`,
    `--chrome-path=${chromePath}`,
    '--chrome-flags=--headless=new --no-sandbox --disable-gpu',
    "--form-factor=mobile",
    "--screenEmulation.mobile=true",
    "--only-categories=performance",
    "--quiet",
  ];
  const run = spawnSync("npx", args, { stdio: "inherit", timeout: 300_000 });
  if (run.status !== 0) {
    return { key, url, error: `lighthouse exited ${run.status}` };
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const results = [];
  for (const [metric, rule] of Object.entries(spec.budgets)) {
    if (metric.startsWith("categories.")) {
      const cat = metric.split(".")[1];
      const score = report.categories?.[cat]?.score ?? null;
      results.push({
        metric,
        value: score === null ? null : Math.round(score * 100) / 100,
        rule: `>= ${rule.min}`,
        pass: score !== null && score >= rule.min,
      });
    } else if (rule.maxMs !== undefined) {
      const v = auditValue(report, metric);
      results.push({
        metric,
        value: v === null ? null : Math.round(v),
        rule: `<= ${rule.maxMs}ms`,
        pass: v !== null && v <= rule.maxMs,
      });
    } else if (rule.max !== undefined) {
      const v = auditValue(report, metric);
      results.push({
        metric,
        value: v === null ? null : Math.round(v * 1000) / 1000,
        rule: `<= ${rule.max}`,
        pass: v !== null && v <= rule.max,
      });
    }
  }
  return { key, url, results };
}

mkdirSync(outDir, { recursive: true });
const keys = Object.keys(budgets.pages).filter(
  (k) => onlyPages.length === 0 || onlyPages.includes(k),
);
let failed = 0;
console.log(`Lighthouse budgets — base ${base}, shop ${org}, budgets ${budgetsFile}\n`);
for (const key of keys) {
  const r = checkPage(key);
  if (r.skipped) {
    console.log(`• ${key}: SKIPPED (${r.skipped})`);
    continue;
  }
  if (r.error) {
    failed++;
    console.log(`• ${key}: ERROR ${r.error} — ${r.url}`);
    continue;
  }
  console.log(`• ${key}: ${r.url}`);
  for (const res of r.results) {
    const ok = res.pass;
    if (!ok) failed++;
    console.log(`    ${ok ? "PASS" : "FAIL"}  ${res.metric} = ${res.value}  (budget ${res.rule})`);
  }
}
console.log(
  failed === 0
    ? "\nAll asserted budgets passed."
    : `\n${failed} budget check(s) failed — reports in ${outDir}`,
);
writeFileSync(join(outDir, "lighthouse-summary.txt"), `run ${new Date().toISOString()} base=${base} org=${org} failed=${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
