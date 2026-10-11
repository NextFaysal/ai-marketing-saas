# Admin Advanced AA5 — Social + Ads Operator Boards: Acceptance

**Status:** Delivered (local only; not committed by this worker, not pushed). Plan: `docs/admin-advanced-plan.md` (AA5; audit findings C5 + C10 + D5).

## Placement decision

- **Dedicated page `/social-ops`** in the admin app (`apps/admin/src/app/social-ops/page.tsx`), nav item **"Social & Ads Ops" 📣** in the operations group of `AdminShell.tsx` (the group containing "Platform Health" / "System & Reliability"). A dedicated page — not a section folded into `/health` or `/system` — because the boards are two full cross-tenant datasets (social accounts + post attention lists, ad accounts + broken list) with their own tables; `/health` stays the integration/sync-job view and `/system` stays the reliability view.
- **Endpoints under the existing system group:** `GET /admin/system/social-board` and `GET /admin/system/ads-board` in `AdminController`. Both are read-only GETs with **no `@AdminTier` decorator**, exactly like their neighbours (`system/queues`, `system/env-check`, `health/integrations`) — the global `SuperAdminGuard` still admits only platform admins; any admin tier may read.

## What changed

- **`apps/api/src/ads/ad-health.ts` (NEW)** — `AD_HEALTH_STALE_MS = 48 * 3600 * 1000` and the pure function `computeAdAccountHealth(account, integration, now)`.
- **`apps/api/src/ads/ads.service.ts`** — `listAccounts()` now derives each account's band by calling `computeAdAccountHealth`; the local `STALE_MS` constant is gone. The connection-block construction and everything else in `listAccounts()` are unchanged (the block is present exactly when the account points at an integration row that exists — including for `sync_disabled` accounts, whose stored `lastError` stays visible, AD5 semantics).
- **`apps/api/src/admin/admin.service.ts`**
  - **D5 fix:** `healthIntegrations()` broken entries now carry `lastError: r.lastError ?? null` and `lastSyncAt: r.lastSyncAt ?? null`. Nothing else in that method changed — previously the broken list showed provider/status/org but never *why* an integration broke, even though the `Integration` row has both fields.
  - **NEW `socialBoard()`** and **NEW `adsBoard()`** (details below). Both follow the file's defensive style (`(this.prisma as any)`, `.catch(() => [])` on the broad fetches).
- **`apps/api/src/admin/admin.controller.ts`** — the two routes above.
- **`apps/admin/src/app/social-ops/page.tsx` (NEW)** + **`apps/admin/src/components/AdminShell.tsx`** nav item.

## Health-band reuse decision

The AD1 health computation previously lived **inline** in `AdsService.listAccounts()` (~48h stale threshold as a local const). AA5 extracts it **verbatim** into the pure function `computeAdAccountHealth` in `apps/api/src/ads/ad-health.ts`, and **both** consumers now call it:

- the tenant-facing `AdsService.listAccounts()` (behaviour identical — all existing ads specs stay green, esp. `ad1-account-health.spec.ts` and `ad5-picker-sync-disable.spec.ts`), and
- the operator-facing `AdminService.adsBoard()`.

There is **no duplicated threshold and no duplicated band logic**: one stale window (48h), one band vocabulary (`sync_disabled` / `disconnected` / `manual` / `error` / `stale` / `connected`), one place to change either. `AdminModule` deliberately does **not** import `AdsModule` / inject `AdsService` — a pure function carries no DI wiring, no module cycle risk, and is directly unit-testable (the AA5 spec exercises every band through it).

Band semantics (unchanged from AD1): `api` + `syncDisabled` → `sync_disabled`; no `integrationId` → `disconnected` (api) / `manual` (csv/manual); dangling `integrationId` → `disconnected`; integration `ERROR` → `error`, `DISCONNECTED` → `disconnected`; `CONNECTED` → `stale` when `lastSyncAt` is null/unparseable/older than 48h, else `connected`; any other integration status → `disconnected`.

## socialBoard() payload

- `socialAccount.findMany({ take: 5000 })` → `accounts: { total, byStatus, byPlatform }` (plain count maps).
- `errorAccounts`: `status === "error"` rows, `updatedAt` desc, **cap 100** → `{ id, organizationId, organizationName, platform, name, username, lastError, updatedAt }` with `lastError` **verbatim**.
- `posts.failed`: `socialPost.findMany({ where: { status: "failed" }, orderBy updatedAt desc, take: 100 })`.
- `posts.sentToCreatorStale`: `status "sent_to_creator"` AND `updatedAt < now − 48h` → `{ count, items }` (count is the full matching total from a `count` query; items capped at 100).
- `posts.stuckPublishing`: `status "publishing"` AND `updatedAt < now − 15min` (the SP5 stale-claim definition) → `{ count, items }`, same rule.
- Every post item: `{ id, organizationId, organizationName, socialAccountId, accountName, platform, status, error, captionExcerpt (caption.slice(0, 80)), scheduledAt, updatedAt }`. Account name/platform resolve from the fetched accounts, with a targeted `findMany` by id for any post whose account fell outside the 5000-cap fetch. Org names resolve with **one** `organization.findMany` over the involved ids (the `healthIntegrations` pattern). Stale/stuck items are additionally re-filtered in memory, so the cutoff definitions hold even if a query layer under-filters.

