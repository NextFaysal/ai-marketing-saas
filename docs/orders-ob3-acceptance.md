# Orders Next — Batch OB3 Acceptance (ON5 Transactional Notification Engine + ON6 Fulfillment Excellence)

Date: 2026-10-14 · Branch `orders-next` (base: OB2 final `a1653d6`) · **Local commits only — NOT pushed, NOT deployed.**

Commits (oldest → newest): `d9b3a30` ON5 schema · `db30306` ON5 engine · `0b231f3` ON5 hooks · `714e6d2` ON5 specs · `db328f1` ON6 schema · `2a25aee` ON6 core · `6eeae9a` ON6 wiring · `94a077e` ON6 automation + specs · `c2294dd` ON5/ON6 web lib · `95fa31a` orders page · `99049c5` order detail · `6797cb1` dispatch board · this doc.

## Migrations (Orders Next range 20261013700000+)

| Migration | Contents |
|---|---|
| `20261013750000_on5_notifications` | `OrderNotificationSetting` (unique org, `config Json`) · `OrderNotificationLog` (org, orderId, event, channel, status, providerMessageId?, error?; indexes `(organizationId, orderId)`, `(organizationId, orderId, event, status)`) |
| `20261013760000_on6_fulfillment_excellence` | `FulfillmentSetting` (unique org; confirmToPackHours 24 / packToHandoverHours 24 / stuckDays 5) · `PickWave` + `PickWaveOrder` (unique waveId+orderId) · `DeliveryAttempt` · `CourierShipment` += `escalatedAt`, `escalatedForStatus` |

**Deploy notes:** neither migration has been run on any real database. Fresh-Postgres-16 verification WAS possible in this sandbox (throwaway cluster, coordinator-run): `prisma migrate deploy` over the full sequence — **160/160 applied clean, 219 tables**; all six new tables and both escalation columns verified present via information_schema. A static cross-check agrees: no duplicate `CREATE TABLE`, no duplicate (table, column) `ADD COLUMN` across all 160 migrations. The `stuck_parcel_sweep` job additionally needs **per-org enablement** at deploy (template interval 360 minutes), like every other sweep.

## ON5 — Transactional Notification Engine, delivered

### The engine
`OrderNotificationService.notify(orgId, orderId, event, data?)` is the single entry point; it NEVER throws, and every hook around it is failure-isolated (a notification failure can never block an order, booking, sync, or packing operation). Events: `order_placed`, `order_packed`, `handed_to_courier`, `out_for_delivery`, `delivered`, `delivery_failed`, `parcel_stuck` (ON6), `delivery_rescheduled` (ON6). Every attempt lands in `OrderNotificationLog` with status `sent | failed_no_channel | failed_error | skipped_setting_off | covered_existing` (provider message id when the provider returns one — email only today; the SMS helper does not expose one, so SMS rows honestly carry null). Practice orders are skipped with no log rows. Send-time dedupe: a prior `sent` row for (order, event) makes any later `notify` a no-op returning `already_sent`.

Channels are tried in the event's configured order; the loop stops at the first `sent` (channels after a success get no rows): **SMS** via the ONE shared `sendShopSms` (tenant MessagingSenderConfig gateway first, platform fallback — a "not configured" result logs `skipped_no_channel` and falls through, a gateway refusal logs `failed_error` and falls through); **WhatsApp** ONLY through the order's linked conversation (`InboxService.sendAutomatedMessage`, tag `order_notification`) — no conversation ⇒ `skipped_no_channel`, because no genuine single-send WhatsApp template API exists in this codebase (Messaging WhatsApp is broadcast-only); the conversation delivers on whatever channel it actually is (Messenger/WhatsApp/webchat/telegram/email); **Email** via `EmailProvider` when the customer has an email and SMTP is configured (subject is the fixed `অর্ডার {orderNumber} — {shopName}` line, since the config shape carries body templates only).

