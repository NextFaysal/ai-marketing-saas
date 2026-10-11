# AD6 — Bulk Sync-All + Account Labels / Search / Filter: Acceptance

**Scope:** Plan `docs/ad-accounts-package-plan.md` (F7/F8). One click syncs every connected
account (with honest per-account results), accounts get tenant-chosen labels, and the account
list becomes searchable/filterable.

## What shipped

### 1. Bulk sync-all — `POST organizations/:id/ad-accounts/sync-all` (OWNER/ADMIN/MARKETING_MANAGER)

- For every account of the org (creation order) it runs **the same per-account campaign-insights
  sync the card's primary Sync button runs** — Meta `syncMetaInsights`, Google
  `syncGoogleInsights`, TikTok `syncTikTokInsights` (30-day default window). No parallel
  implementation was built. The Meta ad-level and breakdown syncs deliberately stay per-account:
  they are heavier secondary views, and the card's primary Sync button is the parity target.
- **Sequential execution, on purpose (platform politeness):** each account's sync is awaited
  before the next account starts — a bulk click never hammers Meta/Google/TikTok in parallel.
  (Spec-asserted: platform calls happen strictly in account order.)
- Per-account result: `{ accountId, status, error? }` with
  - `success` — the sync completed;
  - `failed` — the sync threw; `error` carries its verbatim message. **One account's failure
    never fails the batch** — the remaining accounts still run, and the failed account's own
    AD1 bookkeeping (integration ERROR + lastError) still happens inside the sync itself;
  - `skipped_disabled` — the AD5 sync switch is off (checked first so the result names the
    reason; the sync methods would refuse anyway);
  - `skipped_no_connection` — non-api account (manual/csv) or an api row with no integration
    attached (e.g. detached by an AD2 disconnect): nothing can sync.
- Response: `{ total, success, failed, skipped, results }`. The batch is audited **once**
  (`ad_accounts.sync_all`, counts only — no per-account audit spam).
- Web: a “🔄 সব Sync করুন” toolbar button; the result shows “সফল X · ব্যর্থ Y · বাদ Z (মোট Nটি)”
  with the failed accounts' names (label-aware) and verbatim errors in an expandable section.

### 2. Labels — migration `20261010900000_ad6_account_label`

- `AdAccount.label String?` (one additive nullable column).
- Written through the **same AD5 settings endpoint** (`PATCH ad-accounts/:accountId/sync`, now
  also accepting `label`) so there is one audited account-settings surface: free text, trimmed;
  **60-char cap on the trimmed value** (over → Bengali 400, nothing written); `null` or empty
  clears the label back to the platform name. The audit metadata records the resulting
  `{ syncDisabled, label }`.
- Web: the card heading shows the label when set (the platform name stays visible, smaller, in
  parentheses); an inline editor on every card saves/clears it. Search also matches labels.

### 3. Search / filter — client-side, deliberately

- Pure function `filterAdAccounts` (`apps/web/src/lib/ad-account-filters.ts`, unit-tested):
  text query over **name + label + externalId** (case-insensitive substring), platform filter,
  health filter (AD1's computed health, including AD5's `sync_disabled` band), and AD3
  platform-status-bucket filter. Filters combine (AND); the result count is always shown
  (“Nটি Account দেখাচ্ছে (মোট Mটি)”); an empty result shows an honest state that says the
  accounts still exist and only the filter matched nothing.
- **Why client-side:** the list endpoint already returns every field these filters need
  (AD1 connection/health, AD3 status bucket, AD6 label) and the page already fetches the full
  list — a server-side query would duplicate that surface for no behavioural gain at tenant
  scale. This is stated here rather than silently assumed.

## Evidence

- New spec `apps/api/src/ads/ad6-sync-all-labels.spec.ts` — **6 tests**: the full sync-all
  matrix in one org (success / failed-with-verbatim-error / skipped_disabled /
  skipped_no_connection ×2) with sequential call order, post-failure continuation, the failed
  integration's ERROR marking, and exactly one batch audit with the counts; the empty-org
  summary; label trim/store/audit, combined label+syncDisabled PATCH, clear via "" and via
  null, the 60-char boundary (61 → 400 with nothing written, 60 → ok), cross-org 404, and the
  empty-DTO no-write path.
- Web: `ad-account-filters.test.ts` — **4 tests** (no-filter passthrough, text search across
  name/label/externalId incl. Bengali label text, exact platform/health/status matching incl.
  the `sync_disabled` band and null-bucket exclusion, AND-combination).
- Full API suite + web tests + monorepo build: see the batch report (gate run before commit).

## Honest limits

- **No live HTTP run**: the sandbox has no Postgres (binaries absent — the same ceiling
  recorded for AD1–AD5). Evidence is specs (labelled client fixtures) + the full suite +
  build. A real multi-account sync-all against live platform tokens remains for the owner's
  M30 live-verification sprint.
- The migration is committed but not applied to any live database from here; it applies via
  `prisma migrate deploy` on the owner's server, like AD3/AD4/AD5.
