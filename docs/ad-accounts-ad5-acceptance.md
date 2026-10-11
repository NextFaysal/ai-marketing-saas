# AD5 — Meta Discover → Picker Connect + Per-Account Sync Disable: Acceptance

**Scope:** Plan `docs/ad-accounts-package-plan.md` (F5/F6). Meta connect stops silently
connecting every account under a token (two-step discover → picker), and a single ad
account's data sync can be switched off without disconnecting its integration.

## What shipped

### 1. Discover (picker step 1) — `POST organizations/:id/integrations/meta/discover` (OWNER/ADMIN)

- Body `{ accessToken }`. The token is verified **exactly like connect** (`MetaClient.verifyToken`);
  an invalid token returns Meta's verbatim error as `Meta token verification failed: …` (400) and a
  listing failure returns `Could not list Meta ad accounts: …` (400).
- The endpoint is **side-effect free**: no Integration is created, no credential is written, no
  AdAccount is upserted, no audit row is made. The token is never persisted, never logged, and
  never echoed — the response is built field-by-field from the discovery result only (spec-asserted:
  the token string and any `accessToken` key are absent from the payload).
- Response: `{ accounts: [{ externalId, name, currency, platformStatusRaw, platformStatusBucket,
  timezone, alreadyConnected, accountId }] }` — the status bucket reuses AD3's `metaStatusInfo`
  mapping on the already-parsed `account_status` verbatim.
- **`alreadyConnected` semantics (deliberately simple, as specced):** an API-sourced (`sourceType =
  "api"`) AdAccount row with that externalId exists in **this** organization. The row may currently
  be disconnected (AD2 leaves `sourceType = "api"` after a disconnect) — reconnecting revives the
  same row, so the picker pre-checks these and labels them “আগে থেকেই কানেক্টেড”. A same-externalId
  row in another org, or a csv/manual row, does **not** count.

### 2. Connect selected (picker step 2) — existing `POST integrations/meta/connect`

The web form now runs: token → “🔍 অ্যাকাউন্ট খুঁজুন” → checkbox list (name, currency, timezone,
AD3 status badge, already-connected accounts pre-checked + labelled) → “নির্বাচিতগুলো কানেক্ট করুন”
submits the existing `connectMeta` with `adAccountExternalIds` = the selection. Editing the token
clears a stale discovery list.

Server-side selection semantics (audited + fixed):

- Field **absent** → legacy behaviour (connect everything the token can see).
- Field **present but empty** → **400** “কোনো Ad Account নির্বাচন করা হয়নি — অন্তত একটি Account বেছে নিন।”
  (Before AD5 an empty array silently behaved like "absent" and connected **all** accounts — the
  picker made that footgun reachable, so it is now an error.)
- Field present, matches nothing under the token → **400** “নির্বাচিত Ad Accountগুলো এই Token-এর
  অধীনে পাওয়া যায়নি …”, nothing created.
- **Partial selection + AD2 interplay (spec-proven):** only selected accounts are upserted/repointed
  to the new integration; an unselected account keeps its row, its old integration (still
  CONNECTED) and its credential — the AD2 hygiene supersedes only integrations that **zero**
  accounts reference after the upserts, so nothing unselected is disturbed.

### 3. Per-account sync disable — migration `20261010890000_ad5_sync_disabled`

- `AdAccount.syncDisabled Boolean @default(false)` (one additive column; Prisma client regenerated).
- `PATCH organizations/:id/ad-accounts/:accountId/sync` (OWNER/ADMIN/MARKETING_MANAGER) with
  `{ syncDisabled }`; audited as `ad_account.settings_update` (metadata carries the flag only).
  Foreign-org account → 404 via the existing `getAccount` discipline.
- **Gate coverage** — when the flag is set, every platform-data sync path for the account stops
  with the same Bengali 400 (“এই Ad Account-এর Sync বন্ধ রাখা হয়েছে (Sync Disabled) …”) **before
  any platform call**:
  - Manual: `sync/meta-insights`, `sync/meta-ad-insights`, `sync/meta-breakdowns` (gate in the
    shared `metaClientFor` loader + insights), `sync/google-insights`, `sync/tiktok-insights`.
  - `refresh-status` (AD3): it is a platform-data fetch + write, so it honours the flag too; as a
    local precondition it does **not** mark the integration ERROR (spec-asserted).
  - Scheduled jobs: `AutomationService.executeJob` now dispatches the three insights job types
    through `AdsService.syncInsightsJob`, which returns `{ skipped: true, reason: "sync_disabled",
    accountId, platform }` for a disabled account — the skip becomes the job run's recorded result
    instead of a job failure; enabled accounts run the exact manual sync path.
- **Publishing is NOT blocked** by `syncDisabled`: no publishing path consults the flag (the card's
  helper text says this verbatim).
- **Health (AD1 extension):** a sync-disabled api account reports the distinct band
  `sync_disabled` (web badge “Sync বন্ধ”) instead of decaying to `stale` — no sync is expected to
  run. The AD1 connection block (status/lastSyncAt/lastError) is still returned unchanged, and the
  flag on a non-api (manual/csv) account does not alter its `manual` health. On the card, the sync
  and status-refresh buttons are hidden while disabled, with an explanatory note; disconnect stays
  available.

## Evidence

- New spec `apps/api/src/ads/ad5-picker-sync-disable.spec.ts` — **12 tests**: discover bad-token /
  list-failure boundaries with zero writes; bucket + alreadyConnected matrix (incl. disconnected
  api row = already known, csv twin ≠, other-org row ≠) + token absence from the payload; empty
  selection 400; selection-miss 400; partial-selection AD2 interplay (unselected integration +
  credential untouched, no supersede audit); PATCH flip + audit + cross-org 404; the full manual
  gate matrix with platform-client spies **not called**; refresh refusal leaves integration
  CONNECTED; google re-enable path syncs again; `syncInsightsJob` skip marker vs delegation;
  health band matrix.
- Full API suite: **1114/1114 pass (147 suites)** — including the automation spec whose ads stub
  gained the `syncInsightsJob` dispatch (its google failure-path test semantics preserved).
- Web tests + monorepo build: see the batch report (gate run after this doc's commit prep).

## Honest limits

- **No live HTTP run**: the sandbox has no Postgres (binaries absent — the same ceiling recorded
  for AD1–AD4). Evidence is specs (with labelled `MetaClient`/`GoogleAdsClient`/`TikTokAdsClient`
  prototype fixtures) + the full suite + build. Discover against a real Meta token and the picker
  click-through remain for the owner's M30 live-verification sprint.
- The migration is committed but not applied to any live database from here; it applies via
  `prisma migrate deploy` on the owner's server, like AD3/AD4.