### Settings
`OrderNotificationSetting.config` (whole-config Json, defaults merged at read): per event `{ enabled, channels: ["sms","whatsapp","email"], templates: { sms|whatsapp|email: string|null } }`. **Defaults: `order_placed` ON, `delivered` ON, all other events OFF; all templates null (built-in Bengali defaults).** Variables: `{customerName, orderNumber, total, due, trackingUrl, shopName, courierName, trackingCode, rescheduleDate}` rendered from real order data (due = total − APPROVED verification sum; trackingUrl = the CX6 public link — token minted on the shipment row with one retry — falling back to the EC22 `trackingUrlTemplate`, else empty). An unknown variable in any template is rejected **at save** with a specific Bengali 400 (`validateConfig` also rejects unknown events/channels/shapes). Money renders via a local `formatTakaMinor` (whole taka when divisible, else 2 decimals).

### Event → existing-path dedupe map (before vs after)

**Before OB3:** the ONLY per-event customer notification was `CourierService.notifyCustomer` (conversation → platform SMS → email), called from `syncShipment` on status change, with headlines only for delivered/partial_delivered/cancelled/returned plus a one-time "shipped" card on first movement, stamped via `lastNotifiedStatus` after a confirmed send. Booking sent **nothing** (the `opts.booked` branch was dead code — verified: no production caller). Order-placed, packed, out-for-delivery, stuck, and rescheduled had no customer notification at all.

| Event | After OB3 — who sends, and how duplication is prevented |
|---|---|
| `order_placed` | Engine only, off the existing `order.ingested` event (constructor subscription, FraudShield pattern). Store-synced sources excluded — exclusion set is exactly `{woocommerce, shopify}` (the store sends its own mail, and first syncs backfill old orders). All other sources notify, including `manual`, `native_storefront`, `landing`, `pos`, `csv`, `chat`, and `subscription` renewals (a renewal is a genuinely new order; the pre-ON5 "no notification" note in that service is superseded by this documented choice). |
| `order_packed` | Engine only, hooked in `FulfillmentService.update` on the transition INTO `packed` (explicit status or all-lines-packed derivation). No legacy path existed. |
| `handed_to_courier` | Engine only, hooked at `bookShipment` success (booking previously sent nothing). When the engine actually SENDS, the hook stamps `lastNotifiedStatus` = the booking status (only when null), which suppresses the legacy first-movement "shipped" card on the first sync — while terminal NOTIFY headlines still fire later because the stamp then differs from the raw status. When the engine is off or reaches nobody, nothing is stamped and the legacy shipped card behaves exactly as before. |
| `out_for_delivery` | Engine hooked in `syncShipment` AFTER the legacy `notifyCustomer` runs, decided from the re-read stamp: legacy just stamped this status ⇒ its shipped card WAS the message for this transition ⇒ engine writes `covered_existing` (plus a `covered_existing` row for `handed_to_courier` when no handover send exists, so the log chain is complete). Legacy reached nobody (no stamp) ⇒ the engine sends per its own settings/channels. |
| `delivered` | Same hook shape: legacy's delivered headline runs first (conversation-first); stamp present ⇒ engine `covered_existing`; nobody reached ⇒ engine sends. The rider/staff path (`OrdersService` → completed/delivered events, subscribed by the engine) fires `delivered` too — the log's `already_sent` check is what keeps a courier-covered delivery from ever sending twice. |
| `delivery_failed` | Engine only, mapped from courier statuses `{delivery_failed, failed_delivery, failed}`. No current courier client emits any of these (failures surface as `returned`/`cancelled`, which remain legacy-headline-only and are deliberately NOT relabelled as delivery failures). |
| `parcel_stuck` | Engine only, fired by the ON6 sweep (§ON6.3). |
| `delivery_rescheduled` | Engine only, fired when staff record a `rescheduled` delivery attempt (§ON6.4). |

The dedupe is spec-pinned: the ON5 spec fires the legacy-covered state and the engine for the same event on fixtures and asserts exactly ONE customer message (18 tests, incl. covered-existing, already-sent, setting-off, template validation, channel fallthrough, practice, store-source silence).

