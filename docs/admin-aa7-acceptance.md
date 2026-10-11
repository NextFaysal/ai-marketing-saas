# AA7 — Plan-Scoped Flag Defaults + AI Usage Drill-Down + Admins Roster: Acceptance

Admin Advanced Package, Batch 3 (FINAL). Audit refs: plan C11 (plan-scoped
flag defaults), C12 (AI usage drill-down), C13 (dedicated admins page).

## 1. Plan-scoped feature-flag defaults (C11)

**Resolver** (`apps/api/src/common/feature-flags.ts`): `orgFlagEnabled`
gained a middle layer, additively — its signature and every caller
(inbox `order_bot`, automation `dayparting`, creatives `creative_library`,
offline-conversions, portfolio `portfolio`/`agency_portfolio`) are
unchanged. Resolution order is now:

1. explicit org row (`OrgFeatureFlag`) — always wins, exactly as before;
2. plan default for the org's **current** subscription tier, from the new
   `planFlagDefaults` SystemSetting;
3. ON (the pre-AA7 fall-through).

Mechanics:

- The setting is **sparse**: `{ [flagKey]: { [tier]: boolean } }` with only
  explicitly-set entries. The reader (`planFlagDefaults(prisma)`, next to
  the resolver) sanitizes: unknown flag keys, unknown tiers and
  non-boolean values in stored data are ignored — `KNOWN_FLAG_KEYS`
  (the six flags) is the allowlist, and `AdminService.KNOWN_FLAGS` now
  derives from it so console and resolver can never drift apart.
- The tier comes from the existing `orgPlan()` helper (latest
  subscription), read **live** — so changing an org's plan changes its
  flag defaults. The tier lookup only runs when a default for the flag
  exists at all, so flag checks with no operator defaults keep their old
  cost. Everything stays defensive: any lookup failure still resolves ON,
  so a flag check can never take a production flow down.
- Unknown flag keys are never plan-gated (an explicit org row still
  decides them, as before).

**Write path**: `PATCH /admin/settings/plan-flag-defaults` (SUPER),
funnelling into `updateSettings` like AA4's plan-limits route.
`planFlagDefaults` is a new `SETTING_KEYS` member with strict validation:
unknown flag → 400, unknown tier → 400, non-boolean → 400, non-object →
400. Saving `{}` clears all defaults. Writes are audited via the existing
`settings_updated` admin audit entry. `GET /admin/settings` returns the
sanitized sparse map as `planFlagDefaults`.

**UI**: /settings gains a "Plan Feature Defaults" matrix card (flags ×
tiers, tri-state per cell: Default (ON) / ON / OFF) next to the Plan
Limits card. The helper text states the consequence plainly: an org's
plan change changes its defaults, and a per-org flag set on the org page
always outranks the plan default.

## 2. AI usage drill-down (C12)

**Endpoints**:

- `GET /admin/usage/ai-detail?days=30&organizationId=` — window defaults
  to 30 days, clamps to 1–90. Rows are built from the real
  `AIUsageRecord` columns: `{ organizationId, orgName, feature, calls,
  inputTokens, outputTokens, totalTokens, estimatedCalls }`, sorted by
  total tokens desc (calls as tiebreak), capped at 200 rows with
  `totalRows` reporting the uncapped count. Features are grouped by
  whatever values exist in the data (chat, creative_studio, social_copy,
  social_image, …) — no fixed list is imposed.
- `estimatedCalls` counts records with `AIUsageRecord.estimated = true`
  (dev-adapter estimates) separately, so estimated and measured usage
  are never silently blended. It comes from a second grouped pass over
  the estimated subset; if that pass is unavailable the split stays 0
  rather than being folded into real calls.
- Aggregation prefers DB-side `groupBy` (the AA6 pattern, including the
  `_count` shape tolerance); delegates without `groupBy` fall back to a
  findMany capped at 20,000 records summed in JS.
- `GET /admin/usage/ai-detail/export.csv` — same window/filter, same
  200-row cap, billing-export header pattern.

**No money here, deliberately**: tokens and calls only. Costs stay on
the Analytics AI-cost board, where the operator sets per-model rates —
a second price source in this view could diverge from it. Both the API
comment header in the CSV and the UI copy say so.

**UI**: /usage gains an "AI by Feature" section — window select
(7/30/90 days), an org filter input (narrows loaded rows by name or id;
when the input is an exact organizationId the CSV export is scoped to
that org as well), the table (estimated calls shown as an amber badge
when > 0), and the export button.

## 3. Admins roster (C13)

**Endpoint**: `GET /admin/security/admins` → `adminsRoster()`. It
assembles the same population `securityOverview()` already lists
(grant sets `isSuperAdmin` + `adminTier` together and the guard
requires the flag), extended additively with `createdAt`. Each row:
`{ id, name, email, tier, status, totpEnrolled, lastLoginAt, createdAt }`.

- Legacy admins (flag set, `adminTier` null) are reported as tier
  **SUPER** — that is the tier the M28 mutation gate and the last-SUPER
  revocation protection already assume for them; a blank would mislead.
- `totpEnrolled` is a boolean derived from `totpEnabled`. The TOTP
  secret column is never selected (spec-proven: the payload contains no
  secret material even when the underlying rows carry it).

**UI**: new `/admins` page + "Admins" nav entry after Security. A
summary banner names any ACTIVE SUPER admins without TOTP; their rows
are highlighted with a red badge — operationally important because a
SUPER without TOTP can read but cannot mutate (M28 gate). The roster is
read-only by design: rows link to the user detail page, where
grant/revoke already lives — no mutation controls were duplicated.

## Evidence — ceiling stated plainly

Specs + full suite + builds only. The sandbox has **no Postgres**, so
nothing here was exercised over live HTTP; the groupBy path is proven
against a faithful fake, the findMany fallback against the same fixture
(both give identical numbers in the spec). Totals:

- API: **184/184 suites, 1521/1521 tests pass** (AA6 baseline 183/1501;
  AA7 adds one suite, 20 tests — resolver matrix incl. tier-change and
  unknown-key cases, sanitizer, write validation + settings round-trip,
  controller SUPER-gate metadata, drill-down groupBy + fallback + CSV,
  roster mapping + secret scan).
- Existing flag-consumer suites (portfolio, creatives,
  offline-conversions, automation, inbox) and all admin suites pass
  with **no assertion changes** — the only spec correction in this batch
  is inside the new AA7 spec itself (the audit action is
  `admin.settings_updated`, matching logAdmin's existing prefix).
- API `tsc --noEmit` clean; admin `tsc --noEmit` clean; admin
  `next build` green with the new `/admins` route.

No migration was needed (OrgFeatureFlag, SystemSetting, AIUsageRecord
and the user admin fields all pre-existed). Nothing was pushed to
GitHub.
