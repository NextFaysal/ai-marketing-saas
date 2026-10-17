# MX5 — Drip Sequence & Lifecycle Presets v2 — Acceptance

Status: **CODE-COMPLETE** (local commits only, no push). Multi-step,
multi-template lifecycle presets on the MX4 journey structure, with
MS8 parity preserved, plus the scan enrollment that makes the two
date-based presets (win-back, anniversary) actually able to run —
and, on audited evidence, a browse-abandonment preset as well.

Commits (branch `messaging-advanced`, base `3ab0d045`):

- `68799cbe` — MX5: v2 preset catalogue + deriveBrowseAbandoned
- `dafa59bf` — MX5: install path (service + controller)
- `7feb9267` — MX5: scan enrollment (workflows.service)
- `06435ab6` — MX5: specs
- `ec443719` — MX5 web: presets section v2 + unavailable cards
- (this doc's commit — see git log)

No migration: the new triggers are entries in the
`WORKFLOW_TRIGGERS` TS constant (validated in
WorkflowsService.validateDefinition), exactly as the MX5 brief
stated; no schema change was needed.

## Shipped, with file evidence

### 1. v2 preset catalogue (`apps/api/src/messaging/journey-presets-v2.ts`)
Shape: `{ key, name, descriptionBn, flow, trigger, templates:
[{ slot, channel, name, subject?, body }], steps: (ids) => steps,
exitOnPurchase?, journeyConditions? }` — multiple templates per
preset, steps built from a slot→templateId record.

| Preset | Trigger | Shape |
|---|---|---|
| `welcome_series` | lead_created | send welcome email → wait 1440 → send tips email → wait 2880 → send offer email (3 templates) |
| `post_purchase_care` | order_delivered | wait 60 → care SMS → wait 2880 → review-ask SMS (2 templates; NO review link — no per-order review token exists in workflow context, MS8 audit) |
| `replenishment_reminder` | order_delivered | wait 30240 (21d) → reminder SMS → wait 10080 (7d) → reminder email; **exitOnPurchase: true** |
| `win_back` | winback_due (scan) | send win-back email → wait 4320 → SMS nudge; **exitOnPurchase: true**; conditions `[{field:"inactiveDays", op:"gte", value:60}]` |
| `anniversary` | anniversary_due (scan) | one anniversary email; exitOnPurchase: false |
| `browse_abandoned` | browse_abandoned (scan) | send email → wait 2880 → SMS (see Browse verdict) |

Honesty inside the copy itself:
- `replenishment_reminder.descriptionBn` states plainly that the
  21-day interval is a **fixed default the org edits** — it is NOT
  computed from per-product consumption data (no such data exists).
- `anniversary.descriptionBn` states plainly that this is the
  customer's **account/first-seen anniversary (createdAt)** — no
  birthday or other anniversary date exists in the schema.

Variable discipline: the file exports
`PRESET_VARIABLE_ALLOWLIST` per trigger (lead_created → `name`;
order_delivered → `name, orderNumber`; winback_due → `name,
inactiveDays`; anniversary_due → `name`; browse_abandoned →
`name, itemsSummary`), each entry traced to what the real context
supplies (event + enrichContext, or the scan context — the file
header carries the full audit). The spec asserts every
`{{variable}}` in every template against it.

Cart recovery is NOT duplicated — MS8's `cart_recovery` +
`cart_recovery_3step` stay as they are (a spec asserts no key
collision between the catalogues).

### 2. Install path (same endpoint, extended listing)
- `POST messaging/journey-presets/:key/install` now resolves v1
  AND v2 keys. A v2 install creates **all** templates via
  `createTemplate`, then ONE workflow through the registered
  `WorkflowCreatorPort` with steps built from the created ids,
  the preset's `journeyConditions` when it has any (win_back),
  and journey meta `{ origin: "messaging", preset: key,
  exitOnPurchase }`; then `enabled: false`; audit
  `messaging.journey_preset_install` with metadata
  `{ preset, version: 2, templateIds }`. Response keeps the MS8
  shape (`{ preset, workflow, template, enabled }`, template =
  first created) extended with the full `templates` list.
- Listing: `MessagingService.listJourneyPresets()` still returns
  the bare catalogue array (v1 entries gain `version: 1` +
  `stepsCount`; v2 entries carry `version: 2`, `stepsCount`,
  `channels`, the full `templates` list and `exitOnPurchase`).
  The **HTTP response** of `GET messaging/journey-presets` now
  wraps it: `{ presets, unavailable }`, where `unavailable`
  comes from `listUnavailableJourneyPresets()` and contains at
  least `birthday` (see NOT BUILT). The service method's array
  shape was kept because ms8-bridge pins it; only the HTTP
  shape grew, and the web page handles both shapes.

### 3. MS8-meta verdict — journey meta ADDED to MS8 installs
Checked first, as instructed: `ms8-bridge.spec.ts` does **not**
pin `installJourneyPreset`'s port-create payload — its install
tests assert the created workflow's trigger / enabled / steps
(deep-equal), the template row, and the audit action+preset.
So MS8 installs now also pass
`journey: { origin: "messaging", preset: key }` (no
exitOnPurchase key — v1 presets never opted into it). Name,
trigger, conditions (none) and steps handed to the engine are
byte-identical to before; the one effect is that MS8 preset
installs now appear in the MX4 Journeys list with per-step
stats instead of being invisible there. `mx5-presets.spec.ts`
pins the parity: for EVERY MS8 preset, the installed steps
deep-equal `preset.steps(templateId)` and trigger/name match.

### 4. Scan enrollment (`apps/api/src/workflows/workflows.service.ts`)
`WORKFLOW_TRIGGERS` gains `winback_due`, `anniversary_due`,
`browse_abandoned` (no migration — TS constant). Two scan
methods run inside the existing leader-claimed 5-minute
interval, alongside scanAbandonedCarts:

- `scanJourneyEnrollment(now)` — one method for both date
  triggers, ENABLED workflows only:
  - **winback_due**: per customer, the **latest** order decides
    (an older order never qualifies a customer who ordered
    recently — pinned by a spec case). Threshold from the
    workflow's `inactiveDays` condition (default 60, clamp
    7..365). Enroll context `{ customerId, inactiveDays:
    <actual> }` — the real value, so the workflow's own
    condition evaluates truthfully (the scanUnanswered
    precedent of supplying the condition field in context).
    Dedupe: no run for this workflow+customer within 90 days
    (recent runs read capped at 500, filtered in code). Cap:
    **50 enrollments per workflow per scan**.
  - **anniversary_due**: customer's createdAt month/day equals
    today's month/day, both read in **Asia/Dhaka** via Intl
    formatToParts — the same timezone convention scanScheduled
    uses (documented in the code comment; org timezone is not
    per-workflow data today). createdAt must be ≥ 300 days ago.
    Dedupe: no run within 300 days. Cap 50/workflow/scan.
  - Enrollment goes through the same internal `runWorkflow`
    path as every other scan. A bare `{ customerId }` context
    resolves: `resolveRecipient` loads the Customer row by id,
    and the scan spec proves it end-to-end (runs complete,
    provider called with the customer's real address, delivery
    rows stamped with stepRef) — never a silent dead run.
