# Orders Next — Program Summary (ON1–ON12, Batches OB1–OB5)

Date: 2026-10-14 · Branch `orders-next` in `~/workspace/ai-marketing-saas-on`, built on the released
integration-3 tree (`a3b62ed` = GitHub main `7443135` content). **Local commits only — NOT pushed,
NOT deployed.** Master plan: `Ecommerce…/files/Orders-Next-Master-Plan-2026-10-14.md` (goal files).
Per-batch acceptances: `docs/orders-ob1..ob5-acceptance.md` (+ per-item `orders-ob5-on8/on9/on10/on12`).

The program added a management layer on top of the released orders foundation (one Order table, one
ingestion `upsertOrder`, one calculator `PromotionsService.evaluateCheckout`, EC19 due math) without
forking any of it: 8 migrations in the claimed `20261013700000+` range (13710000–13800000, the
13740000 slot deliberately unused — ON11 needed no schema), taking the tree from 155 → 164 migrations.

## Item-by-item audit table

Every line of the master plan, mapped to where it was built or marked NOT BUILT / PARTIAL with the
reason. "Verified" = read in the batch acceptance + present in the tree at the batch's final gate.

### ON1 — Orders Command Center v2 (OB1)
| Plan item | Status | Where / note |
|---|---|---|
| Smart queues with real counts (confirm-pending, ready-to-pack, courier-stuck, today's deliveries, due collection, risky-review) | BUILT | `orders/order-queues.ts` — ONE resolver feeds counts + lists (count == list spec-pinned). review_hold queue added OB2, sla_breach OB3, incomplete_intake OB2 |
| Live feed: new-order toast + list update | BUILT | `GET orders/feed` + ~25 s visible-tab polling, "নতুন অর্ডার" pill (list never auto-replaced), mechanism labelled honestly (polling, not push) |
| Saved views | BUILT | `OrderSavedView`, per-user, foreign view → 404 |
| Powerful filters (date/district/courier/payment/value/tag/source) | BUILT | List v2, backward-compatible; + riskBand/assignee (OB2/OB1) |
| Large bulk actions (courier book, label/invoice print, status, tag, assign) with per-order success/failure report | BUILT | `POST orders/bulk` (FulfillmentModule); print rerouted through ON10 jobs in OB5, shape preserved |
| Keyboard shortcuts | **NOT BUILT** | OB1 delivered no shortcut system (grep at program close: only Enter-to-submit in two inputs). The plan listed it; it was dropped silently in OB1 and is recorded here, not hidden |
| Mobile quick actions (call, confirm, book) | BUILT | Mobile cards + row quick actions; inbox link only when a real conversation id exists |

### ON2 — Order Timeline 360 + team collaboration (OB1)
| Plan item | Status | Where / note |
|---|---|---|
| One chronological timeline per order (status, payments, shipments, returns, notes, automation) | BUILT | `OrderInsightsService` — 9 real sources in OB1; + notification log + delivery attempts (OB3), + automation log (OB5/ON8). Shipment intermediate statuses are not historied in the data → booked + current state only, stated |
| Customer 360 panel (order count, LTV, cancel/return history, reliability, past orders) | BUILT | `GET orders/:orderId/customer-360`; EC33 sold-bucket LTV; reliability null at denominator 0 |
| Order assignee | BUILT | `Order.assigneeId` + assign endpoints (ACTIVE membership validated) |
| Internal comment thread (customer-invisible) | BUILT | `OrderComment`, staff-only, audits never carry the body; no edit in v1 (delete + repost) |

### ON4 — Fraud Shield v2 (OB2)
| Plan item | Status | Where / note |
|---|---|---|
| Intake scoring (repeat phone, address/phone reuse, cancel/return history, abnormal value) | BUILT | `orders/fraud-score.ts` — 6 named signals, Bengali reasons with the real numbers; M50 band reused untouched |
| Threshold → review-hold queue (delivery/booking blocked until staff release) | BUILT | reviewHold + auto-hold (default OFF); ready_to_pack excludes held; bookShipment refuses (audited staff override exists) |
| Blocklist effective on all checkouts | BUILT | Native checkouts refuse pre-write with a generic message that never reveals the list; external-store orders are created + force-held, never dropped |
| COD confirmation worklist + call outcomes | BUILT | `POST orders/:id/cod-call` sharing the ONE confirmation vocabulary with the inbox flow |
| Every score shows its reasons | BUILT | reasons array on the stamp, the reassess response and the web panel — identical |

### ON11 — Intake Quality (OB2)
| Plan item | Status | Where / note |
|---|---|---|
| BD address → district/thana guess with confidence; staff confirms | BUILT | `parseBdAddress` — 64 districts, 132 curated thanas; suggestion-only, confirm-to-persist via the address Json |
| Phone normalization + validation | BUILT | `normalizeBdPhone` (comparison-time only; stored numbers never rewritten) |
| "This number has a previous order" warning at manual/chat create | BUILT | Non-blocking `warnings[]` (+ invalid_phone, phone_blocked, missing_address_parts) |
| Incomplete-order rescue list in Command Center | BUILT | `incomplete_intake` queue through the same resolver; CX7 chase itself untouched (pre-existing) |

### ON5 — Transactional Notification Engine (OB3)
| Plan item | Status | Where / note |
|---|---|---|
| Lifecycle notifications: received, packed, handed to courier, delivery day, failed delivery, delivered | BUILT (see note) | One engine `OrderNotificationService.notify` + a documented event→legacy dedupe map; spec asserts exactly one customer message. **Note:** `delivery_failed` is mapped but no current courier client emits a failed-delivery status, so that one event cannot fire with today's providers |
| Delivered + review request | PARTIAL | Delivered notification BUILT in the engine. The review *request* itself remains the pre-existing CX12b mechanism (`review_request_sweep`, default OFF) — ON5 did not absorb it |
| Channels SMS/WhatsApp/email via the shop's own Messaging setup | BUILT (see note) | SMS via the one `sendShopSms`; email via EmailProvider; **WhatsApp only through the order's linked conversation** — no single-send WhatsApp template API exists in the codebase, stated in the acceptance |
| Per-event templates + toggles | BUILT | `OrderNotificationSetting`; unknown template variables rejected at save; defaults: placed + delivered ON, rest OFF |
| Send log per order | BUILT | `OrderNotificationLog` (sent / failed_no_channel / failed_error / skipped_setting_off / covered_existing), surfaced in the timeline |
| "Sent" never claimed falsely | BUILT | Statuses are the provider outcomes; SMS rows honestly carry a null provider id (the helper exposes none) |

### ON6 — Fulfillment Excellence (OB3)
| Plan item | Status | Where / note |
|---|---|---|
| Wave picking (group by courier/zone) | BUILT | `PickWave`/`PickWaveOrder`; suggestions group the real ready_to_pack queue by EC22 rule → district; one open wave per order |
| Packer assignment + per-stacker counts | BUILT | Pick stamps `pickedById`; the count surface is ON12 `picksDone` (OB5) |
| Per-stage SLA timers + breach alerts | BUILT | `fulfillment/sla.ts` (24h/24h defaults, org-configurable), board chips + `sla_breach` queue |
| Stuck-parcel escalation (flag itself, staff task list, one-click customer notify) | BUILT | `stuck_parcel_sweep` job: stamps, AgentNotification to OWNER/ADMIN, fires ON5 `parcel_stuck`; exactly-once per (shipment, status) spec-pinned |
| Delivery attempt + reschedule records (courier's claim, verifiable history) | BUILT | `DeliveryAttempt` — staff records, labelled as such; NO courier-API write-back exists or is claimed |

### ON3 — Order Surgery (OB4)
| Plan item | Status | Where / note |
|---|---|---|
| Edit items/qty/address after placement; totals recompute themselves | BUILT | PATCH items + preview through the ONE evaluator (parity spec vs the evaluator as oracle) |
| Stock difference lands in the ledger | BUILT | `InventoryService.applyOrderEditDelta` + restore netting; edit→cancel returns stock to baseline exactly (spec) |
| Re-push to the connected store | **NOT BUILT** | The store outbox has NO order-items/totals push (only status/refund/note/address/fulfillment). Instead, surgery is REFUSED on Woo/Shopify orders so local totals can never diverge from the store's truth — a deliberate v1 boundary, stated in the OB4 acceptance. Address edits keep the pre-existing push |
| Before/after diff in audit | BUILT | `order.items_edited` with line diffs + totals before/after + coupon flags |
| Split orders | BUILT | Direct-write child (no double stock decrement, no notification storm); stock ownership moves ledger-only |
| Merge duplicates (lines + money reconciled, history kept) | BUILT | 2–5 orders, same-customer rule, verifications reassigned to the survivor so due math stays true |
| Stage safety rules, server-enforced | BUILT | The OB4 stage matrix (fulfillment/shipment/hold/practice guards, Bengali 400s naming the blocker) |

### ON7 — Profit & খাতা (OB4)
| Plan item | Status | Where / note |
|---|---|---|
| Real per-order profit (sale − product cost − courier's actual charge − discounts) | BUILT | As-of ProductCost rule; delivery actual ONLY from EC26 reconciliation sheet lines — when any shipment lacks a sheet line, actual + net margin are null with a coverage count (never estimated) |
| Customer খাতা (total due across orders, credit limit + warning, aging 7/15/30+) | BUILT | `GET customers/:id/khata`, buckets 0–7/8–15/16–30/30+; `availableCreditMinor` is the true signed value |
| COD cash-flow board (which courier holds how much) | BUILT | `GET orders/reports/cod-board` incl. the labelled "not yet with a courier" bucket |
| …and when the money is expected back | **NOT BUILT** | No data source in the system promises courier payout dates; the board deliberately shows only where money sits, and the UI says so — no arrival dates were fabricated |

### ON8 — Orders Automation Studio (OB5)
| Plan item | Status | Where / note |
|---|---|---|
| No-code if/then rules on the existing workflow engine | BUILT — engine substituted | Audit verdict (ON8 acceptance): WorkflowsService actions are lead/conversation-scoped (add_tag targets, conversation-only assign), with no order-hold step and no parcel/due time triggers. A dedicated `OrderAutomationRule` engine was built instead; bolting order semantics onto shared workflow steps was rejected on record |
| Triggers: created / status change / stuck / due | BUILT | + sweep job `order_automation_sweep` for the two time triggers |
| Conditions: value, district, new customer, COD (+ sources, riskBand) | BUILT | All-must-pass; validated at save with Bengali errors |
| Actions: tag, assign, hold, notify staff, notify customer | BUILT | Each failure-isolated + logged; notify_customer rides the ON5 machinery as event `automation_rule` (the rule is the opt-in; ON5 settings do not gate it) |
| Action: courier auto-select | **NOT BUILT** | OB5 hard boundary: rules never book courier and never touch money/status — booking stays a staff/bulk act. The boundary is spec-asserted (money + status byte-identical after a full-action rule) |
| Action: create task | **NOT BUILT as a distinct action** | `notify_staff` (AgentNotification to OWNER/ADMIN) is the v1 staff-alert form; no separate task object was created |
| Preset library (installed disabled, owner enables) | BUILT | 5 presets exactly as specced; duplicate install refused |
| Per-rule activity log | BUILT | `OrderAutomationLog` + rule log viewer + order-timeline entries |

### ON9 — Orders Analytics v2 + Owner Digest (OB5)
| Plan item | Status | Where / note |
|---|---|---|
| AOV, repeat-customer rate | BUILT | EC33 sold bucket; AOV null at zero, never a fake 0 |
| Cancel/return breakdown by reason | PARTIAL | Return rate BUILT (status returned OR a received/completed ReturnRequest). Cancel breakdown is **by source**: the Order model has NO cancel-reason field — the payload names its basis (`cancelBreakdownBasis: "source"`) and the UI says why |
| District-wise demand | BUILT | Structured district wins; else ON11 parse (low-confidence excluded); top 10 |
| Courier scorecard (delivery %, return %, avg transit, COD return speed — from reconciliation data) | BUILT | `classifyShipmentStatus` reused; averages carry their pair counts and are null with no pairs. Transit basis is booking → `updatedAt` while delivered-classified (no `deliveredAt` exists — labelled everywhere) |
| High-return product warnings | BUILT | rate ≥ 25% AND orders ≥ 10 (named constants) |
| Daily owner digest (orders/sales/due/stuck) | BUILT (email) | `owner_order_digest` job + send-now + status; AuditLog-recorded per-recipient results |
| Digest via WhatsApp | **NOT BUILT** | The plan said "email/WhatsApp-এ". There is no owner phone field anywhere (User/Organization audited) and no single-send WhatsApp path to a non-conversation number — the SMS leg is wired via sendShopSms and always records an honest `no_phone_on_record` skip until a real field exists |

### ON10 — Print & Document Center (OB5)
| Plan item | Status | Where / note |
|---|---|---|
| Bulk print queue: invoice, shipping label, packing slip — hundreds in one job | BUILT | `POST orders/print-jobs` (1–100 per job), one combined PDF per job through the existing builders |
| Failure report (which orders did not print) | BUILT | `failedOrderIds` + per-order Bengali reasons (bulk response + panel notice + history) |
| Template customization: logo | PARTIAL | logoUrl is stored + validated (http(s)) but **does not render** — the dependency-free PDF toolkit cannot embed raster images. Stated in the schema comment, the service and the UI |
| Template customization: footer text, terms (merchant's own words) | BUILT | + invoice note; applied on the job path only; empty template ≡ legacy bytes (buffer-compared spec) |
| Delivery challan | BUILT | New builder; COD due by EC19 math (approved verifications only) |
| Return label | **NOT BUILT** | The EC9 return flow has no return-label artifact or data path; no document type was invented for it |

### ON12 — Team Performance (OB5)
| Plan item | Status | Where / note |
|---|---|---|
| Who handled how many orders | BUILT | Status changes, holds placed/released, COD calls, wave picks, comments — each from its exact AuditLog action / actor-stamped row; zero-activity members listed |
| Average handling time | **NOT BUILT** | No actor-attributed start/stop stamps exist in the data; the metric was dropped rather than estimated (named in the ON12 acceptance) |
| Per-staff SLA breach rate | **NOT BUILT** | SLA is computed per order stage with no actor attribution — same reason |
| Permission-scoped queues (packer sees only dispatch) | COVERED — pre-existing | Delivered by the RolesGuard/@PermissionArea system across OB1–OB3 surfaces; ON12 built no new permission layer (stated in its acceptance) |
| Weekly team summary to the owner | **NOT BUILT** | ON9's digest is a daily ORDERS digest, not a team summary; nothing was faked in its place |

### Frontier (plan-excluded — correctly not built)
AI voice-call COD confirmation · gateway refund execution (Connect Center's area) · multi-warehouse
order routing · native mobile app — all remain outside the program, per the master plan.

## Program gate history (each batch's own coordinator-run closing gate)

| Batch | API suites/tests | Web tests | Fresh-DB |
|---|---|---|---|
| OB1 (ON1+ON2) | 327 / 3282 | 267 | 157/157 |
| OB2 (ON4+ON11) | 329 / 3339 | 273 | static-only (no PG in sandbox) |
| OB3 (ON5+ON6) | 331 / 3371 | 287 | 160/160 |
| OB4 (ON3+ON7) | 335 / 3432 | 316 | 162/162 |
| OB5 (ON8+ON9+ON10+ON12) | 340 / 3489 | 341 | 164/164 |

## Program-level honest limits

- **Nothing in Orders Next is live-proven.** No real Woo/Shopify store, courier account, SMS/WhatsApp/
  SMTP provider, printer, or production database has been exercised by any batch. EC12 live
  verification remains entirely owed, and several v1 designs (fraud signals, stuck thresholds, SLA
  defaults) are explicitly expected to be tuned once real data exists.
- **Migrations 20261013710000–20261013800000 (8) have never run on the real DB.** The full sequence
  is fresh-DB-proven at each batch (except OB2's static-only check, re-proven at OB3's 160/160 run).
- **Four per-org jobs need owner enablement at deploy:** `stuck_parcel_sweep`,
  `order_automation_sweep`, `owner_order_digest` (+ the pre-existing sweep set from earlier programs).
- **Push + deploy are the owner's calls.** This program is local commits on `orders-next` only,
  awaiting the owner's explicit push instruction and Dokploy redeploy, per the standing rule.
