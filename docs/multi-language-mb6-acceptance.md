# Multi-Language MB6 — Acceptance (ML16: remainder sweep + enforcement gate + program close)

Batch: MB6 of the Multi-Language Master Plan (§৬ MB6, §৭ gates) — the
FINAL batch. Built on MB5 HEAD `37397ec3`, branch `multi-language`,
worktree `~/workspace/ai-marketing-saas-i18n`. Local commits only —
**no push** (owner rule). **No migration** in this batch (none was
needed; the fresh-PG gate still ran the full 282 sequence).

Execution: two parallel sweep workers with disjoint file ownership
(Worker A = API proactive; Worker B = web shared-lib/pages), workers
did not commit; the coordinator reviewed every diff, did the
dead-key audit/removal + the live-commerce trio closure + the gate,
ran all heavy gates serially, and committed per workstream. One
owner per file throughout (the MB2 lesson held).

## Commits

| Commit | Scope |
|---|---|
| `3f9decff` | Sweep: proactive catalogued, shared-lib locale closures, 154 dead keys removed |
| `1dd397fc` | Enforcement gate: scanner core export + `i18n-gate.mjs` + 541-entry reviewed allowlist + `pnpm i18n:gate` |
| (this doc's commit) | QA checklist + MB6 acceptance + program summary |

## Item audit — ML16

### 1. Remainder sweep — CLOSED in code

**MB5 exception 1 (proactive strings) — CLOSED.** All bn/en call-site
pairs in `ai/proactive.service.ts` moved to a new API catalog
namespace, `catalog/proactive.ts` (13 keys: radar ×3, month pacing
×2 — the sign+direction word pair, commerce status, briefing
summary/no-data/anomalies/COGS lines, opportunities header, briefing
title, anomaly title). Rendered output is byte-identical (the
unchanged proactive spec passes 10/10; Worker A passed `String(...)`
for any-typed params so template-literal rendering is preserved
exactly, typographic quotes and baked-in Bengali digits included).
The anomaly *body* remains detector data, as before.

**Shared-lib helpers (MB2 E7 / MB3 remainder) — closed where a
converted surface consumed them:**
- `app/track/[orgSlug]/page.tsx`: courier stepper now uses
  `courierStepLabels(locale)` (it already resolved the shop locale
  but rendered the bn-only constant).
- Dashboard bookings / services / live-commerce pages: raw
  `fmtMoneyBn` imports replaced by the campaigns-pattern contracts
  shadow with the page locale. **Presentation delta (documented, the
  MB2 campaigns precedent):** whole-taka bn amounts now render
  without the `.০০` fraction (`৳১,৫০০` not `৳১,৫০০.০০`); fractional
  amounts are unchanged.
- `lib/rider-gps.ts`: `fixAgeLabel(ageMs, locale = "bn")` gained an
  en path (bn byte-identical); the dashboard delivery page passes
  its locale. The rider token page stays bn (bn-by-design surface).
- `lib/live-commerce.ts`: `recapRows`, `commentOrderNotice`,
  `followUpSummary` (Worker B) and `sessionStatusChip`,
  `sessionSourceBadge`, `commentsModeNotice` (coordinator, same
  defect class in the same file) all take an optional locale with
  byte-identical bn defaults; the dashboard page passes its locale
  to every call site. The en duplicate-order notice deliberately
  keeps the "This comment" lead so the page's tone check against the
  dictionary value keeps working.
- Already-closed items verified, not re-worked: `courier-status.ts`
  (locale accessor since MB2 F2), `lib/booking.ts` (locale-aware
  via crm accessors), `express-checkout`'s label fn (the wired bn
  fallback behind dictionary-first rendering, pinned by its test).

