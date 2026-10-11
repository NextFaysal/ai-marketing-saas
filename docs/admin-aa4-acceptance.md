# Admin Advanced AA4 — Per-Plan Limit Editor: Acceptance

**Status:** Delivered (local only; not committed by this worker, not pushed). Plan: `docs/admin-advanced-plan.md`.

## What changed

Per-plan limits (`aiDaily`, `broadcastCap`, `seats` for FREE / STARTER / GROWTH / AGENCY) are now operator-editable instead of a hardcoded constant, following the exact `planPrices` pattern:

- **`apps/api/src/common/platform-settings.ts`**
  - New `planLimits(prisma)` helper (exported type `PlanLimits`, constant `PLAN_LIMIT_FIELDS = ["aiDaily","broadcastCap","seats"]`): starts from a **deep copy** of `DEFAULT_PLAN_LIMITS`, then for each tier in `PLAN_TIERS` and each field, overlays the stored `SystemSetting "planLimits"` value only when it is an integer `>= 0`. Defensive via the existing `platformSetting()` guard (missing table / fake prisma → defaults). Invalid stored values (negative, float, string, non-object tier) are ignored on the read path.
  - `effectiveLimits()` now resolves the plan tier through `await planLimits(prisma)` instead of reading `DEFAULT_PLAN_LIMITS[plan]` directly. Resolution order and nullish semantics are unchanged (see below).

- **`apps/api/src/admin/admin.service.ts`**
  - `"planLimits"` added to `AdminService.SETTING_KEYS`.
  - `getSettings()` returns `planLimits` (the **effective merged** map via the helper) **and** `planLimitsStored` (the raw stored object, or `null` when nothing is stored) so the UI can show per-tier source. The generic SETTING_KEYS overlay loop explicitly skips `planLimits` so the raw partial value cannot clobber the merged map.
  - `updateSettings()` validation for `planLimits`: must be a plain (non-array) object, else `400 "planLimits must be an object"`; a non-object tier value → `400 "planLimits.<TIER> must be an object"`; each present field on a known tier must satisfy `Number.isInteger(v) && v >= 0`, else `BadRequestException("planLimits.<TIER>.<field> must be a non-negative integer")`. Unknown tier keys follow the `planPrices` leniency (not rejected; only known tiers are validated / merged).
  - `publicPricing()` now shows merged limits via `planLimits()` instead of the constant.

- **`apps/api/src/admin/admin.controller.ts`**
  - `SettingsDto` gains `planLimits` (`@IsOptional() @IsObject()`) — required because the global `ValidationPipe` uses `whitelist + forbidNonWhitelisted`, so an undeclared field would 400.
  - Dedicated route: `PATCH /admin/settings/plan-limits` with `@AdminTier("SUPER")`, delegating to `updateSettings(actor, { planLimits: body }, ip)` where the request body **is** the limits map itself.
  - **Latent-bug fix:** `SettingsDto` also gains `planYearlyPrices` (`@IsOptional() @IsObject()`), which was previously missing even though the admin UI already saved yearly prices through the generic `PATCH /admin/settings` — under `forbidNonWhitelisted` that field would have been rejected. Same shape as `planPrices`.

- **`apps/api/src/organizations/organizations.service.ts`** — the direct constant readers routed through `planLimits()` (see audit below): `invite()`, `seatGuard()`, `seatUsage()`, and the tenant billing summary's per-plan `limits` (fetched as `mergedPlanLimits` in the existing `Promise.all` alongside `planPrices` / `effectiveLimits`).

- **`apps/admin/src/app/settings/page.tsx`**
  - `Settings` type gains `planLimits` + `planLimitsStored`.
  - New **Plan Limits** section next to the monthly/yearly price editors (same left-hand `acard`): per-tier rows (FREE/STARTER/GROWTH/AGENCY) with three number inputs (`aiDaily`, `broadcastCap`, `seats`, `min=0 step=1`), each tier labelled with a source badge — **"Setting"** (`abadge-green`) if that tier exists in `planLimitsStored`, else **"Default"** (`abadge-amber`). Save PATCHes `/admin/settings` with `{ planLimits: <full edited effective map> }` — storing all tiers explicitly, so after reload the badges reflect stored state.

## Caller audit — who read the constant directly, and who already used effectiveLimits

**All tenant enforcement flows through `effectiveLimits()` — no changes needed there** (they automatically pick up the setting now that `effectiveLimits` itself uses `planLimits()`):