- `scanBrowseAbandoned(now)` — mirrors scanAbandonedCarts
  (see Browse verdict).

Disabled workflows never enroll (both scans filter
`enabled: true`; pinned by specs for both triggers).

### 5. Browse verdict — BUILT, on evidence
The brief's build condition was met; identity linkage is NOT
weak here:
- `TrackingService` ALLOWED_TYPES includes `product_view` and
  `identify`; an identify event is the only path that stores
  contact details on the Visitor row (validated email/phone).
- `apps/web/public/tracker.js` auto-emits `product_view` with
  `{ productId, name }` from `[data-tp-product]` elements.
- The Audiences service's shipped `product_viewers` source is
  exactly "product_view events joined to identified Visitors".

So `deriveBrowseAbandoned` (tracking/abandoned-carts.ts, pure,
same honesty rules as `deriveAbandonedCarts`) derives
viewed-not-bought visitors: product_view grouped by visitor;
excluded when the same visitor has any add_to_cart /
checkout_started or purchase at/after their first view in the
window (cart recovery owns the carted; buyers are not browse
cases); last view at least 24h old; 7-day lookback; items only
from the view events' own properties. The scan looks the
Visitor up and **skips anyone with no email and no phone** —
an unidentified visitor has no resolvable recipient, and
enrolling them would only manufacture dead runs (pinned by
spec). Context mirrors the cart shape
(`{ visitorId, sessionKey, storeId, signal, itemsCount,
itemsSummary, contactEmail, contactPhone, contactName,
lastActivityAt }`), dedupe is per workflow by visitor/session
within 24h, per-org slice 30 — scanAbandonedCarts' discipline
throughout.

### 6. Per-step delivery reporting (§4) — verified, not rebuilt
A v2 install carries journey meta from its first moment, so it
appears in `GET messaging/journeys` (MX4's `journey != null`
filter over the port list) with MX4's per-step stats: stepsLog
`idx` counting + MessageDelivery `stepRef` aggregates. The
scan spec asserts a scan-enrolled run's delivery row carries
`stepRef: "0"`; the install spec asserts the meta on the create
payload; MX4's own unmodified specs pin the stats math. With
the §3 change, MS8 installs are visible there too. No second
reporting path was built.

### 7. Web (messaging page.tsx)
Journey Presets section: v2 cards show the multi-step flow
text, total step count, every template name+channel, a
"v2 · বহু-ধাপ" badge and the exit-on-purchase chip where set;
v1 cards unchanged. A v2 install result points the user to
the **Journeys section on the same page** for review, enabling
and per-step reports (and refreshes that list); v1 results keep
the Workflows-page pointer. `unavailable` presets render as
greyed cards with their reasonBn and no install button. The
old footnote claiming win-back could never run was corrected
(it predates scan enrollment). Scan triggers get Bengali
labels in the Journeys list (they are not builder triggers, so
they are not in the MX4 meta list). No new dependencies.

