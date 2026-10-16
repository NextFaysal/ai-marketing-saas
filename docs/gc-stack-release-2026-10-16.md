# GC-Stack Release — 2026-10-16

Owner-authorized release of the full gc line to GitHub main
("Integration + GitHub push করো (gc লাইনের পুরো স্ট্যাক)").

## Composition

- Base: GitHub main `cf3efd5` (R2 Media release), verified by HTTPS
  ls-remote immediately before the integration and again before the push.
- Release parent: `aac0c70` — main + the campaign DX delta
  (`docs/campaign-release-2026-10-16.md`), which was already gated and
  owner-authorized; this release contains it in full.
- Union source: gc line HEAD `841c0bf` (branch `completion`) — the full
  stack EC1–EC34 + Orders Next (ON1–ON12) + Completion GC1–GC23 +
  Advanced AX1–AX27, on top of main's CC-Advanced / CC-Next / SU / SD /
  ADX / R2 / Admin lines.
- Method: because main's lineage is squash releases, the content-true
  3-way base was Integration-3 HEAD `a3b62ed` (verified: its tree differs
  from the Integration-3 release tree `7443135` by exactly one docs
  file). The merge produced **75 conflicted files** (59 content +
  16 add/add), every one resolved as a feature union — no feature was
  deleted from either side. Integration history on branch
  `integration-7` (merge `a0110a5` + three union-fix commits).

## Migration union

- **211 folders** = 194 (main) + 9 GC (`20261013910000`–`20261013990000`)
  + 8 AX (`20261017010000`–`20261017080000`). No migration renumbered,
  dropped, or edited.