**MB2's ~140 unreferenced keys — audited and removed.** Method
(MB2's own): literal `ns.key` search + bare-key word-boundary search
over all of `apps/web/src`, corpus excluding only the dictionary
DEFINITION files (16,356 keys audited). 156 candidates; dynamic-
construction review found the typed-key Records and the two
template constructions (`shell.${labelKey}`, `campaignBuilder.${label}`)
assign from literals the audit already counts, and social's
share/overlay/aspect keys have no consumer at all (their labels live
in `lib/social-posts-sn.ts` as D7 pairs). **Removed: 154 keys × 2
locales = 308 entries** (inbox 58, messaging 45, social 14,
commerce 13, common 7, crm 6, ai 3, pos 2, products 2, automations 2,
inventory 1, misc 1). **Kept by the doubt rule:** `orders.save2`,
`orders.loading3` — `ordersBn` is consumed as a whole object by the
reverse value→key map in `lib/courier-analytics.ts`, so no orders
key is provably dead. One catch during the audit: the first run's
corpus wrongly excluded `lib/i18n/provider.tsx` (a consumer) and
produced a false candidate (`shell.languageSwitcherLabel`, live at
provider.tsx:171) — the corpus was fixed and re-run before any
removal; that is exactly why the doubt rule exists. Post-removal
parity battery: 15/15; the full web suite at gate time passes
1,140/1,140 with test counts identical to MB5.

**One honest near-miss, adjudicated NOT a violation:**
`pos/page.tsx`'s `NETWORK_ERROR_MESSAGE` looked like hardcoded error
copy, and its dictionary twin was among the removed dead keys.
Inspection proved it is a message-as-data SENTINEL: `lib/api.ts`
throws exactly this string and the page compares by equality to
detect network failures. The dictionary key was genuinely unused;
the sentinel stays (allowlisted with that reason).

### 2. Enforcement gate — BUILT and plant-proven

- `scripts/i18n-scan.mjs` now exports its scanning core (one
  implementation for scan + gate; baseline output unchanged) and
  its dictionary homes gained `apps/api/src/i18n/` — the MB4 API
  catalog is a dictionary home the MB1 scanner predates.
- `scripts/i18n-gate.mjs` (+ `pnpm i18n:gate`): scans all three
  surfaces and FAILS on (a) any finding in a file with no allowlist
  entry, (b) growth beyond a file's pinned caps, (c) a stale entry
  whose file is gone. Passes on the final tree.
- `scripts/i18n-gate-allowlist.json`: **541 entries**, each with
  path + reason + pinned caps (bengali/english/localeCalls).
  Reasons are grounded in the batches' own classifications (MB2
  E1–E12, MB3 exceptions, MB4 categories (a)/(a2)/(d), MB5
  exceptions) plus MB6 spot-checks (pos sentinel, CSV-export date
  cell, en-CA date key, district-name data values). 65 web files
  were verified to carry ONLY English-heuristic hits (bn = 0,
  localeCalls = 0) before receiving the noise-class reason.
- **Plant proof (recorded in the batch record):** a planted file
  with a bn literal + `toLocaleString` → gate FAIL
  [not-allowlisted], exit 1; a planted bn literal appended to
  allowlisted `lib/money-bn.ts` → FAIL [cap-exceeded], exit 1;
  plants removed → PASS, exit 0.

### 3. QA checklist — PREPARED, all unchecked

`docs/multi-language-live-qa-checklist.md`: switch/resolution,
bn-format and en-format spot checks (with the pinned examples),
dashboard surfaces, storefront, notification/document samples, API
+ AI behaviour, and the standing partials listed as
verify-as-documented. **No item is checked; the program makes no
visual or live claim.**

### 4. Program summary — WRITTEN

`docs/multi-language-program-summary.md`: ML1–ML16 audit table,
scanner baseline-vs-final, both migrations, standing partials,
owner-gated remainders, per-batch HEAD chain.

## Standing partials — NOT sweep targets (carried to the summary)

BN PDF EN/ASCII-only · platform blueprint ad text (CA26 pin) · ou7
GL export prose · merchant-authored templates (by decision) ·
abandoned-checkout per-locale (needs template-identity design) ·
BlogPost content translation · category description public overlay
(no payload serves it).

## Gates (final tree, serial, recorded as each finished)

| Gate | Result |
|---|---|
| Contracts tests | ✅ 2 files / 38 tests |
| Web full vitest | ✅ 139 files / 1,140 tests — ALL PASS (counts identical to MB5 close) |
| Admin tests | ✅ 2 files / 18 tests |
| tsc | ✅ 0 errors — contracts, db, api (build config), web, admin (first combined run interrupted by an environment restart; re-run individually, all exit 0) |
| Next builds | ✅ web PASS · admin PASS |
| Prisma validate | ✅ valid (a bare-shell P1012 was only the unset DATABASE_URL env; with a placeholder URL it validates) |
| API jest (chunked C1–C10, JSON-counted) | **637 suites / 7,366 tests — 7,356 pass in-chunk; 10 chunk failures, ALL adjudicated:** the standing date/weekday set (adx3 ×1, ads-intelligence ×2, sa-b18 ×2, cc26 ×1, social-sn9 ×2) + 2 documented flakes re-proven non-deterministic this session (ca19 passed on its 3rd run; mx11 passed solo 26/26). Coverage diffed against the 637 spec files on disk — every suite ran exactly once. **Zero failures in MB6-touched code.** |
| Fresh-PG | ✅ **282/282 migrations** on empty PostgreSQL 16 (scratch DB dropped, temp password removed, cluster restored to down) |
| i18n enforcement gate | ✅ PASS on the final tree (plant-proven, above) |
| Scanner (final) | web 2,041 BN / 1,073 EN / 20 lc · admin 0 / 104 / 0 · api 3,734 / 1,566 / 20 · **TOTAL 5,775 / 2,743 / 40** (MB1 baseline 18,124 / 2,764 / 618) |

## NOT BUILT / partial (explicit, this batch)

- **Screenshot/visual QA: NOT DONE** — impossible in this
  environment; the shipped checklist is the owner's post-deploy
  instrument. No visual claim is made for MB6 or the program.
- **Live verification: NONE** — nothing in MB6 (or the program) is
  verified against a running deployment; M30-style live checks
  remain owner-gated.
- The standing partials listed above remain partial **by decision
  or by missing design**, each with its reason in the program
  summary — none was silently dropped, and none is closable by
  string-moving alone.
- `orders.save2` / `orders.loading3` deliberately kept in the
  dictionary (whole-namespace dynamic consumption) — documented
  above, not an oversight.
