#!/usr/bin/env node
/**
 * ML3 (Multi-Language MB1) — hardcoded-string scanner.
 *
 * Finds user-visible string literals that live OUTSIDE the i18n
 * dictionary homes, so the i18n program can measure (MB1: baseline
 * only) and later enforce (MB6: zero-hardcoded-string gate) the
 * ML-L1 law "one string, one key, one home".
 *
 * What it counts, per surface (web / admin / api):
 *  - bengaliLiterals: string literals containing Bengali script
 *    (U+0980–U+09FF). In the bn-source codebase this is the primary
 *    signal of a hardcoded UI string.
 *  - englishUiLiterals: "obvious" English UI literals — quoted
 *    strings with at least 3 words and a space that do not look
 *    like code (URLs, class names, enum values, paths, keys are
 *    filtered out by the heuristics below). This is a heuristic
 *    signal, not a proof: treat the count as an upper bound.
 *  - toLocaleStringCalls: direct `.toLocaleString(` / 
 *    `toLocaleDateString(` / `toLocaleTimeString(` uses outside
 *    the central format module (ML2 ban — formatting must go
 *    through @repo/contracts fmt* functions).
 *
 * Excluded: node_modules, .next, test/spec files (fixtures are
 * allowed to carry literal text), and the dictionary homes
 * themselves (lib/i18n/**, lib/shop-i18n.ts shim, translations
 * modules whose whole job is holding localized content).
 *
 * Usage: node scripts/i18n-scan.mjs [--json] [--top N]
 * Exit code is always 0 in baseline mode (MB1). MB6 will add a
 * --fail-on-new mode; do not fake enforcement before then.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SURFACES = [
  { name: "web", dir: "apps/web/src" },
  { name: "admin", dir: "apps/admin/src" },
  { name: "api", dir: "apps/api/src" },
];
const DICTIONARY_HOME = [
  /\/lib\/i18n\//,
  /\/lib\/i18n\.ts$/, // the admin app's single-file dictionary home
  /\/lib\/shop-i18n\.ts$/,
  /\/translations\//, // NF5 content-translation modules hold localized content by design
  /\/lib\/translations\.ts$/,
];
const FORMAT_MODULE = /packages\/contracts\/src\/i18n-format\.ts$/;
const BENGALI = /[\u0980-\u09FF]/;

function isExcluded(rel) {
  if (/\.(test|spec)\.(ts|tsx)$/.test(rel)) return true;
  if (DICTIONARY_HOME.some((re) => re.test(rel))) return true;
  return false;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

/** Extract string literal contents (single/double/backtick) with a
 *  small state machine — good enough for counting; template
 *  expressions ${...} are skipped over, not parsed. */
function stringLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      let j = i + 1;
      let text = "";
      let depth = 0;
      while (j < n) {
        const ch = src[j];
        if (ch === "\\") { text += src[j + 1] ?? ""; j += 2; continue; }
        if (quote === "`" && ch === "$" && src[j + 1] === "{") { depth++; j += 2; continue; }
        if (quote === "`" && depth > 0) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          j++; continue;
        }
        if (ch === quote) break;
        if (quote !== "`" && ch === "\n") break;
        text += ch; j++;
      }
      out.push(text);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

function looksLikeCode(s) {
  if (/^https?:\/\//.test(s)) return true;
  if (/^[A-Z0-9_]+$/.test(s)) return true; // enum / constant
  if (/^[a-z0-9\-_\/.:[\] ]+$/i.test(s) && !/[A-Z]/.test(s.slice(1))) return true; // class/path/key-ish
  if (/^[\w.]+@[\w.]+$/.test(s)) return true; // email-ish
  if (/[{}<>]|=>|::|__/.test(s)) return true;
  if (/^\d|^[#$%&*+=\\^|~]/.test(s)) return true;
  return false;
}

function isEnglishUiLiteral(s) {
  const t = s.trim();
  if (t.length < 12) return false;
  if (BENGALI.test(t)) return false;
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length < 3) return false;
  if (looksLikeCode(t)) return false;
  return /[A-Za-z]/.test(t);
}

function scanFile(path) {
  const src = readFileSync(path, "utf8");
  const literals = stringLiterals(src);
  let bengali = 0;
  let english = 0;
  for (const lit of literals) {
    if (BENGALI.test(lit)) bengali++;
    else if (isEnglishUiLiteral(lit)) english++;
  }
  const localeCalls = FORMAT_MODULE.test(path)
    ? 0
    : (src.match(/\.toLocale(String|DateString|TimeString)\s*\(/g) ?? []).length;
  return { bengali, english, localeCalls };
}

const asJson = process.argv.includes("--json");
const topN = Number(process.argv.find((a) => a.startsWith("--top"))?.split("=")[1] ?? 10);

const report = {};
for (const surface of SURFACES) {
  const files = walk(join(ROOT, surface.dir));
  const perFile = [];
  let scanned = 0;
  const totals = { files: 0, filesWithFindings: 0, bengaliLiterals: 0, englishUiLiterals: 0, toLocaleStringCalls: 0 };
  for (const file of files) {
    const rel = "/" + relative(ROOT, file);
    if (isExcluded(rel)) continue;
    scanned++;
    const r = scanFile(file);
    if (r.bengali || r.english || r.localeCalls) {
      totals.filesWithFindings++;
      totals.bengaliLiterals += r.bengali;
      totals.englishUiLiterals += r.english;
      totals.toLocaleStringCalls += r.localeCalls;
      perFile.push({ file: rel, ...r, score: r.bengali + r.english });
    }
  }
  totals.files = scanned;
  perFile.sort((a, b) => b.score - a.score);
  report[surface.name] = { totals, top: perFile.slice(0, topN) };
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("i18n hardcoded-string scan — baseline (MB1, report-only)\n");
  for (const [name, r] of Object.entries(report)) {
    const t = r.totals;
    console.log(
      `${name}: ${t.files} files scanned · ${t.filesWithFindings} with findings · ` +
      `${t.bengaliLiterals} Bengali literals · ${t.englishUiLiterals} English-UI literals (heuristic) · ` +
      `${t.toLocaleStringCalls} direct toLocaleString calls`,
    );
    for (const f of r.top.slice(0, 5)) {
      console.log(`    ${f.score}\t${f.file} (bn ${f.bengali}, en ${f.english}, localeCalls ${f.localeCalls})`);
    }
  }
  const g = Object.values(report).reduce(
    (a, r) => ({
      bengali: a.bengali + r.totals.bengaliLiterals,
      english: a.english + r.totals.englishUiLiterals,
      localeCalls: a.localeCalls + r.totals.toLocaleStringCalls,
    }),
    { bengali: 0, english: 0, localeCalls: 0 },
  );
  console.log(`\nTOTAL: ${g.bengali} Bengali literals · ${g.english} English-UI literals · ${g.localeCalls} direct toLocaleString calls`);
}
