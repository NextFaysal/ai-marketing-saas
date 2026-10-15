# Integration-6 Acceptance — Admin Next + Orders Next + Campaign Next (NB8) + Enterprise BD OS union

Date: 2026-10-15 (+06). Worktree: `~/workspace/ai-marketing-saas-int6`, branch `integration-6`.
Owner order (2026-10-15 ~10:10 +06): check the newly added code for conflicts with our
code, solve any conflicts, and when the running jobs finish, push ALL code to GitHub.

## Source lines (final HEADs at integration time)

| Line | HEAD | Note |
|---|---|---|
| integration-5 (Admin Next AB1–AB4) | `70067f6` | base of integration-6 |
| orders-next (ON1–ON12) | `55858ff` | merged |
| campaign-next (CN1–CN18 incl. NB8) | `1434c3c` | NB8 `547fb0c` + DX1 doc commit; merged |
| GitHub remote main (enterprise) | `72cfd4b` | content commits `46d79f6` (inbox redesign) + `7fcb7c0` (Enterprise BD OS) cherry-picked (NOT the merge commit) |

**NB8 wait:** campaign-next was polled read-only every ~10 min from 31cbee0 until it
advanced, was clean, and was stable across 2 consecutive polls with
`docs/campaign-builder-nb8-acceptance.md` committed (final: 1434c3c). No edits were
ever made inside the int5 or cn worktrees.

**AB4 acceptance note (honest):** the AB4 coordinator died in a daemon restart before
writing its acceptance doc / final gate summary. AB4's code is fully landed in
integration-5 (AN15 `8d6803c`, AN16 `ae85874` NO-BUILD verdict, AN17 `70067f6`).
This integration's full gates on the union tree serve as AB4's closing verification.

**Post-cutoff landings NOT in this release:** DX2 (`10bcb8e`) and DX3 (`e50736c`) landed
on campaign-next AFTER the NB8 stability cutoff. They are a separate package
(Design+UX) and are excluded from this release composition; the route audit below
shows their only API delta (GET campaign-plans/week-summary) is the single route
not present here. They integrate in the next release.

## Merge / cherry-pick results and conflict resolutions

1. **orders-next merge (`2cda995`)** — conflicts only in
   `automation.module.ts` / `automation.service.ts`: pure union. Verified every
   sweep survived: JOB_TYPES, JOB_TEMPLATES and executeJob cases for
   social_evergreen_sweep, social_follower_snapshot, connection_health_sweep,
   wallet_payout_sweep (int5) AND stuck_parcel_sweep, order_automation_sweep,
   owner_order_digest (ON) all present; both constructor tails present.
2. **campaign-next merge (`5da3c4d`)** — only conflict was
   `apps/web/tsconfig.tsbuildinfo` (restored to ours before committing, per rule).
3. **Inbox redesign cherry-pick (`ba9f89b`, from `46d79f6`)** — 5 conflict hunks in
   `apps/web/src/app/dashboard/inbox/page.tsx`, all union-resolved: IN1a highlight
   block + `setMobileTab("chat")`; CX5 helpers + the enterprise share-tracking /
   courier-booking / refund / CSV-export / spam functions; HEAD filter column
   (smart-folder chips, IN1 message search, IN1b advanced filters, IN1c saved
   views) + the enterprise expandable filter panel; the enterprise header action
   dropdown kept, and HEAD's complete Thread Action Controls bar (stage, CX5
   snooze/take-over/back-to-AI/timer, IN3 macros, macro result, toolbar-v2)
   re-inserted as a sibling before the mobileTab conditional (enterprise had
   deleted the bar entirely); customer panel = HEAD inline panel (feature
   superset: IN7b next-action, identity merge/link, block) while the enterprise
   `renderCustomerContent` extraction is kept and used by the mobile customer tab.
4. **Enterprise BD OS cherry-pick (`e0d3a61`, from `7fcb7c0`)** — conflicts in 9
   files, union-resolved: courier controller/module/service (CourierRulesService +
   CourierNdrService + CourierReconciliationService all wired; ON5 notification
   block + NDR intercept both run in syncShipment); orders controller/service/DTO
   (see repairs below); web orders page (ON modals zone + enterprise duplicates
   modal as sequential siblings; duplicate badge added to the HEAD order cell;
   enterprise link bar + ON panel buttons both kept); web layout/nav (enterprise
   grouped nav with icons + HEAD-only destinations Connections, POS, Setup Guide
   added); schema.prisma (all models/fields/indexes from both sides kept;
   `@@index([organizationId, agentId])` placed inside the Order model).

## Union repairs (bugs the gates caught, all fixed union-style)

- `schema.prisma`: ProductTagAssignment closing brace inserted before
  PredictiveReplenishment (hunk-boundary brace belonged to the common context).
- `courier.service.ts` / `orders.controller.ts`: missing closing braces at hunk
  boundaries restored (ON5 if-block, parseAddress, surgery merge).
