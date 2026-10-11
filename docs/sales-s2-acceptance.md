# Sales & Data S2 — Order Actions: Acceptance

Milestone S2 of the Sales & Data Remaining Package. Before S2 the
orders API was read-only after creation: no manual status change,
no way to record a refund (despite `Order.refundedMinor`
existing), no order note. S2 adds one endpoint:

```
PATCH /organizations/:organizationId/orders/:orderId
Roles: OWNER, ADMIN, MARKETING_MANAGER, SUPPORT_AGENT
       (class also carries @PermissionArea("orders"))
Body (all optional, at least one required):
  { status?, refund?: { amountMinor: string, reason? }, internalNote?: string | null }
```

An empty PATCH is a 400:
`কিছুই পাঠানো হয়নি — status, refund অথবা internalNote-এর যেকোনো একটি পাঠান`

Cross-organization access mirrors `getOne` exactly:
`findFirst({ id, organizationId })` → 404
`Order not found in this organization`.

Schema: one migration
`20261010850000_s2_order_internal_note` —
`ALTER TABLE "Order" ADD COLUMN "internalNote" TEXT;`
plus `internalNote String?` on the Order model.

## Transition table (verbatim)

Same→same status is a no-op success: it skips all status side
effects (no restore, no events, no status audit entry) but still
applies a refund/note sent in the same PATCH.

| from ↓ → to | pending | on-hold | processing | completed | cancelled | refunded | failed | returned |
|---|---|---|---|---|---|---|---|---|
| pending    | ✓ (no-op) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| on-hold    | ✓ | ✓ (no-op) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| processing | ✓ | ✓ | ✓ (no-op) | ✓ | ✓ | ✓ | ✓ | ✓ |
| completed  | ✗ | ✗ | ✗ | ✓ (no-op) | ✗ | ✓ | ✗ | ✓ |
| cancelled  | ✓ | ✓ | ✓ | ✗ | ✓ (no-op) | ✗ | ✗ | ✗ |
| failed     | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ (no-op) | ✗ |
| refunded   | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (no-op) | ✗ | ✗ |
| returned   | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (no-op) |

- Open states (pending / on-hold / processing) may move to any
  vocabulary status.
- completed → only refunded, returned.
- cancelled / failed → only pending, on-hold, processing
  (revival).
- refunded → terminal, no different status.
- returned → terminal, no different status (goods are back, the
  order is closed).
- Disallowed →
  `অর্ডারের অবস্থা "${from}" থেকে "${to}"-তে নেওয়া যাবে না` (400).

Escape hatch: a stored status NOT in the vocabulary (legacy
platform strings, e.g. Woo `checkout-draft`) may move to any
vocabulary status — we cannot judge a lifecycle we don't own.

Vocabulary note: `returned` is an accepted merchant-set value
for this PATCH only. No platform sync produces it as an
`Order.status` (returns live on `CourierShipment`); it exists
so a merchant can mark a COD order returned by hand.

### Status side effects (only when the status actually changes)

- → cancelled / failed: `InventoryService.applyOrderRestore(org,
  orderId, "order_cancelled")`, failure-isolated (a restore
  failure never rolls back the status change).
- → returned: `applyOrderRestore(org, orderId, "order_returned")`,
  failure-isolated.
- → completed: emits `order.delivered` — parity with
  `IntegrationsService.upsertOrder`.
- Any change: emits `order.status_changed`.

## Refund rules (verbatim)

- `refund.amountMinor` is a **string of digits** (minor units,
  BigInt-safe; never a JSON number).
  Non-numeric or ≤ 0 →
  `refund-এর পরিমাণ সঠিক সংখ্যায় পাঠান (পয়সায়)` (400).
- Cumulative cap: `order.refundedMinor + amount > order.totalMinor` →
  `মোট refund অর্ডারের মোট মূল্যের বেশি হতে পারবে না` (400).
  Validation happens before any write; a rejected refund changes
  nothing.
- **Refund records money only.** A refund by itself NEVER
  restores stock. Stock comes back only via an explicit status
  change to cancelled / failed / returned.
- **Full-refund auto-status:** if the cumulative refunded amount
  becomes exactly `totalMinor` AND no explicit `status` was sent
  AND the current status is NOT one of `completed`,
  `cancelled`, `refunded`, `returned`, the order's status
  becomes `refunded`. This auto-transition bypasses the
  transition table (it is a consequence of the money, not a
  merchant status request) and triggers no stock restore.
  From completed/cancelled the order keeps its status (a full
  refund on a cancelled order never resurrects or re-closes it).
- Partial refunds never change status.
- An explicit `status` always wins over the auto-transition and
  is judged by the transition table.
- On any accepted refund: emits `order.refunded` with
  `{ orderId, amountMinor, cumulativeRefundedMinor }` (strings).