### 8. Specs (new files only; no existing spec modified)
- `apps/api/src/messaging/mx5-presets.spec.ts` (11 tests):
  catalogue integrity (keys/slots unique, every send step's
  templateId is a created slot with matching channel, waits
  within 1..43200, triggers in WORKFLOW_TRIGGERS), variable
  allowlist assertion over every template, preset shapes
  (welcome waits, care steps + no URL, replenishment waits +
  honesty line, win_back conditions, anniversary createdAt
  wording), unavailable contains birthday, listing shape,
  v2 install payloads (all templates, one workflow, journey
  meta, conditions, disabled via update, audit), honest
  refusals, and MS8 parity deep-equals for every MS8 preset.
- `apps/api/src/workflows/mx5-scan-enrollment.spec.ts`
  (7 tests): winback enrolls only latest-order-inactive ≥
  threshold (incl. the mixed old+new order case and the
  no-orders case), real inactiveDays in context + rendered
  template, 90-day dedupe, custom threshold, 50-per-scan cap;
  anniversary Dhaka month/day + 300-day age + 300-day dedupe;
  disabled workflows never enroll (both triggers); bare
  `{customerId}` resolves end-to-end (completed run, provider
  called, delivery `sent` with stepRef); browse derivation
  exclusions + identified-only scan enrollment with an actual
  send and 24h dedupe.

## Gates run (scoped, this worker)

- `npx jest src/messaging src/workflows --runInBand`
  (apps/api): **33 suites passed, 371 tests passed, 0 failed**
  — includes the two new MX5 specs (18 tests) and every
  pre-existing messaging + workflows suite UNMODIFIED
  (ms8-bridge, mx4-journey, mx4-journey-engine, ms1–ms10,
  mx1–mx3, w1–w7, workflow-engine-v2, ab7, a1/a2, m62).
- `npx tsc --noEmit -p tsconfig.json` (apps/api): green.
- `npx tsc --noEmit -p tsconfig.json` (apps/web): green.
- `npx vitest run --passWithNoTests` (apps/web):
  **82 files, 703 tests passed**.
- `npx prisma validate` (packages/db, dummy DATABASE_URL —
  pre-existing sandbox quirk): **schema valid** (no schema
  change in MX5; run for completeness).

NOT run (coordinator runs them serially at batch level): the
full API suite, a Next build, and any live-DB work. M30 live
proof for MX5 (a real win-back / anniversary / browse journey
firing on the deployed build) is owed, like the rest of the
package.

## NOT BUILT

- **birthday preset** — Customer and Lead have NO date-of-birth
  field (verified in schema.prisma: Customer = firstName /
  lastName / email / phone / address / customFields / tags /
  createdAt …; Lead = name / phone / email / source / stage /
  tags String[] / valueMinor / customFields / createdAt). Both
  have a `customFields` Json, but its keys are org-defined
  (CustomFieldDefs), not a system guarantee a preset can rely
  on. Listed in `unavailable` with the Bengali reason; the UI
  greys it instead of hiding it.
- **Per-product replenishment intervals** — no per-product
  consumption/lifespan data exists; the 21-day default is a
  fixed, org-editable wait, stated honestly in the preset copy.
- **Real-time exit on purchase for scan journeys** — exit
  remains MX4's polling semantics (evaluated when a waiting run
  resumes); a win_back run whose first step sends immediately
  has no wait to resume from before that first send, which is
  correct: the purchase check that matters for win-back is the
  scan's own latest-order test at enrollment.
- **Scan triggers in the MX4 journey builder meta** —
  `winback_due` / `anniversary_due` / `browse_abandoned` are
  deliberately NOT added to `JOURNEY_TRIGGERS` (the builder
  vocabulary mx4-journey.spec.ts pins exactly): they are
  preset/scan triggers, enrolled by the scans, and editable
  after install like any journey (steps/conditions via the
  Journeys section or Workflows page).
- **Browse-abandoned for unidentified visitors** — by design:
  no identify-stored contact ⇒ no resolvable recipient ⇒ the
  scan skips them (never a dead run).

## Deviations

- The HTTP shape of `GET messaging/journey-presets` grew a
  wrapper (`{ presets, unavailable }`) to carry the required
  `unavailable` array; the service method keeps returning the
  bare array because ms8-bridge pins `.map()` on it. The web
  page accepts both shapes.
- Browse preset's waits (email immediately at enrollment —
  enrollment itself is ≥24h after the last view — then SMS at
  +2880) are this worker's design choice within the brief's
  conditional item; the derivation's 24h min-age mirrors the
  cart derivation's "shopper has actually stopped" rule at a
  browse-appropriate scale.
