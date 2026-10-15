# Integration-5 Acceptance — Admin Next release track (AN1–AN3) + CC Next line into the live EC Phase-3 line

Date: 2026-10-15. Branch `integration-5`, worktree `~/workspace/ai-marketing-saas-int5`.
Owner-approved program: Admin Next AB1 release track (AN1–AN3). Local only — NOT pushed, NOT deployed.

## Merge parents

| Side | Branch / worktree | HEAD | Content |
|---|---|---|---|
| Ours (base) | `integration-3` (`ai-marketing-saas-int3`) | `a3b62ed` | Live `7443135` content: EC Phase 2+3 + CC1–CC10 |
| Theirs | `cc-next` (`ai-marketing-saas-next`) | `c74150d` | integration-4 (SU+SD + CC Advanced CC11–CC20) + CC Next CC21–CC30 |

Both trees verified clean before merging. Common merge base: `21dec09`
(integration-2). Ahead/behind at merge time: int3 +34 / cc-next +85 from base.
Merge commit: `3705df9`. NOT in scope and NOT merged: orders-next, campaign-next.

## Conflicts (4 files, all resolved as pure union)

1. **`apps/api/src/automation/automation.module.ts`** (1 hunk) — int3 added
   StorefrontModule + InstallmentsModule; cc-next added ConnectionsModule.
   Union: all three imports kept. No cycle: ConnectionsModule imports only
   IntegrationsModule.
2. **`apps/api/src/automation/automation.service.ts`** (3 hunks) — imports,
   job-template names, constructor tail. Union keeps all SIX sweep templates
   and handlers: `wishlist_price_alert_sweep` + `installment_due_sweep` (EC28/
   EC31) and `social_evergreen_sweep` + `social_follower_snapshot` (SU2/SU7) +
   `connection_health_sweep` (CC12) + `wallet_payout_sweep` (CC26); grep
   verifies 3 references each (template + dispatch + handler). Constructor
   order: EC tail params (retention, installments) first, then the cc-next
   tail (socialQueue, socialInsights, connectionMonitor, wallet) — evidence:
   neither side's specs construct AutomationService with tail arguments
   positionally (EC28/EC31 and SU/CC sweep specs test the underlying services
   directly), and Nest injects by type.
3. **`apps/api/src/inventory/inventory.service.ts`** (2 hunks) — int3's
   `emitStockIncreased()` (fires `inventory.stock_increased` for EC28) kept,
   and cc-next's SU5 emit (`social_draft.back_in_stock`, product-level only)
   added alongside it in `adjust()`. Both events fire; neither replaces the
   other. Constructor unchanged (events is the shared 4th param on both lines).
4. **`apps/api/src/products/products.service.ts`** (1 hunk) — both lines claimed
   constructor slot 8 as "LAST param": int3 for `affiliates` (EC32), cc-next
   for `events` (SU5). Resolution by spec evidence: the SU5 spec constructs
   ProductsService positionally with events as the 8th argument, while no EC
   spec passes affiliates positionally (EC32 specs test AffiliatesService
   directly). So `events` keeps slot 8 and `affiliates` is appended at slot 9.
   Nest injects by type, so production wiring is unaffected.

`schema.prisma` and all other shared files auto-merged; verified by the
zero-loss checks below, not assumed.

## AN1–AN3 verification (the Admin Next items this release carries)

- **AN1 LinkedIn config:** `linkedinAppConfig` in `PLATFORM_CONFIG_KEYS`
  (11 keys total), `PATCH /admin/platform-config/linkedin` (SUPER),
  `POST /admin/platform-config/test-linkedin`, LinkedIn Settings card in
  `apps/admin` (the merged admin settings page is identical to the cc-next
  version, which is a superset of the live one).
- **AN2 Wallet statement export:** `GET /admin/wallets/:organizationId/
  statement.csv` and `.pdf` (SUPER|FINANCE) present in admin.controller.ts.
- **AN3 Four-eyes threshold:** `walletConfig.payoutFourEyesThresholdMinor`
  in platform-config snapshot + `effectivePayoutFourEyesThresholdMinor()`,
  Admin Settings wallet card field `pc-wallet-foureyes` present.

## Migration union

- int3: 155 migrations; cc-next: 160; common: 145; **union: 170 folders**.
- int3-only: `20261013510000`–`…600000` (EC25–EC34, 10). cc-next-only:
  `20261013310000`–`…450000` (CC Advanced 5 + CC Next 5 + SU 5 = 15).
  No timestamp-prefix collisions; nothing dropped or renumbered.
- Static cross-check: zero duplicate `CREATE TABLE` / `ADD COLUMN`.
- **Fresh disposable Postgres 16 (initdb in /tmp, port 54329):
  `prisma migrate deploy` from scratch — 170/170 applied, "All migrations
  have been successfully applied", 229 public tables.** Disposable instance
  stopped and discarded afterwards.

## Gates (this tree, this run)

| Gate | Result |
|---|---|
| Prisma validate | valid |
| API jest (maxWorkers=2) | **353/354 suites, 3683/3683 tests PASS** — see OOM note |
| — cc9-tenant-payments solo re-run | 14/14 PASS |
| Web vitest | 345/345 PASS (43 files) |
| tsc api / web / admin | 0 / 0 / 0 (web needs @repo/contracts + @repo/ui built first — done) |
| Admin build | green |
| Monorepo build (`pnpm -r build`) | green — fresh artifacts for api, web, admin, worker, contracts, db |

OOM note (evidence, not a code failure): the first full run used
`jest --runInBand` and died at ~suite 210/354 with a V8 heap OOM in this
8 GB sandbox (the same failure class integration-4 recorded). A second
attempt before `@repo/db` was built failed 312 suites at import with
"Cannot find module '@repo/db'" — a setup omission (db `dist` not built),
fixed by building @repo/db, not a merge defect. In the maxWorkers=2 run the
single failed suite (cc9-tenant-payments) was a jest worker SIGKILL with
**zero failing tests** (3683/3683 passed); solo re-run passes 14/14.

## Zero-loss verification

- **File level:** every file present in either parent tree exists in the
  merged tree — 0 missing vs `a3b62ed`, 0 missing vs `c74150d`.
- **Route level** (controller prefix + method + path tuples): admin 138
  (= union; int3 134, cc-next 138), social 99, connections 84, and the
  **whole API: 1177 routes = exact union** (int3 1061, cc-next 1107) —
  zero missing, zero extra.
- cx3-debounce: did not fail in the full run; no special handling needed.

## Honest limits

- NOT pushed (owner's explicit push instruction still required) and NOT
  deployed; no migration from the cc-next line (310000–450000) or the
  integration itself has run on the real database — the union sequence is
  proven only on a fresh disposable Postgres.
- No live proof for anything in this integration (M30 still owed in full,
  including LinkedIn/Google app approvals, a real platform payment/payout,
  a real gateway refund, real settlement CSVs).
- Per-org job enables from both lines remain owner-owed at deploy
  (`connection_health_sweep`, `wallet_payout_sweep`,
  `social_publish_due`, `social_evergreen_sweep`,
  `social_follower_snapshot`, plus the 7443135 line's four).
- orders-next and campaign-next are NOT in this tree; a release containing
  them needs a further union integration with a fresh full-sequence check.
