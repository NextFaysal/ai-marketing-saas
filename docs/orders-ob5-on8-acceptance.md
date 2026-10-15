# Orders Next — ON8 Acceptance (Orders Automation Studio)

Date: 2026-10-14 · Branch `orders-next` (base: OB4 final `66dacf8`) · **Local commits only — NOT pushed, NOT deployed.**

Commits (oldest → newest): `4d2a62f` ON8 schema + migration · `cea78bf` ON8 API engine + wiring + specs · web + this doc (see git log).

> Provenance: a previous builder died in a daemon restart mid-task. Its uncommitted work — the schema models, the migration, the three `order-automation/` source files (vocabulary/validation/presets, service, controller) and the `automation_rule` extension in the order-notifications service — was on disk and was **kept after full review** (it matched the brief; the finisher verified every cross-reference it relies on). The finisher added: the Nest module + `app.module.ts` registration, the `order_automation_sweep` job (type + template + `AutomationService` dispatch + `AutomationModule` import), the ON2 timeline source, all specs, and all web UI.

## Migration (Orders Next range 20261013700000+)

| Migration | Contents |
|---|---|
| `20261013790000_on8_order_automation` | New tables `OrderAutomationRule` (trigger + `triggerConfig` Json + `conditions` Json + `actions` Json + `presetKey`) and `OrderAutomationLog` (`@@unique([ruleId, orderId, triggerKey])` — the exactly-once guard; rule relation `onDelete: Cascade`) |

**Deploy notes:** the migration has NOT been run on any real database. Fresh-Postgres-16 verification WAS run in the build sandbox (throwaway database, dropped afterwards): `prisma migrate deploy` over the full sequence — **163/163 migrations applied clean**, both ON8 tables present. The time-based triggers additionally need the per-org `order_automation_sweep` job enabled (template ships in the Automations gallery, 60 min) — enablement is the owner's per-org call, like every other sweep.

## Engine verdict (the audit conclusion)

The existing `WorkflowsService` **cannot** express the ON8 vocabulary: its `add_tag` step validates target ∈ {lead, conversation} only, assignment is conversation-only (`assign_conversation`), there is no order-hold step at all, and its only timer-ish triggers are schedule / inbox-unanswered / cart-abandoned sweeps — no parcel-stuck-hours or due-overdue-days triggers exist. Building ON8 into it would fork shared step semantics that inbox/lead automations depend on. ON8 is therefore a **dedicated order-automation engine** (`apps/api/src/order-automation/`) that owns order-operation rules only and does not duplicate generic workflow notifications beyond its own vocabulary. The verdict is also recorded in the header of `order-automation.ts`.

## Vocabulary (validated at save; unknown key → 400 Bengali error naming the key)

- **Triggers:** `order_created` · `status_changed` (`triggerConfig {toStatus}`) · `parcel_stuck_hours` (`{hours}` 1–8760) · `due_overdue_days` (`{days}` 1–365). Trigger config lives in its OWN `triggerConfig` Json column, not inside conditions — conditions are the merchant's if-filters; triggerConfig parameterises when the trigger itself fires.
- **Conditions (ALL must pass; absent = pass):** `minTotalMinor` (minor-unit string) · `sources[]` · `isCod` · `customerIsNew` (≤1 prior non-practice order, this one excluded) · `district` (structured customer-address district, else `parseBdAddress` on free text; low-confidence parse = no match) · `riskBandAtLeast` (`medium`|`high`; a null band never matches).
- **Actions (in order, each failure-isolated and logged):** `add_tag{tag}` (via `OrdersService.setTags` append semantics) · `assign{userId}` (via `OrdersService.assignOrder`, ACTIVE membership validated) · `hold{reason}` (via the ON4 `FraudShieldService.hold` path — reused, never forked) · `notify_staff{message}` (`AgentNotification` rows for ACTIVE OWNER/ADMIN memberships) · `notify_customer{message}` (via `OrderNotificationService.notify` with event `automation_rule`). Message placeholders `{{orderNumber}} {{total}} {{customerName}}` render from the real order.
- **HARD BOUNDARY:** no action alters totals, payment state, or status. Spec-asserted: money + payment + status are byte-identical after a full five-action rule runs.

## The `automation_rule` notification event (ON5 extension)