- `apps/api/src/ai/chat.service.ts` — AI daily cap
- `apps/api/src/ai/creative-studio.service.ts` — AI daily cap
- `apps/api/src/inbox/inbox.service.ts` — AI daily cap
- `apps/api/src/automation/automation.service.ts` — limits check
- `apps/api/src/messaging/messaging.service.ts` — broadcast cap
- `apps/api/src/social/social-ai.service.ts` — AI daily cap
- `apps/api/src/social/social-image.service.ts` — AI daily cap
- `apps/api/src/organizations/organizations.service.ts:105` (`getBilling` effective limits) — already via `effectiveLimits`

**Direct `DEFAULT_PLAN_LIMITS` readers found and routed through `planLimits()` (5 sites):**

1. `organizations.service.ts` — `invite()` (~line 70): seat limit for direct invites.
2. `organizations.service.ts` — `seatGuard()` (~line 231): seat limit counting pending email invitations.
3. `organizations.service.ts` — `seatUsage()` (~line 660): Team page seat picture.
4. `organizations.service.ts` — `getBilling()` plans list (~line 166): display of per-plan limits on the tenant billing page.
5. `admin.service.ts` — `publicPricing()` (~line 3097): public pricing display.

After this change, the only remaining references to `DEFAULT_PLAN_LIMITS` outside `platform-settings.ts` itself are none in production code — the constant survives only as the code-default seed inside `planLimits()` and as the `FREE` fallback in `effectiveLimits()`.

Behaviour is identical when no `planLimits` setting exists: the merged map equals the constant, deep-copied.

## Resolution order & 0-semantics

```
org override (Organization.aiDailyLimitOverride / broadcastCapOverride / seatLimit)
  > admin planLimits setting (SystemSetting "planLimits", per tier/field)
  > code default (DEFAULT_PLAN_LIMITS)
  > deployment baseline (env-derived, only where a caller supplies one and the plan value is nullish)
```

All steps use nullish coalescing (`??`), exactly as before: **`0` is a real blocking value at every level** — a setting of `0`, or an org override of `0`, returns `0` (feature blocked), never the next level down. This is proven for both the setting level and the override level in the spec.

## Evidence

- New spec `apps/api/src/admin/aa4-plan-limits.spec.ts` — **15 tests, all passing**, fake-prisma style following `admin.spec.ts` / the AA3 spec pattern:
  - (a) `planLimits()` with no setting → defaults, and the returned map is a deep copy (mutating it does not mutate the constant);
  - (b) partial merge — only `GROWTH.aiDaily` set → other GROWTH fields and all other tiers stay default; (b2) invalid stored values (negative / float / string / non-object tier) ignored on read, valid `0` survives;
  - (c) resolution matrix via `effectiveLimits`: default < setting < org override;
  - (d) `0` in the setting blocks (`aiDaily`/`broadcastCap`/`seats` all return `0`, not baseline); (d2) `0` as org override also blocks;
  - (e) seat path — `OrganizationsService.seatUsage()` honours a setting `seats` value (42 → limit 42, available computed from it), falls back to the code default with no setting, and an org `seatLimit` override still wins over the setting;
  - (f) `updateSettings` validation — negative → 400 with `planLimits.GROWTH.aiDaily must be a non-negative integer`, non-integer `1.5` → 400, non-object / null / array `planLimits` → 400, non-object tier → 400;
  - (g) `updateSettings` accepts `planLimits` (including `0`) and `getSettings()` returns the merged map + the raw `planLimitsStored`; `publicPricing()` shows merged limits; the dedicated route carries `@AdminTier("SUPER")` and `SETTING_KEYS` contains `planLimits`.
- **Full API suite: 1475 passed / 181 suites** (was 1460 / 180 at AA3 close; +15 AA4 tests, no regressions).
- **`npx tsc --noEmit -p tsconfig.json` (apps/api): clean.**
- **Admin build: `npx next build` (apps/admin) succeeds** — `/settings` route builds at 8.68 kB.

## Evidence ceiling

Specs + full suite + admin build only — sandbox has no Postgres, no live HTTP was run. No live `PATCH /admin/settings` round-trip against a real database, and no live tenant enforcement check with a stored `planLimits` row, was performed; those await a deployed environment (M30 pattern).

## Not in AA4

- No per-field source tracking inside a tier: `planLimitsStored` is per-tier presence only (a tier counts as "Setting" if the tier key exists in the stored object, even if only one field was stored) — matching the task spec.
- No UI for clearing `planLimits` back to pure code defaults (saving the full map stores all tiers explicitly, by design in the task spec).
- No changes to org-level overrides (`updateOrgLimits`) — they already existed and already outrank the plan level.
