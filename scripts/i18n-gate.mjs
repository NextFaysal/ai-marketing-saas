#!/usr/bin/env node
/**
 * ML16 (Multi-Language MB6) — zero-hardcoded-string ENFORCEMENT GATE.
 *
 * The ML3 scanner measured; this gate enforces the ML-L1 law
 * ("one string, one key, one home") from MB6 onward:
 *
 *  - Every file under apps/web/src, apps/admin/src, apps/api/src is
 *    scanned with the scanner's core (scripts/i18n-scan.mjs) —
 *    dictionary homes and test/spec files are excluded by the
 *    scanner itself.
 *  - A file with findings PASSES only if it has an entry in
 *    scripts/i18n-gate-allowlist.json carrying an explicit reason,
 *    and its per-category counts stay at or below the entry's
 *    pinned caps (bengali / english / localeCalls).
 *  - Anything else FAILS the gate: a new hardcoded UI literal, a
 *    new direct toLocaleString call, or growth beyond a reviewed
 *    cap in an already-allowlisted file. A stale allowlist entry
 *    (file gone) also fails — the list must stay reviewed, not
 *    accumulate.
 *  - When an allowlisted file's counts DROP below its caps the
 *    gate passes but prints a "can be tightened" note.
 *
 * Adding copy the right way: put the string in the dictionary
 * (web: apps/web/src/lib/i18n, admin: apps/admin/src/lib/i18n.ts,
 * api: apps/api/src/i18n/catalog) — never raise a cap to silence
 * the gate without reviewing WHY the file needs literals.
 *
 * Usage: node scripts/i18n-gate.mjs [--json]
 * Exit: 0 = pass, 1 = violations found.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, SURFACES, isExcluded, walk, scanFile } from "./i18n-scan.mjs";

const ALLOWLIST_PATH = join(ROOT, "scripts/i18n-gate-allowlist.json");
const asJson = process.argv.includes("--json");

if (!existsSync(ALLOWLIST_PATH)) {
  console.error(`i18n gate: allowlist not found at ${ALLOWLIST_PATH}`);
  process.exit(1);
}
const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
const entries = new Map();
for (const e of allowlist.entries ?? []) {
  if (!e.path || typeof e.reason !== "string" || !e.reason.trim()) {
    console.error(`i18n gate: allowlist entry without path/reason: ${JSON.stringify(e)}`);
    process.exit(1);
  }
  if (entries.has(e.path)) {
    console.error(`i18n gate: duplicate allowlist entry for ${e.path}`);
    process.exit(1);
  }
  entries.set(e.path, e);
}

const violations = [];
const tightenable = [];
const seen = new Set();
const totals = { files: 0, filesWithFindings: 0, bengali: 0, english: 0, localeCalls: 0 };

for (const surface of SURFACES) {
  const files = walk(join(ROOT, surface.dir));
  for (const file of files) {
    const rel = "/" + relative(ROOT, file);
    if (isExcluded(rel)) continue;
    totals.files++;
    const r = scanFile(file);
    if (!r.bengali && !r.english && !r.localeCalls) continue;
    totals.filesWithFindings++;
    totals.bengali += r.bengali;
    totals.english += r.english;
    totals.localeCalls += r.localeCalls;
    seen.add(rel);
    const entry = entries.get(rel);
    if (!entry) {
      violations.push({
        path: rel,
        kind: "not-allowlisted",
        actual: r,
        detail: "file has hardcoded-literal findings but no reviewed allowlist entry",
      });
      continue;
    }
    const caps = entry.caps ?? {};
    for (const [cat, capKey] of [["bengali", "bengali"], ["english", "english"], ["localeCalls", "localeCalls"]]) {
      const cap = caps[capKey];
      if (typeof cap !== "number") {
        violations.push({ path: rel, kind: "missing-cap", actual: r, detail: `allowlist entry lacks a numeric cap for ${capKey}` });
      } else if (r[cat] > cap) {
        violations.push({
          path: rel,
          kind: "cap-exceeded",
          actual: r,
          detail: `${cat} findings ${r[cat]} exceed the reviewed cap ${cap} — new hardcoded literal(s) in an allowlisted file`,
        });
      } else if (r[cat] < cap) {
        tightenable.push({ path: rel, cat, actual: r[cat], cap });
      }
    }
  }
}

for (const path of entries.keys()) {
  if (!seen.has(path) && !existsSync(join(ROOT, path))) {
    violations.push({ path, kind: "stale-entry", detail: "allowlist entry points at a file that no longer exists — remove or update the entry" });
  }
}

if (asJson) {
  console.log(JSON.stringify({ totals, violations, tightenable }, null, 2));
} else {
  console.log("i18n enforcement gate (ML16)\n");
  console.log(
    `scanned ${totals.files} files · ${totals.filesWithFindings} with findings · ` +
    `${totals.bengali} Bengali literals · ${totals.english} English-UI literals (heuristic) · ` +
    `${totals.localeCalls} direct toLocaleString calls`,
  );
  if (tightenable.length) {
    console.log(`\nnote: ${tightenable.length} allowlist cap(s) can be tightened (findings dropped below the reviewed cap):`);
    for (const t of tightenable.slice(0, 20)) console.log(`  ${t.path} — ${t.cat}: actual ${t.actual} < cap ${t.cap}`);
  }
  if (violations.length) {
    console.log(`\nFAIL — ${violations.length} violation(s):`);
    for (const v of violations) {
      console.log(`  ${v.path} [${v.kind}] ${v.detail}`);
      if (v.actual) console.log(`      actual: bn ${v.actual.bengali}, en ${v.actual.english}, localeCalls ${v.actual.localeCalls}`);
    }
    console.log("\nFix: move the string(s) into the dictionary/catalog, or — only with a real reason — add/adjust the reviewed entry in scripts/i18n-gate-allowlist.json.");
  } else {
    console.log("\nPASS — every finding is covered by a reviewed allowlist entry within its caps.");
  }
}
process.exit(violations.length ? 1 : 0);
