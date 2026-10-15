# Orders Next — ON12 Acceptance (Team Performance)

Date: 2026-10-15 · Branch `orders-next` (base: ON10 final `ee97499`) · **Local commits only — NOT pushed, NOT deployed. NO schema change, NO migration** (every metric reads existing rows; the 164-migration sequence is untouched).

Commits (oldest → newest): `db90827` ON12 API + specs · `fb15bf2` ON12 web · this doc (see git log).

## What ON12 is — and what it is not

The plan's ON12 line bundles three things. Their status differs, stated plainly:

1. **Per-staff order-handling counts (this build)** — delivered below as the team-performance endpoint + panel.
2. **"Permission অনুযায়ী queue (packer শুধু dispatch দেখে)"** — **already delivered before ON12** by the existing RolesGuard / `@PermissionArea` system (OB1–OB3): every orders surface, queues included, is gated by the caller's role + per-member permission overrides, and this endpoint rides that same `@PermissionArea("orders")` read permission. **ON12 is the remainder of the plan item; no new permission layer was built, and none was needed.**
3. **"সাপ্তাহিক টিম সারাংশ" (weekly team summary SEND)** — **NOT built.** The ON9 owner digest is a *daily orders* digest (figures for the owner), not a weekly *team* summary, and it does not cover this. No send, job, or toggle was faked for it; it remains open if the owner wants it as a follow-up.

**Dropped plan metrics (no real actor source — never estimated):** the plan text also mentions গড় handling সময় (average handling time) and per-staff SLA ভঙ্গের হার (SLA breach rate). Neither has a real per-actor source in the stored data: SLA stage is computed per *order* from order/fulfilment/shipment timestamps with no actor attribution, and no per-member start/finish timestamps exist for "handling". Both are **dropped, not approximated**.

## Metric → source table (as implemented — the single source is the header of `order-team-performance.service.ts`)

Population: **all ACTIVE `Membership` rows of the org** — zero-activity members included (all zeros + their real `assignedOpen`). Range = Asia/Dhaka calendar days via the **ON9 `parseRange`** (window `[from 00:00 +06:00, to+1day 00:00 +06:00)`; defaults to = Dhaka today, from = to − 29 days; from > to → 400 Bengali).

| Metric | Source (exact) | Range-bound? |
|---|---|---|
| `assignedOpen` | `Order` rows: `organizationId` = org, `assigneeId` = member userId, `isPractice` = false, status NOT in `ORDER_TERMINAL_STATUSES` | **No — current snapshot** |
| `statusChanges` | `AuditLog` count: org + `userId` = member + `entityType` = `"Order"` + action `"orders.status_changed"` (writer: `OrdersService.updateOrder`) | Yes (`createdAt`) |
| `holdsPlaced` | `AuditLog`, action `"orders.review_hold_set"` (`FraudShieldService.hold`) | Yes |
| `holdsReleased` | `AuditLog`, action `"orders.review_hold_released"` (`FraudShieldService.release`) | Yes |
| `codCalls` | `AuditLog`, action `"orders.cod_call_recorded"` (`FraudShieldService.recordCodCall`) | Yes |
| `commentsPosted` | `AuditLog`, action `"orders.comment_created"` (`OrderInsightsService.createComment`) | Yes |
| `picksDone` | `PickWaveOrder` rows: `pickedById` = member, `pickedAt` in range; org via the row's `PickWave.organizationId` (the model carries no org column) | Yes (`pickedAt`) |

`entityType` note: **every** one of the five audit writers was verified in code to set `entityType: "Order"`, so the filter applies uniformly to all five.

`ORDER_TERMINAL_STATUSES` = `cancelled, refunded, failed, returned, delivered, completed` — the orders area's one lifecycle-done set (the `OrdersService` sla_breach open query, `OrderAnalyticsService`'s terminal list, and `fulfillment/sla.ts` done set all use exactly it). ON12 centralised it as an export in `order-queues.ts` and reuses it; it is deliberately **not** the `all_open` queue's list (that work queue keeps `delivered` in play).