## adsBoard() payload

- `adAccount.findMany({ take: 5000 })`; referenced integrations fetched with `select { id, status, lastSyncAt, lastError, createdAt }` and the same defensive fallback as `ads.service.ts` (select rejected → plain `findMany` → `[]`).
- Per account, the band comes from `computeAdAccountHealth` → `{ total, byHealth, platformBuckets, syncDisabledCount }`. `platformBuckets` counts `platformStatusBucket` values with **`"none"` for null** (the platform never reported a status — never guessed). `syncDisabledCount` counts the AD5 flag.
- `broken`: band `error` **OR** `platformStatusBucket` in (`disabled`, `restricted`), sorted **error-band first, then `updatedAt` desc**, cap 100 → `{ id, organizationId, organizationName, name, label, displayName: label ?? name, platform, health, platformStatusBucket, lastError (the integration's, verbatim), lastSyncAt (the integration's), updatedAt }`.

## Payload minimality / security

- The credential relation is **never** selected or included anywhere: the ads board mirrors AD1's field-select discipline, and every payload object is built field-by-field — raw rows are never spread into a response.
- Social payloads are safe by construction twice over: SP1 designed `SocialAccount` to never hold credential material, and the board still projects explicit fields only.
- Errors (`lastError`, post `error`) are shown **verbatim** on purpose — they are the operator's actionable signal, and they are platform-generated messages, not secrets. No token/secret value is ever a field of these models' projected shapes.
- The AA5 spec proves this with a **recursive key scan** over all three payloads (`socialBoard`, `adsBoard`, `healthIntegrations`) against poisoned raw rows carrying `credential` / `accessToken` / `clientSecret` / `refreshToken` / `encryptedData`: no key matching `/token|secret|credential|encrypted/i` appears anywhere, and the poison values never appear in the serialized payloads.

## Admin UI

`/social-ops` (AdminShell, `apiFetch`, `acard`/`atable`/`abadge` classes, `bn-BD` dates, org names linking to `/orgs/:id`):

- **📣 Social:** total + by-status / by-platform chips; error-accounts table (Org link, Account + username, Platform, Last Error verbatim, Updated); failed-posts list (org link, account, error, caption excerpt, updated); two compact attention lists with counts — stale `sent_to_creator` ("Creator-এর কাছে পাঠানো, ৪৮ ঘণ্টার বেশি অপেক্ষমাণ") and stuck publishing ("Publishing-এ আটকে আছে (>১৫ মিনিট)").
- **📢 বিজ্ঞাপন অ্যাকাউন্ট:** by-health chips, platform-bucket chips, sync-disabled count; broken table (Org link, Account `displayName` with the platform name underneath when a label is set, Platform, Health, Platform Status, Last Error verbatim, Last Sync).

## Evidence

- New spec `apps/api/src/admin/aa5-ops-boards.spec.ts` — **9 tests, all passing**, fake-prisma style following `admin.spec.ts` / the AA1 spec:
  - pure-function matrix: the 48h constant + every band (sync_disabled, disconnected api, manual csv/manual, dangling integration, error, disconnected, connected, stale by age / null / unparseable `lastSyncAt`, unknown status);
  - (a) D5 regression — broken entry carries `lastError` + `lastSyncAt` verbatim;
  - (b) counts by status/platform + total; error list verbatim `lastError`, org-name resolution, **cap 100 newest-first** over 105 seeded error accounts;
  - (c) a 49h-old `sent_to_creator` included / 1h-old excluded; a 16-min-old `publishing` included / 5-min-old excluded; failed item's caption excerpt is exactly 80 chars of a 120-char caption, with account/platform/org resolved and the error verbatim;
  - (d) adsBoard band counts across fixtures (error integration, CONNECTED + stale sync, sync_disabled, manual no-integration, connected-but-platform-disabled), `platformBuckets` including null → `"none"`, broken ordering (error first), `displayName = label ?? name`, `lastError` verbatim from the integration;
  - (e) the recursive key scan described above;
  - routes carry no `@AdminTier` metadata and the controller delegates to the service.
- **Full API suite: 1484 passed / 182 suites** (baseline after AA4: 1475 / 181; +9 AA5 tests, no regressions — including `ad1-account-health.spec.ts` and `ad5-picker-sync-disable.spec.ts` against the refactored `listAccounts()`).
- **`npx tsc --noEmit -p tsconfig.json` (apps/api): clean.**
- **Admin build: `npx next build` (apps/admin) green** — `/social-ops` route builds at 2.21 kB.

## Evidence ceiling

Specs + full suite + admin build only; the sandbox has no Postgres and no live HTTP was run. No live `GET /admin/system/social-board` / `ads-board` round-trip against real tenant data, and no live browser check of `/social-ops`, was performed — those await the owner's deployed environment (M30 pattern). The board queries are plain Prisma `findMany`/`count` over indexed tenant tables, exercised here through fakes that honour `where` / `orderBy` / `take` / `select`.

## Not in AA5

- No actions on the boards (no retry/reconnect/disconnect from the operator side) — AA5 is visibility only, per the plan; tenant-side flows already own those mutations.
- No change to `healthIntegrations()` beyond the D5 fields, and no change to any SP/AD tenant behaviour.
