# AD4 — Account-Level Spend Watchdog · Acceptance

**Package:** Advertising Accounts, Batch 2 (AD4). **Migration:** `20261010880000_ad4_spend_watch` (additive: `AdAccount.spendWatchEnabled Boolean NOT NULL DEFAULT false`, `dailyCapMinor BigInt?`, `anomalyPct Int?`).

## Alerting only — no enforcement

The watchdog **only sends notifications**. There is no platform kill switch held at account level, and v1 deliberately builds no pause/stop enforcement. The settings UI, the job template description, and every alert text state this explicitly ("এটি শুধু সতর্কবার্তা — কোনো Campaign স্বয়ংক্রিয়ভাবে বন্ধ বা Pause করা হয়নি").

## Settings

- `PATCH organizations/:id/ad-accounts/:accountId/spend-watch` (OWNER/ADMIN): `{ enabled?, dailyCap?: string | null, anomalyPct?: number | null }`. `dailyCap` is a decimal string in the account's own currency, parsed via the shared `parseMoneyToMinor`; must be > 0; null clears. `anomalyPct` must be an integer 1..1000; null = anomaly alert off. Audited as `ad_account.spend_watch_update`.
- `GET organizations/:id/ad-accounts/:accountId/spend-watch`: the **live computation from the same shared function the job uses** (`apps/api/src/ads/spend-watch.ts#computeSpendWatch`) — UI and alerts can never drift.
- Because `dailyCapMinor` is a BigInt, every HTTP-facing account return now passes through a serializer that emits it as a string (listAccounts, createAccount, disconnect, all three connect responses); a spec proves the JSON carries `"dailyCapMinor":"500050"`.

## Watchdog math (as implemented, verbatim rules)

- Source: `DailyAdMetric`, **campaign-level rows only** (`adExternalId === ""`; ad-level rows would double count), **the account's own currency only** (no FX exists in the product; currencies are never mixed).
- **Today** = the Asia/Dhaka calendar day (`dhakaDayKey`); today's metric is **partial** (syncs land through the day) — alerts always say "আজকের খরচ এখন পর্যন্ত (সর্বশেষ Sync পর্যন্ত)".
- **Average basis**: the trailing **7 complete Dhaka days** before today. A day counts toward the basis only if the account already existed on that day (account creation Dhaka day ≤ that day); days inside the basis with no synced data count as 0 spend. The number of days actually used is returned as `avgDaysUsed` (0..7) and **stated in every anomaly alert** as the basis:
  - 7 days: `গত ৭টি সম্পূর্ণ দিনের গড়`
  - 1–6 days: `শেষ Nটি সম্পূর্ণ দিনের গড় (Account তৈরি হওয়ার পর থেকে — পুরো ৭ দিনের ইতিহাস এখনো নেই)`
  - 0 days: no anomaly can fire.
- **Cap alert** fires when `todaySpend >= dailyCapMinor`.
- **Anomaly alert** fires only when `anomalyPct` is set AND `avgDaysUsed > 0` AND trailing sum > 0 AND — exact BigInt cross-multiplication, no float rounding at the boundary —
  `todaySpend × avgDaysUsed × 100 >= trailingSum × (100 + anomalyPct)`.
  (The threshold shown in the alert text is the same value rounded to the nearest minor unit for display; the trigger itself is exact.)

## Job + notifications

- New automation job type **`ad_spend_watchdog`**: registered in `JOB_TYPES`, dispatched in `executeJob` to `AdsService.runSpendWatchdog(orgId)` (honest "Ads service is not available" failure when unbound), offered in the Automations job form (org target), and installed from the A4 template gallery (`ad_spend_watchdog`, hourly) — the template description also states alert-only.
- Alerts: `AgentNotification` type **`ad_account_spend_alert`** to ACTIVE OWNER/ADMIN members; dedupe **per account per Dhaka day per alert kind** via AuditLog markers (`ad_account.spend_cap_notified` / `ad_account.spend_anomaly_notified`); fully failure-isolated per account (one bad account never blocks the rest); the job returns `{ checked, capAlerts, anomalyAlerts }`.
- Alert text carries the real computed figures (taka-formatted via `formatMinor`): today's spend so far, the cap, or the average + its stated basis + the % threshold — never invented numbers.

## Web

Per-account Spend Watch section on the Ad Accounts page: enable toggle (saves immediately), daily cap (taka) + anomaly % inputs, save button, and the live line — today's spend so far, the average with its basis sentence, the cap, and cap/anomaly flags — loaded from the same `GET .../spend-watch` computation.

## Evidence

- **Specs** (`apps/api/src/ads/ad4-spend-watchdog.spec.ts`, 19 tests): full/partial/zero basis math; exact BigInt anomaly boundary (19999 no / 20000 yes at avg 10000, +100%); created-today account (anomaly impossible, cap fires); zero-spend history (anomaly impossible); ad-level + foreign-currency rows excluded; cap at exactly the threshold; watchdog fires both kinds once with real figures to ACTIVE OWNER/ADMIN only, second same-day run fires nothing; dedupe independent per kind; disabled accounts skipped; foreign-org accounts never computed; PATCH store/clear/validation matrix (bad money string, cap 0, pct 0/1001/2.5); foreign account 404 on GET + PATCH; BigInt serialization; job registration + template integrity + executeJob dispatch + honest unavailability.
- **Gates**: full API suite **1102/1102 (146 suites)**, web tests **39/39**, API + web `tsc` clean, monorepo `pnpm -r build` green.
- **Live evidence — NOT available this session (stated ceiling)**: same sandbox Postgres outage as AD1/AD2/AD3 — no Postgres binary exists in this VM, so no live HTTP run and no `migrate deploy` were possible. Nothing here claims otherwise: the watchdog is proven against the computation's real code paths with in-memory fixtures, and the migration is a schema-level artifact awaiting the next deploy's `prisma migrate deploy`.