Aggregation: the orders-area house pattern — org-scoped `findMany` per source table (one pass over the org's audit rows for all five actions, not five queries), then a JS tally per member. Orgs are small; correctness first, like ON9.

**Definition limit (stated, not worked around):** bulk operations write ONE `"orders.bulk"` AuditLog row, not per-order `"orders.status_changed"` rows — so status changes made through a bulk action do **not** appear in `statusChanges`. This is pinned by a spec and stated in the service header, the panel copy, and here.

## API

`GET /organizations/:organizationId/orders/team-performance?from&to` — `OrderTeamPerformanceController`, registered **before** `OrdersController` in `OrdersModule` so the literal `team-performance` segment wins over `:orderId` (the ON9/ON10 pattern); TenantGuard + RolesGuard with `@PermissionArea("orders")` (read roles). Response: `{ from, to, members: [{ userId, name, email, role, assignedOpen, statusChanges, holdsPlaced, holdsReleased, codCalls, picksDone, commentsPosted }], totals: { …same metric fields, summed } }`. Members sort by range activity desc, then name. Totals are exactly the member sums (spec-asserted).

## Web

Orders page header gains a "👥 টিম পারফরম্যান্স" button opening `on12-team.tsx` (same modal pattern as ON8/ON9/ON10): range presets ৭ দিন / ৩০ দিন / কাস্টম reusing ON9's `rangeForPreset` from `@/lib/orders-on9`, a members table (সদস্য, ভূমিকা, **এখন খোলা (বর্তমান)** — labelled as a current snapshot so nobody reads it as range-bound, স্ট্যাটাস পরিবর্তন, হোল্ড +/−, COD কল, পিক সম্পন্ন, মন্তব্য), a totals row, and the bulk definition-limit note in the panel copy. Each row's **"অর্ডার দেখুন"** calls the panel's `onViewAssignee(userId)` prop (the ON8 prop pattern): the page closes the panel and sets its existing ON1 filter state to `{ assigneeId: userId, queue: "" }`, landing on the command center filtered by that assignee. Payload shaping in `lib/orders-on12.ts` (types, `buildTeamPerformancePath`, `roleLabel`, `memberDisplayName`, `formatHolds`, `activityTotal`) with vitest.

## Gates (builder-run; the coordinator runs the full gate)

- API specs: `on12-team.spec.ts` **6/6** — exit 0 (member with activity across every metric; zero-activity member with an open assigned order; range exclusion incl. yesterday's audit row + pick; `assignedOpen` snapshot invariant under a far-past range; totals = member sums; cross-org isolation incl. another org's audit row naming a local user as actor; from > to → 400; **`orders.bulk` rows do NOT inflate `statusChanges`**).
- Touched suites: `src/orders` **20 suites 314/314** — exit 0.
- API `tsc --noEmit` exit 0 · Web `tsc --noEmit` exit 0 · Web vitest (orders-on12 + on9 + on10) **18/18** (5 new ON12 tests) — exit 0 · Web `next build` exit 0.
- No schema change → no migration; no fresh-PG run needed for this batch (nothing to apply).

## Honest limits

- **Nothing is live-proven**: no real deployment, accounts, or providers were exercised; correctness rests on these specs plus the verified writer contracts. M30-style live verification is still owed.
- `statusChanges` (and the other audit counts) only see activity that actually wrote an AuditLog row through the five named paths — bulk changes are excluded per the definition limit above, and any future writer using a different action string will not be counted until it is added to the definition.
- Aggregation is in JS over org-scoped `findMany` (the house pattern); very large orgs will want indexed SQL aggregation later.
- The weekly team summary send is **not built** (see above); average handling time and per-staff SLA breach rate are **dropped** for lack of a real actor-attributed source.
- No screenshot QA of the new panel (needs the build deployed).