- The same-timestamp pair at `20261013930000` (main's
  `cn17_cn18_depth_sharing` vs GC's GB3 folder) coexists — different
  names, no cross-table dependency.
- **Fresh PostgreSQL 16, migrate deploy from empty: 211/211 applied
  clean, 0 failed/rolled back, 315 public tables.**
- Schema↔migration drift (migrate diff): the union's drift set is a
  strict subset of the two parent lines' drift sets — the union
  introduced zero new drift (all items are pre-existing artifacts of
  older hand-written migrations).

## Gates (union tree, all personally run, exit-code checked)

- Prisma validate: OK.
- Fresh-PG full migrate deploy: **211/211 clean** (above).
- API jest (--runInBand, 7 chunks, **479 suites / 5,361 tests**): all
  pass except the single adjudicated pre-existing failure below.
  (Chunks 1–2 were first run before the union fixes; every affected
  suite was re-run green after the fixes.)
- API tsc: **0 errors**. Web tsc: **0 errors**. Admin tsc (full,
  non-incremental): **0 errors**.
- Web vitest: **82 files, 703/703 pass**.
- Full `pnpm -r build`: **7/7 Done** (ui, contracts, db, api, web,
  admin, worker).

## Conflicts of note and how they were resolved

- **schema.prisma** — append-union of 13 hunks (disjoint models/fields
  from both lines). Two stitching defects were caught by prisma
  validate and fixed: duplicated `createdAt/updatedAt/deliveryAttempts`
  in `CourierShipment`, and a missing closing brace on `StoredFile`.
  No duplicate model/enum names; the one main-only index
  (`@@index([organizationId, agentId])`) preserved.
- **inventory.service.ts** — the auto-merge silently duplicated
  `applyRestoreNetting` (gc's 7-param bin-aware copy spliced with
  main's 5-param tail). Caught in resolution review; the region was
  replaced with gc's verbatim version — the only remaining diff vs gc
  is main's SU5 additions.
- **AutomationService job registry** — verified programmatically to be
  the exact set union of both lines' JOB_TYPES / templates / execute
  cases (main's 10 + gc's 11 job types, incl. `order_automation_sweep`,
  `stuck_parcel_sweep`, `loyalty_points_sweep`, `org_backup_sweep`).
- **Positional-constructor interleaves** — both lines append optional
  constructor params and each line's specs construct services
  positionally, so slot order is a contract:
  - `ProductsService`: GC deep slots 10–16 (checkoutGuard, idempotency,
    tenantPayments, loyalty, giftCards, priceLists, catalogSync) keep
    their positions; main's events@8 / blockedPhones@9 preserved; the
    R2 storage trio moved to slots 18–20 and the three R2 spec
    harnesses (rb6b, rm4, rm9) were padded to match.
  - `StorefrontService`: GC slots 12–20 kept; R2 storage moved to
    slot 21; rm9's harness padded.
  - `TenantPaymentsService`: slot 5 is pinned by BOTH lines (CC23
    passes a StepUpService, GC23/AB4 pass the EventsService). The
    constructor now shape-dispatches an events-shaped slot-5 value to
    the bus; Nest's type-based production injection is unchanged.
- **findGatewayRow (CC19 environments)** — an exact-environment match
  is tried first; for LIVE lookups only, a row whose environment was
  never recorded (GC12-era saves; the DB column defaults to `live`)
  still resolves. A sandbox row is never matched by the fallback.
- **publicPaymentOptions** — one union method returning
  `{ online, options }`: GC10 callers (org id) read `online` (incl.
  ShurjoPay/aamarPay), CC19 callers (org slug) read `options`. The
  identifier resolves id→slug with CC19's 404 contract preserved;
  two gc10 exact-shape assertions were updated to the union contract.
- **Digital downloads (AX9 × RB6/RM9)** — the reveal returns AX9
  signed download paths only (no raw or presigned URL ever leaves the
  reveal); the R2 resolution happens at token redemption
  (`digitalDownloadUrl`: R2 key + s3 storage → 300s presigned GET,
  merchant URL as fallback, 302). The reveal now mints a path only
  when the line can actually resolve at download time. rm9's three
  reveal tests were rewritten to this union semantics, verifying the
  presigned target at redemption.
- **admin.controller.ts** — statement helpers (`statementRange`,
  `buildStatementCsv`, `buildStatementPdf`) and `QueueActionDto`,
  lost during conflict resolution, were restored from main.
- **platform-config.ts** — a duplicated snapshot construction was
  dropped, keeping the union version (incl. AB8 `googleOAuth` and
  CC23's wallet four-eyes threshold).
- **Admin/web** — ADX tabbed redesigns kept as shells with GC/AX
  features woven in (PDF invoice button, GC21 verification panel,
  AX24 white-label card, AB8 Google SSO card, GC23 SLA badges);
  orders web page = ON1 command-center monolith + main's Duplicates
  Hub woven in; payment-gateway panel = CC19 multi-environment
  structure with GC12 fee fields + ShurjoPay/aamarPay adapted in.

## Pre-existing failure — disclosed, NOT fixed in this release

- `apps/api/src/connections/cc26-payout-automation.spec.ts` fails
  deterministically: the second payout sweep returns reason
  `below_threshold` where the spec expects
  `already_created_for_slot`. **Reproduced identically on the
  untouched base `aac0c70`** (1 failed / 8 passed, same assertion) —
  it predates this release (also disclosed in the campaign release
  note against `cf3efd5`). It looks like a real payout-sweep logic
  issue on main and needs its own fix; per release discipline it was
  not touched here.

## Deploy notes (owner)

- A Dokploy **Redeploy** is still required; on the real database it
  will run **17 new migrations** (GC 9 + AX 8) — proven 211/211 only
  on a fresh database, never yet on the live, data-bearing DB.
- Per-org job enables owed (platform defaults stay OFF until enabled
  per org): `order_automation_sweep`, `owner_order_digest`,
  `stuck_parcel_sweep`, `scheduled_report_sweep`,
  `webhook_delivery_sweep`, `loyalty_points_sweep`,
  `gift_card_expiry_sweep`, `catalog_sync_sweep`, `web_push_sweep`,
  `data_export_generate`, `org_backup_sweep`.
- Nothing in this release is live-proven: M30 / EC12 live verification
  remains entirely owed. Google SSO ships dark until the OAuth app is
  created; refund push remains default OFF per store; ShurjoPay and
  aamarPay refunds are not built (no provider refund API); Paperfly
  is not built (no public API docs).

## Push

- One release commit, parent `aac0c70`, tree = the verified union
  tree + this note, pushed fast-forward-only to `main` (never
  force-pushed). Remote main was re-verified by HTTPS ls-remote
  immediately before pushing.