### Hooks summary
`order.ingested` / `order.delivered` / `order.status_changed`→delivered subscriptions (engine constructor); `CourierService.bookShipment` + `syncShipment` (engine dep appended LAST + @Optional, CourierModule imports the new module); `FulfillmentService.update` (same discipline). `OrderNotificationsModule` imports Storefront + Messaging + Inbox; no module cycle (full build green). Staff surfaces: `GET/PUT orders/notification-settings`, `GET orders/:orderId/notification-logs` (org-scoped, foreign order 404), orders-page settings modal (per-event toggles, channel membership chips in fixed canonical order, per-channel template editors with variable help, server 400s verbatim), notification entries + a বিজ্ঞপ্তি লগ card in the ON2 order timeline/detail.

## ON6 — Fulfillment Excellence, delivered

### 1. SLA timers
`FulfillmentSetting` (lazy, defaults 24h confirm→pack, 24h pack→handover, 5 stuck days; PUT validates ints 1..720, audits changed keys only). Pure `fulfillment/sla.ts` computes per order from real timestamps: `awaiting_pack` since placedAt (packed time := the earliest packed-or-later fulfillment's `updatedAt` — there is no packedAt column; the approximation is documented in code), `awaiting_handover` since packed when no shipment exists, else `shipped`/`not_applicable`; `breached` when the stage age exceeds the setting. The SLA clock keeps running during an ON4 review hold (documented v1 choice). Exposed as an `sla` field on dispatch board rows (computed once per distinct order, failure-isolated — any error yields `sla: null`, the board never breaks) with web chips ("প্যাক বাকি · X ঘণ্টা", red "SLA ভঙ্গ" when breached), and as the new ON1 queue **`sla_breach`** through the same `resolveQueueOrderIds` resolver (count == list preserved; the OB1 spec's key list was extended, nothing else changed).

### 2. Wave picking
`PickWave`/`PickWaveOrder` with per-order validation at create (missing/foreign → "পাওয়া যায়নি"; terminal statuses, ON4 review holds — the reason names the hold — fully-packed, and already-in-another-open-wave are per-order failures in `results`; zero passing ⇒ 400 with all reasons). An order can sit in only one OPEN wave (service-enforced). Pick packs ALL remaining items through the existing `FulfillmentService.create` + `update` path (never a fork — so the ON5 `order_packed` hook fires from the same transition), is idempotent on re-pick, and stamps `pickedAt/pickedById`. Suggestions (`GET pick-wave-suggestions`) group the real `ready_to_pack` queue by the EC22 courier-rule evaluation, else district (stored Json district, else the ON11 parser), else "অন্যান্য" — capped at 200 ids with a `capped` flag shown in the UI. Web: dispatch-board Waves section (suggestions → one-click wave create with verbatim per-order errors, progress n/m, per-order pick buttons, close) plus a "ওয়েভে যোগ" action in the ON1 bulk bar.

### 3. Stuck-parcel escalation sweep
New job type **`stuck_parcel_sweep`** (AutomationService dispatch + A4 template, 360-minute interval; per-org enablement required). Candidates: shipments in the ON1 transit statuses with `updatedAt` older than `FulfillmentSetting.stuckDays` and (`escalatedAt` null OR `escalatedForStatus` ≠ current status), take 200 per run. Each escalation stamps the shipment, creates `AgentNotification` rows (type `urgent`) for ACTIVE OWNER/ADMIN memberships — the codebase's existing staff-notification mechanism; a membership-lookup failure never blocks the stamp — and fires the ON5 `parcel_stuck` event. Exactly-once per (shipment, status) is spec-pinned (a second run escalates 0 and sends nothing new; a later status change re-escalates). Escalated parcels surface in `GET fulfillment-escalations` and the dispatch board's এসকেলেশন section.