- `automation.controller.ts`: the enterprise commit itself had DELETED the
  `@nestjs/common` import line — GitHub main `72cfd4b` does not compile this file.
  Restored from HEAD (pre-existing remote defect, fixed here, not a union artifact).
- `MergeOrdersDto` name collision: ON3 surgery owns `{ orderIds }`; the enterprise
  duplicate-merge DTO was renamed `MergeDuplicateOrdersDto`
  (`{ primaryOrderId, duplicateOrderIds, mergeReason }`) with all its usages updated.
- Shared route `PATCH /orders/:orderId/assign`: ON1 assignee assignment and the
  enterprise staff-attribution assignment collide on this route. One handler with a
  union DTO (`AssignOrderPatchDto`): an explicit `agentId` in the body runs staff
  attribution (agentId + commission), otherwise the ON1 assignee path runs exactly
  as before. (ValidationPipe is whitelist+forbidNonWhitelisted, so a single-DTO
  branch was required for both payloads to remain acceptable.)
- Duplicate web state `mergeBusy` (ON3 surgery merge = boolean; enterprise
  duplicate merge = string) renamed the enterprise one to `dupMergeBusy`.
- Constructor positional-order unions (Nest injects by type in production; two
  specs construct positionally and both are honoured):
  AutomationService tail = ON params at 28–30 (ON8 DI spec passes the engine as
  argument 29) followed by the SU/CC tail at 31–34; ProductsService =
  events at slot 8 (SU5 spec), blockedPhones at slot 9 (ON11 spec), affiliates last.
- Inbox page: composer `</div>` close moved before the mobileTab fragment close.
- Orders page: HEAD `openScannedOrder` closing brace restored; second booking-open
  `setBookForm` gained `courierIntegrationId: ""` (HEAD form-state field).

## Migration union audit

- Total migration folders: **192** = integration-5 170 + orders-next 9
  (20261013710000–20261013800000) + campaign-next 8 (20261013810000–20261013930000)
  + enterprise 5 (20261014200000, 20261014220000, 20261015010000, 20261015020000,
  20261015030000). Zero duplicate folder names.
- Zero duplicate `CREATE TABLE` and zero duplicate `ADD COLUMN (table, column)`
  across the whole 192-migration sequence (script-verified).
- **Fresh-Postgres rehearsal: 192/192 migrations applied cleanly on a disposable
  fresh PostgreSQL 16, 0 unfinished, 255 public tables.**

## Gates (union tree, all green)

- `prisma validate`: valid. Schema models present incl. the 5 enterprise models
  (PredictiveReplenishment, CourierNdrIncident, CourierDisbursementBatch,
  CourierDisbursementItem, InventoryAdGuardLog).
- tsc: api 0 errors, web 0 errors, admin 0 errors, worker 0 errors.
- API jest: **399/399 suites, 4166/4166 tests PASS** (run in 5 directory chunks
  with `--runInBand` because a single-process full run OOM-aborts in this sandbox —
  the known quirk; the two suites that failed on the first parallel attempt,
  on11-intake and on8-automation.di, were REAL union bugs — constructor positional
  order — fixed as documented above and re-verified inside their chunks).
- Web vitest: **53 files, 436/436 PASS**. Worker vitest: 13/13. Admin: no test
  files (passWithNoTests), as before.
- Production builds: `pnpm -r build` exit 0 (contracts, db, api, web, admin,
  worker, ui all built).

## Route / zero-loss audit

Route set extracted from controller decorators for every parent line and for
integration-6: parents union = **1335** routes; integration-6 = **1334**; the ONLY
missing route is `GET /organizations/:organizationId/campaign-plans/week-summary` —
the DX2 endpoint that landed after the cutoff (see above). Zero extra routes.
All 24 enterprise-new routes (NDR, reconciliation, duplicates, scoreboard,
ad-guard, replenishment) are present, and all enterprise artifacts were verified
on disk (courier-ndr/reconciliation service+dto+spec, duplicate-orders.spec,
staff-scoreboard.spec, web orders/ndr + orders/reconciliation pages, 5 migrations,
5 models). Spot-verified present: AN12 queue pause, AN15 health board, ON fraud
shield, CN17 PMax kind, CN18 frontier service, SU evergreen sweep, CC wallet.

## Honest limits

- NOT deployed: Dokploy redeploy is the owner's manual step; no migration has run
  on any real database; nothing in this release is live-proven with real
  Meta/Google/TikTok/courier/payment accounts (M30 still owed).
- DX2/DX3 (campaign-next beyond 1434c3c) are not in this tree.
- The inbox customer panel keeps HEAD's inline version in the xl column/drawer;
  the enterprise extracted `renderCustomerContent` serves the mobile tab and
  predates the IN7b/IN10 panel sections (next-action, identity, block), which
  remain available in the main panel — no feature lost, one mobile-tab gap vs
  the redesign's single-source panel, noted for a future cleanup.