## Internal note semantics

- Key absent → untouched.
- String → set, trimmed. Empty/whitespace-only after trim →
  stores `null`.
- Explicit JSON `null` → clears the note (stores `null`).
- Max 2000 chars (DTO). The note is merchant-only: never sent to
  the customer or any platform, and its **content is never
  written to audit metadata**.

## Audit + events

One audit entry per action kind actually performed:

| action | audit action | metadata |
|---|---|---|
| status changed | `orders.status_changed` | `{ from, to }` |
| refund recorded | `orders.refund_recorded` | `{ amountMinor, cumulativeRefundedMinor, reason, autoStatus: "refunded" \| null }` |
| note changed | `orders.internal_note_updated` | `{ cleared: boolean }` (never the content) |

Events (real `EventsService`, `{ organizationId, context }`):

| event | context | consumers today |
|---|---|---|
| `order.delivered` | `{ orderId }` | **Yes** — Workflows W2 maps it to the `order_delivered` trigger; ConversionsService listens to it |
| `order.status_changed` | `{ orderId, from, to }` | **None yet** — no workflow trigger mapping exists |
| `order.refunded` | `{ orderId, amountMinor, cumulativeRefundedMinor }` | **None yet** — no workflow trigger mapping exists |

All field changes persist in ONE `order.update`; the response
is the fresh order via `getOne` (same `pubOrder` serializer —
BigInt money fields as strings, `internalNote` included).

## DI regression spec (M65 insurance)

`apps/api/src/orders/s2-order-actions.di.spec.ts` builds the
real Nest module graph (OrdersModule + the real @Global
Audit/Events modules, PrismaService replaced by a @Global fake
module) and asserts OrdersService's injected `events` and
`inventory` are the graph's actual instances — not `undefined`
— and that a PATCH to `completed` delivers `order.delivered`
to a handler registered on that `EventsService`.

Deviation from the original spec text: `@nestjs/testing` is
not a dependency anywhere in this repo, so the graph is
compiled with `NestFactory.createApplicationContext` (same DI
container and provider resolution) instead of
`Test.createTestingModule`. Services import `EventsService` /
`InventoryService` with real imports; both are appended as
`@Optional` constructor deps after `audit` (inventory, then
events) so existing positional test construction keeps working.

## Web

Orders page → per-order "⚙️ অ্যাকশন" panel:

- Status select: vocabulary statuses, current marked, only
  table-allowed transitions enabled (client mirror of the table;
  the server remains the authority and its Bengali 400 is shown
  verbatim).
- Refund form in **taka** (converted to a minor-unit digit
  string; more than 2 decimal places rejected client-side with
  a hint), optional reason, and a
  "মোট ফেরত: ৳X / ৳Y · আরও ফেরতযোগ্য: ৳Z" line from
  `refundedMinor` / `totalMinor`.
- Internal note textarea with save + clear (clear sends
  `internalNote: null`).
- Each action is its own PATCH carrying only that field.

## NOT covered (honest list)

- Workflows do **not** consume `order.status_changed` or
  `order.refunded` yet — no trigger mapping exists for them.
  `order.delivered` does have consumers (workflows
  `order_delivered` trigger + conversions).
- No bulk status change / bulk refund.
- Refunds do not call any payment gateway — this records money
  the merchant refunded outside the system (e.g. bKash/cash),
  consistent with the standing no-customer-money boundary.
- Platform status write-back: changing a status here does not
  push the status to WooCommerce/Shopify.
- Live HTTP verification is done by the coordinator, not in
  this milestone's unit scope.

## Live verification (coordinator, sandbox, real HTTP + Postgres)

Built API booted on :4100 against the sandbox database; scripted
HTTP run, 22/22 checks PASS:

- Note: set via PATCH, cleared via `internalNote: null`; empty
  PATCH → 400.
- Refund: partial ৳100 of ৳300 recorded (status unchanged);
  refund exceeding the remaining amount → 400 with the Bengali
  cap message; full refund on a `processing` order → status
  auto-became `refunded` and stock was NOT restored (money ≠
  goods); `refunded` → any further status change → 400.
- Transitions: `completed` → `processing` → 400; `completed` →
  `returned` allowed and restored stock exactly (+3 → 10).
- PATCH cancel on a fresh order restored stock exactly once;
  repeating the same cancel was a no-op (stock unchanged).
- EVENT PROOF (the M65 trap): a workflow with trigger
  `order_delivered` existed in the org; PATCHing the order to
  `completed` produced exactly one WorkflowRun for it — the
  real-import EventsService emission reaches real consumers
  through the production module graph, not only in specs.
- Cross-org PATCH (second org's owner token) → 404.
- Coordinator re-ran the full API suite after integration:
  131 suites / 957 tests PASS; monorepo build green.
