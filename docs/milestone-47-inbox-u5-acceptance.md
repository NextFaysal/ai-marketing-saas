# Milestone 47 (Unified Inbox U5) — Business Control Center (Acceptance)

Built 2026-10-10 from `docs/unified-inbox-plan.md` Phase U5.
Schema **103 models** (migration `20261010470000_m47_inbox_u5`:
ChannelConversation.pipelineStage / outcome / outcomeReason).

## What was built

- **Pipeline stages on every conversation** (`new → talking →
  ordered → delivered → repeat`), advanced by REAL events,
  forward-only: first human or automated reply → talking; a
  chat order → ordered, or **repeat** when the customer already
  had an earlier order; `delivered` is derived at read time when
  the linked order's real status is completed/delivered (and can
  also be set manually). Agents can move a thread from the
  thread header or by dragging its board card.
- **Pipeline board** (`GET /inbox/pipeline-board` + board view
  in the inbox): active conversations as cards per stage with
  unread counts and the stage's **linked order value** — the sum
  of the latest real orders attached to those conversations,
  labelled as linked value, never a forecast. Drag-and-drop
  between columns PATCHes the stage; clicking a card opens the
  thread. Board refreshes every 30s and on demand.
- **Conversation outcomes**: closing a thread records an outcome
  (sale / no_sale_price / no_sale_stock / no_sale_undecided /
  support_resolved / spam / other + optional reason), validated
  server-side; the team report now carries an `outcomes` block
  counted from those real rows, feeding analytics.
- **Customer Command Profile** (`GET .../command-profile`,
  rendered in the context panel): customer + lead, lifetime
  value, orders WITH courier shipments, all-channel conversation
  history for the same customer, payment-screenshot
  verifications on the thread, ad origin (Click-to-WhatsApp ad
  id / lead source), and an **RFM segment computed from the
  customer's real orders** (recency/frequency/monetary with
  deterministic bands: champion / loyal / recent / dormant /
  standard).
- **One-click actions in the thread**: 🚚 share tracking (sends
  the real tracking code through the confirmed send path —
  refuses when no booking exists), 📦 book courier (the existing
  courier endpoint with the latest order; refuses when no
  courier is connected or no order exists), 💸 refund request
  (files an internal note + notifies OWNER/ADMIN members +
  audit — a request record; it moves no money, stated in the
  UI), 🚫 block/spam (flag + close with outcome spam), and
  outcome-close.

## Deliberately not built (with reasons)
- **Issue coupon / payment link buttons**: there is no tenant
  coupon engine or tenant payment-gateway configuration in the
  product today (the platform's SSLCommerz/bKash config bills
  the SaaS subscription, and platform policy is to never hold
  customer money). Rather than fake buttons, these wait for a
  tenant-side money-instrument phase.

## Verification
- **API tests: 485 pass (71 suites)** incl. 7 new U5 tests:
  stage/outcome validation, forward-only auto-advance on reply,
  board grouping + delivered derivation + linked value sums,
  full command-profile assembly (cross-channel history, LTV,
  RFM champion, shipment + verification joins), tracking share
  through the confirmed path + honest refusal, refund request
  (note + owner notification, no money movement).
- **Live on the sandbox**: a real webchat conversation appeared
  on the board under New; an agent reply advanced its stage to
  talking in the database; the command profile returned the
  assembled record; closing with outcome `no_sale_undecided`
  stored the outcome and the team report counted it
  (`outcomes: {no_sale_undecided: 1}`); an invalid outcome was
  refused with a 400; share-tracking without an order refused
  with the honest Bengali error.

## Notes
- The migration timestamp `20261010470000` is shared with the
  parallel AI-Assistant track's own m47 migration — separate
  folders, both apply cleanly in name order.
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