### 4. Delivery attempts
`DeliveryAttempt` (staff records of what the courier reported — the UI caption says exactly that; **no courier-API write-back exists or is claimed**): outcomes `customer_unavailable | refused | address_issue | rescheduled | other`; a caller-given shipmentId that doesn't belong to the order is a 400 (default = the order's latest shipment); `rescheduled` requires a real `YYYY-MM-DD` date and fires ON5 `delivery_rescheduled` (the date is available to template overrides via `{rescheduleDate}`). Attempts join the ON2 timeline as a new failure-isolated source, as do the ON5 notification log rows (Bengali titles per event/channel/status).

## Gates — coordinator's own final run (exit-code verified, no piped output)

| Gate | Result | Baseline |
|---|---|---|
| API jest (5 chunks, `--runInBand`) | **331 suites / 3371 tests PASS**, every chunk exit 0, zero FAIL lines (599+620+692+760+700) | 329 / 3339 (+2 suites / +32 tests = on5-notifications 18 + on6-excellence 14) |
| API `tsc --noEmit` | exit 0 | — |
| Web vitest | **287/287 PASS**, exit 0 | 273 (+14 orders-on5 lib tests) |
| Web `tsc --noEmit` | exit 0 | — |
| Full build `pnpm -r build` | exit 0 (7/7 packages incl. next build web + admin) | — |
| `prisma validate` | exit 0 | — |
| Fresh-DB migration sequence | **160/160 applied clean** (158 + ON5 + ON6), 219 tables, new tables/columns verified via information_schema | 158 (static-only at OB2) |

The known cx3-debounce flake did not trigger. One honest process note: Builder B's very first cold-cache run of the new on6 spec showed a single sweep-test failure that did not reproduce in three subsequent runs (isolated test, full spec ×2) nor in the coordinator's full 3371-test run above; it is recorded here as an un-reproduced flake, not root-caused and not hidden.

## Honest limits

- **Exactly-once is a log check, not a lock.** Two truly concurrent `notify` calls for the same (order, event) could both pass the `already_sent` check before either writes `sent` — there is no DB unique constraint on it. In practice every v1 trigger is a single sequential hook or event emission, but the residual race is stated, not hidden.
- **"WhatsApp" means "the order's chat conversation."** Delivery goes through `sendAutomatedMessage` on whatever channel the conversation lives on (Messenger, WhatsApp, webchat, telegram, email-channel). A customer with no conversation cannot be reached on this channel — there is no single-send WhatsApp template API in the codebase to do otherwise.
- **The two SMS paths resolve senders differently.** Legacy courier cards use the platform `SmsProvider` (and fall back to the shipment's recipient phone); the engine uses tenant-config-first `sendShopSms` with the customer phone (recipient phone as capability fallback). Each can reach customers the other cannot; neither behaviour was changed.
- **`order_packed` does not fire from the barcode packing-scan flow.** `PackingScanService` writes only PackingScanLog/PackingScanItem rows — it never creates or transitions Fulfillment rows — so scan-packed orders emit no `order_packed` in v1.
- **`delivery_failed` cannot fire with today's courier clients** (none emit a failed-delivery status); the mapping exists for when one does.
- **SLA inputs are approximations where the data is.** Packed time is a fulfillment's `updatedAt`; board/queue SLA math runs read-side over bounded org loads (same accepted v1 cost shape as the OB1 due-collection grouped query — no materialized index).
- **Wave suggestions cap at 200 queue ids** (flagged `capped` in the API and UI); the sweep caps at 200 candidate shipments per run.
- **Notification-settings channel order is fixed in the UI** (sms → whatsapp → email membership toggles; the config stores an order, the editor writes the canonical one). No drag-reorder in v1.
- **No live proof:** no real SMS gateway, Meta conversation, SMTP server, or courier account was exercised — everything is fixture/spec-level plus the fresh-DB migration proof. EC12/M30 live verification, the owner's Dokploy redeploy, running these two migrations on the real DB, and per-org enablement of `stuck_parcel_sweep` all remain owed.
