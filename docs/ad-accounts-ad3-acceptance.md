# AD3 — Platform Account Status + Timezone · Acceptance

**Package:** Advertising Accounts, Batch 2 (AD3). **Migration:** `20261010870000_ad3_platform_status` (additive, 4 nullable columns on `AdAccount`: `platformStatusRaw`, `platformStatusBucket`, `timezone`, `platformStatusCheckedAt`).

> **Deviation from the plan doc (noted deliberately):** `docs/ad-accounts-package-plan.md` sketched a single `platformStatus String?` column (+ `platformStatusAt`). The Batch 2 brief refined this to keep BOTH the platform's verbatim value and a normalized bucket — implemented as `platformStatusRaw` + `platformStatusBucket` (+ `platformStatusCheckedAt`) — so no platform information is lost in normalization and the UI can show the raw value. The brief's design governs; the plan doc's sketch is superseded on this point.

## Per-platform status availability verdict (adapter audit)

| Platform | Status source (genuine) | Timezone source (genuine) | Verdict |
|---|---|---|---|
| Meta | `account_status` on `/me/adaccounts` — the client already requested and parsed it; connect discarded it | `timezone_name` on the same ad-account payload (added to the requested fields) | ✅ captured |
| Google | `status` (CustomerStatus) on the customer resource that `verifyCustomer` already GETs — it just wasn't parsed | `timeZone` on the same resource | ✅ captured |
| TikTok | `status` on `advertiser/info` (added to the requested fields list) | `timezone` on the same response (added to the fields list) | ✅ captured |

No platform needed a "not reported" fallback in practice, but the code path exists everywhere: when a response carries **no** status, `platformStatusRaw`/`platformStatusBucket` are written as null at connect and left **untouched** at refresh (absence never erases a known status, and never invents "active"). The UI renders a null bucket as **"প্ল্যাটফর্ম জানায়নি"**.

## Status mapping table (stored verbatim + bucket)

Meta (`account_status`, documented codes) — raw stored as the code's string:

| Raw | Bucket | | Raw | Bucket |
|---|---|---|---|---|
| 1 (ACTIVE) | active | | 8 (PENDING_SETTLEMENT) | restricted |
| 2 (DISABLED) | disabled | | 9 (IN_GRACE_PERIOD) | restricted |
| 101 (CLOSED) | disabled | | 100 (PENDING_CLOSURE) | restricted |
| 3 (UNSETTLED) | restricted | | anything else | unknown |
| 7 (PENDING_RISK_REVIEW) | restricted | | | |

Google (`customer.status`): ENABLED → active · SUSPENDED → restricted · CANCELED / CLOSED → disabled · anything else returned → unknown · absent → null.
TikTok (`advertiser.status`): STATUS_ENABLE → active · STATUS_DISABLE → disabled · STATUS_PENDING_* / STATUS_CONFIRM_* / STATUS_LIMIT* → restricted · anything else → unknown · absent → null.

## Behaviour

- **Connect-time capture** in all three connect flows: discovery/verify payload values are upserted with the account (create + update), `platformStatusCheckedAt` stamped; the previous bucket is read before the upsert so a (re)connect that discovers `disabled`/`restricted` fires the transition notification.
- **Refresh**: `POST organizations/:id/ad-accounts/:accountId/refresh-status` (OWNER/ADMIN/MARKETING_MANAGER, `@PermissionArea("ads")`). Uses the **stored** credential server-side only; updates raw/bucket/timezone/checkedAt; audits `ad_account.platform_status_refresh` with `{ platform, raw, bucket, previousBucket, timezone }`; response returns the persisted fields + `previousBucket`.
- **Notification**: transition INTO `disabled` or `restricted` (previous bucket ≠ new bucket) notifies ACTIVE OWNER/ADMIN, type `ad_account_platform_status`, at most once per account per Asia/Dhaka day via AuditLog marker `ad_account.platform_status_notified` (AD1 discipline), fully failure-isolated.
- **Refresh failure semantics (decided)**: a platform-CALL failure (token rejected, API error) goes through AD1's `markSyncFailure` — integration flips CONNECTED→ERROR with the verbatim error, and the AD1 transition notification may fire. Local preconditions surface as honest 400s **without** health marking: no credential ("credentials are missing; reconnect"), CSV/manual account (no API connection), Meta account no longer visible to the token. A successful refresh does **not** clear an existing sync ERROR — health is about syncs; the next successful sync clears it.
- **Timezone is informational in v1**: stored + displayed next to currency with the last-checked time. No scheduling/sync semantics were changed (insights date windows remain platform-side), deliberately — no silent behaviour change.
- **Serializer**: `listAccounts` carries the new fields via the account row; the AD1 recursive key-scan spec is extended in the AD3 spec — no credential/token/secret-shaped keys, and the stored token value never appears in the JSON.

## Evidence

- **Specs** (`apps/api/src/ads/ad3-platform-status.spec.ts`, 16 tests): bucket mapping matrices per platform; client parsing with labelled fetch fixtures (Meta `timezone_name`, Google `status`/`timeZone`, TikTok `status`/`timezone`); connect-time capture for all three platforms incl. notification on discovery of a bad status; refresh persistence + audit + single transition notification + no re-notify without transition; AuditLog-marker daily dedupe; no-status response leaves stored status untouched while stamping checkedAt; platform-call failure → integration ERROR + verbatim error surfaced; account-gone → 400 without marking; manual account → 400; foreign account → 404; serializer key-scan.
- **Gates**: full API suite **1083/1083 (145 suites)**, web tests **39/39**, API + web `tsc` clean, monorepo `pnpm -r build` green.
- **Live evidence — NOT available this session (stated ceiling)**: the sandbox Postgres is down and no Postgres binary exists in this VM (same outage class as AD1/AD2, whose acceptance docs state the same). No live HTTP claim is made; the migration was generated/applied only at the Prisma schema level (`prisma generate` + `validate` run; `migrate deploy` could not run without a database). Platform calls are proven to the client-parsing boundary with labelled fixtures, per the package rule — no platform response is fabricated as success.