`OrderNotificationService.notify` accepts ONE extra event value, `automation_rule`. It is deliberately **not** a `NOTIFICATION_EVENTS` settings event: the ON5 per-event settings do NOT gate it (the merchant's enabled rule is the opt-in), the per-(order, event) sent-dedupe does NOT apply (its exactly-once guard is the `OrderAutomationLog` unique instead), the covered-existing shortcut does not apply, and the message text comes from the rule action (`data.customMessage`, already rendered). Sending reuses the ON5 channel machinery in the default order SMS → WhatsApp → email: SMS via `sendShopSms`, WhatsApp via the order's conversation (`sendAutomatedMessage`), with honest `OrderNotificationLog` rows throughout.

## Exactly-once semantics (as implemented)

The engine **reserves the log row before running any action**; a unique violation is a silent skip, so a duplicate delivery can never re-run actions.

| Trigger | triggerKey | Meaning |
|---|---|---|
| `order_created` | `created` | Once per (rule, order), ever. Both `order.ingested` and `order.created` subscriptions map to this key, so double delivery collapses into one firing. |
| `status_changed` | `status:${to}:${occurredAt ISO}` | The emitter's `occurredAt` when the payload carries one; the current `OrdersService` emitter does not, so the bucket falls back to the `createdAt` of the matching `orders.status_changed` AuditLog row, else the order's `updatedAt`. A duplicate delivery of the same transition is blocked; a genuinely later re-entry into the same status fires again. |
| `parcel_stuck_hours` | `stuck:${shipmentId}:${status}` | Once per shipment per stuck status; a later status change re-arms it. Age basis: `CourierShipment.updatedAt` (last status-sync stamp); stuck = shipment in an in-transit status (`TRANSIT_STATUSES` from `order-queues.ts`, the ON6 vocabulary). |
| `due_overdue_days` | `due:${days}` | Once per (rule, order) per configured days value (editing the rule's days may therefore fire again — documented behaviour). Due = order in `delivered`/`completed`, `total − Σ approved PaymentVerification amounts > 0` (the EC19 math `order-queues.ts` uses). Age basis: `Order.updatedAt` — honest limit: there is no dedicated `deliveredAt` column, so `updatedAt` is the closest stored witness of entering the bucket. |

Evaluation paths: (a) **events** — constructor subscriptions (FraudShield pattern) on `order.ingested` + `order.created` + `order.status_changed` via the global `EventsService`; the order is loaded fresh by id+org. (b) **sweep** — the `order_automation_sweep` job delegating to `OrderAutomationService.runAutomationSweep`, the same per-org enablement contract as `stuck_parcel_sweep`. Every firing writes ONE log row with per-action `{type, ok, detail?}`; handlers and the sweep catch everything — a rule failure never propagates into an order operation. Practice orders never fire.

## API (`/organizations/:organizationId/order-automation`, TenantGuard + RolesGuard, `@PermissionArea("orders")`)

Rule CRUD (writes audited: `orders.automation_rule_created/_updated/_deleted`, `orders.automation_preset_installed`), `PATCH rules/:id` (incl. the enabled toggle alone — partial updates are merged over the stored rule and the MERGED shape is validated), `GET presets`, `POST presets/:key/install` (creates the rule **DISABLED**, `presetKey` tracked; a second install of the same preset for the same org is a 409 Bengali refusal — enforced by lookup, as Prisma cannot express a partial unique index), `GET rules/:id/logs` (paged, newest-first), `GET orders/:orderId/automation-logs`.

Presets (exact): `big_cod_verify` "বড় COD অর্ডার — আগে যাচাই" (order_created, COD + ≥৳3,000 → hold + notify_staff) · `parcel_stuck` "পার্সেল আটকে আছে" (72h → notify_staff + notify_customer) · `due_aging` "বকেয়া পুরনো হচ্ছে" (3 days → tag "বকেয়া" + notify_staff) · `vip_customer` "VIP গ্রাহক" (returning customer + ≥৳10,000 → tag "VIP" + notify_staff) · `risky_order` "ঝুঁকিপূর্ণ অর্ডার" (riskBand high → hold).

## Timeline (ON2)

`OrderInsightsService.timeline` gains source (12): the order's `OrderAutomationLog` rows appear as kind `automation`, title = the rule's name (a deleted rule degrades to a generic "অটোমেশন নিয়ম", never a fabricated name), detail = the per-action outcome summary (`add_tag ✓ · hold ✗`). Failure-isolated like every other timeline source; existing timeline specs stay green.

## Web

Orders page header gains a "🤖 অটোমেশন" button opening the studio panel (`on8-automation.tsx`, same modal pattern as the Fraud Shield panel): rule list (enabled switch, run count + last-run from the logs, edit/delete, per-rule paged log viewer), a constrained builder (trigger select → trigger-config fields → condition fields → ordered action rows with add/remove; assignee picked from the org's real members), and the preset gallery (install button, installed state, duplicate-refusal message surfaced from the server). Payload shaping lives in `lib/orders-on8.ts` (`buildRulePayload` / `draftFromRule` — empty fields omitted, taka→minor string conversion) with vitest coverage. Bengali-first throughout. The panel states plainly that time-based rules need the `order_automation_sweep` job enabled.

## Gates (finisher-run; the coordinator runs the full gate)

- API specs: `on8-automation.spec.ts` **21/21** (validation refusals incl. all presets validating clean, CRUD + audit, preset install + duplicate refusal, every condition pass/fail incl. the customerIsNew boundary + district parse fallback + null-risk, every action executing, failure isolation, exactly-once on both event names, status re-entry, sweep stuck + due firing once, hard boundary, timeline entries, cross-org isolation) · `on8-automation.di.spec.ts` **2/2** (real Nest graph: deps injected, event subscription live; sweep dispatch + template) — exit 0.
- Touched suites: `src/orders` 17 suites **280/280** · `src/workflows` + `on2-insights` + `on5-notifications` 15 suites **80/80** · `src/automation` 11 suites **70/70** — all exit 0.
- API `tsc --noEmit` exit 0 · Web `tsc --noEmit` exit 0 · Web vitest **323/323** (44 files, incl. 7 new ON8 tests) · Web `next build` exit 0.
- Prisma schema valid; fresh-PG `migrate deploy` **163/163 clean** (see above).

## Honest limits

- **Nothing is live-proven**: no real Meta/LLM/courier/SMS provider was exercised; `notify_customer` correctness rests on the ON5 machinery's own specs plus the fake-notification contract here. M30-style live verification is still owed.
- The migration has never run on the real, data-bearing database (fresh-DB sequence only).
- `status_changed` dedupe depends on the audit-row fallback because the current emitter supplies no `occurredAt`; two genuinely distinct transitions to the same status within the same audit timestamp would collapse into one firing. Emitting `occurredAt` from `OrdersService.updateOrder` is the clean future fix (deliberately not smuggled into this batch — `OrdersService` is shared surface).
- Due-overdue age basis is `Order.updatedAt` (no `deliveredAt` column exists) — an unrelated later edit to a delivered order restarts its due-aging clock.
- The preset-install uniqueness is a service-level lookup, not a database constraint; two simultaneous installs of the same preset could race (admin-UI action, accepted).
- No screenshot QA of the new panel (needs the build deployed).
