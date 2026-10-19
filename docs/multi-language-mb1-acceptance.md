# Multi-Language MB1 — Acceptance (ML1 + ML2 + ML3)

**Batch:** MB1 (Foundation) of the Multi-Language (i18n) program
**Plan:** `~/workspace/goals/ai-marketing-saas-platform-build/files/Multi-Language-Master-Plan-2026-10-19.md` §৩/§৪ (format specs), §৬ (MB1 = ML1+ML2+ML3)
**Worktree:** `~/workspace/ai-marketing-saas-i18n` · **Branch:** `multi-language` · **Base:** 72583f23
**Local commits only — NOT pushed** (owner's push rule; a push happens only on his explicit in-the-moment instruction)

## Commits

| Item | Commit | Subject |
|---|---|---|
| ML1 | `d10c5090` | feat(i18n): ML1 — locale core, migration, API, provider/switcher, settings |
| ML2 | `49a4eaa3` | feat(i18n): ML2 — single format module (BN/EN specs) + BN font application |
| ML3 | `a3a3c1e8` | feat(i18n): ML3 — dictionary infra completion, glossary v1, scanner + baseline |
| ML3 fix | `3a772b20` | fix(i18n): ML3 scanner — exclude the admin dictionary file from findings |
| Docs | (this doc's commit) | docs(i18n): MB1 acceptance |

Shared files (contracts `index.ts`, web `lib/i18n/index.ts`) had their
re-export lines staged stepwise across the three commits so every
commit's tree is self-consistent.

## Parallel structure (owner directive 2026-10-19)

Coding fanned out to three workers with disjoint file ownership —
W1: db+api · W2: packages/contracts · W3: web+admin — plus the
coordinator's own scanner. Heavy gates ran SERIALLY by the
coordinator only (see gate table); workers ran targeted light tests
only.

## ML1 — Locale core ✅

- **Types + resolution** (`@repo/contracts` `i18n.ts`): `UiLocale = "bn" | "en"`,
  `PLATFORM_DEFAULT_LOCALE = "bn"`, `resolveUiLocale({ userPref, orgDefault })`
  implements staff-pref → org default → platform bn; invalid values are
  skipped per level, never treated as final.
- **Migration** `20261120000000_ml1_locale_fields` (additive only):
  `User.preferredLocale TEXT` (null = follow org) +
  `Organization.dashboardLocale TEXT NOT NULL DEFAULT 'bn'`.
  `StorefrontSetting.locale` (shop) deliberately untouched — shop and
  dashboard languages stay separate choices.
- **API**: `GET /auth/me` now returns `preferredLocale`;
  `PATCH /auth/me/preferences` { preferredLocale: "bn" | "en" | null }
  (omitted = no change, null = clear, anything else = 400, nothing stored);
  `PATCH /organizations/:organizationId/locale` (TenantGuard + RolesGuard
  OWNER/ADMIN + service `assertOrgAdmin`, audit action
  `org.dashboard_locale_updated`) returns the org view carrying
  `dashboardLocale`. listMine/getOne needed no change — the field rides
  the existing org view.
- **Web**: `LocaleProvider` (localStorage `uiLocale` cache for first
  paint → server values win), `LanguageSwitcher` in the dashboard
  header next to OrgSwitcher, Organization Settings **Language section**
  (`#hub-language`, sidebar anchor 🌐 ভাষা / Language): personal
  preference (org default / বাংলা / English, saves immediately) + org
  default select (OWNER/ADMIN; a 403 lands on the dict read-only note).
- **Admin**: lean `lib/i18n.ts` (same contracts core), `AdminLocale`
  switcher mounted in `AdminShell`; pref in `admin_ui_locale`
  localStorage + best-effort PATCH to the same `/auth/me/preferences`;
  no stored pref → bn (its standing default; admin root layout
  already hardcodes `lang="bn"`).

## ML2 — Format module + BN font ✅

- **One module** (`@repo/contracts` `i18n-format.ts`): `fmtMoney`,
  `fmtMoneyMinor` (bigint-safe), `fmtNumber`, `fmtDate`, `fmtDateTime`,
  `fmtTime`, `fmtRelative` — Intl-only, consumed via the contracts root.
- **BN spec pinned by tests**: Bengali digits + lakh grouping
  (৳১,০০,০০০), ৳ prefix, Bengali month names, 12-hour with bn
  dayPeriod. Ground truth discovered while pinning: bn-BD's decimal
  separator is `.` and fraction digits localise — 150050 paisa →
  `৳১,৫০০.৫০` (a first draft rendered Latin fraction digits; caught
  and fixed before commit). Negative money: `-৳…` (sign before ৳).
- **EN spec pinned**: Latin digits, en-IN lakh grouping for
  numbers/money (1,00,000), day-first long dates `19 October 2026`
  (rendered by en-IN itself in this Node's full-icu — verified live
  and pinned; no en-GB fallback was needed). Two further ICU
  deviations from the plan's illustrative strings, pinned as the
  observed truth: bn-BD time keeps a Latin AM/PM marker (`২:৩০ PM`,
  not দুপুর) and en-IN time is lowercase (`2:30 pm`).
- **Fonts**: no new font files — Hind Siliguri was already self-hosted
  via Fontsource in BOTH root layouts (web: full subset, all weights;
  admin: Bengali subset). ML2 adds the locale-driven application:
  `[data-locale="bn"]` CSS in both apps' globals.css puts Hind
  Siliguri first with line-height 1.7; `[data-locale="en"]` keeps
  Inter first. The provider/AdminLocale set `<html lang>` +
  `data-locale` from the effective locale.
- **toLocaleString ban**: enforced as a MEASURED baseline in MB1 —
  the ML3 scanner counts direct calls (618 in the baseline); call
  sites migrate batch by batch (MB2–MB4) and the fail-gate is MB6.
  No page was rewritten in MB1.

## ML3 — Dictionary infra + scanner + glossary ✅

- **Unified dictionary home** `apps/web/src/lib/i18n/`: `dict.ts`
  (bn source-of-truth shape, en typed as the same shape;
  namespaces: common / shell / settingsLanguage), `lookup.ts`
  (dotted-key lookup; missing in the active locale → whole-string bn
  fallback + once-per-key `console.warn` — ML-L2/L6), `shop.ts`
  (EC19 shop dictionary folded in as the shop namespace, content
  moved verbatim), `provider.tsx`, `index.ts`.
- **Backward compatibility**: `apps/web/src/lib/shop-i18n.ts` is now
  a deprecated re-export shim — all ~40 shop import sites work
  unchanged; its parity test migrated to `lib/i18n/shop.test.ts`.
- **Parity tests**: dict bn key set === en key set, no empty values;
  shop parity re-pinned from the new home (3 tests).
- **Glossary v1**: 58 fixed terms in contracts (`GLOSSARY` +
  `glossaryTerm`); term choices follow the dominant existing UI
  usage (counts recorded in the file header); human-readable table
  in `docs/i18n-glossary.md`.
- **Scanner**: `scripts/i18n-scan.mjs` (`pnpm i18n:scan`) — counts
  Bengali-script literals, heuristic English-UI literals, and direct
  toLocaleString calls outside dictionary homes. Report-only in MB1.
  Baseline: `docs/i18n-scan-baseline-2026-10-19.md` —
  **18,124 Bengali literals · 2,764 English-UI literals (heuristic
  upper bound) · 618 toLocaleString calls** across 1,240 scanned
  web/admin/api files (final committed tree).
  These are the numbers MB2–MB5 burn down; MB6 adds the gate.

## Gates (all serial, coordinator-run, settled committed tree)

| Gate | Result |
|---|---|
| contracts build (tsc) | ✅ PASS |
| contracts vitest | ✅ 2 files / 38 tests (15 pre-existing + 23 new i18n) |
| web vitest (full) | ✅ 139 files / 1,135 tests |
| admin vitest (full) | ✅ 9 tests |
| api jest — targeted ML1 spec | ✅ 6/6 |
| api jest (full, chunked — see note) | ⚠️ 633 suites / 7,318 tests: 7,311 pass, **7 fail — all base-proven pre-existing** (below) |
| tsc web / api / admin / db | ✅ all zero errors |
| next build web | ✅ PASS (142s) |
| next build admin | ✅ PASS (42s) |
| fresh-PG migrate deploy | ✅ **281/281 migrations** on empty PG16 incl. `20261120000000_ml1_locale_fields`; columns verified; scratch DB dropped, cluster restored to down |

api jest note: the single-process full run OOM-aborted twice on this
7GB box (exit 134), so the suite ran as serial per-directory chunks
with a 4GB heap — same suites, same tests, aggregate reported here.
The 7 failures are all rolling-date/weekday-window fixtures in code
MB1 never touched, each proven on the pristine base 72583f23 with
identical results: `ai/ads-intelligence.spec.ts` ×2 (spend window),
`admin/adx3-nav-counts.spec.ts` ×1 (overdue window),
`social/social-sn9.spec.ts` ×2 (weekly digest window),
`messaging/mx11-intelligence.spec.ts` ×1 (engagement window — flaky:
passed its solo rerun), `connections/cc26-payout-automation.spec.ts`
×1 (Thursday slot-day). Root causes are open pre-existing issues in
those suites, not MB1 regressions; zero failures in any MB1-touched
module (auth / organizations / i18n-ml1 all green).

## NOT BUILT / partial (honest list)

- Dashboard module screens are NOT converted — every existing page
  still renders its hardcoded strings; only the shell switcher, the
  Settings language section, and provider plumbing are localized.
  Conversion is MB2 (ML4–ML6) by plan.
- Admin screens are NOT converted — shell-level wiring only (ML7 is
  MB2). Admin has no existing per-user server pref UI beyond the
  shell switcher.
- API error/notification strings are NOT localized (ML10–ML12, MB4);
  API additions in MB1 return the same message voice as their files.
- Storefront: no changes beyond the shop dictionary's relocation —
  shop rendering behaviour is byte-identical (same dict content).
- Glossary publication in the Admin UI (plan §৯ D6 tail) NOT built.
- Language switch does not live-retranslate already-mounted module
  pages (they hold no dict strings yet); the switcher persists the
  preference and the shell/settings surfaces honour it immediately.
- Org switching re-resolution: the
...[truncated 949 chars]