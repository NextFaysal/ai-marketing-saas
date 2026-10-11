# Milestone 51 — Kanban Pipeline — Acceptance

**Status: DELIVERED (local commit only — no GitHub push, per the owner's push rule).**

## Audit first (what already existed)
- **Inbox pipeline board already existed** (U5): `GET /inbox/pipeline-board`,
  drag-and-drop board in the web inbox page, stages stored on
  `ChannelConversation.pipelineStage` (`new → talking → ordered → delivered →
  repeat`), forward-only auto-advance, "delivered" derived at read.
- **Leads board existed** with stage columns and a per-card stage `<select>`
  (`PATCH /organizations/:orgId/leads/:id`), but **no drag-and-drop**.
- **Genuinely missing:** drag-and-drop on the Leads board, and a **Shipped**
  stage in the inbox pipeline matching the owner's mapping
  (New Lead → Talking → Order Placed → Shipped → Completed).

## What was built

### 1. Leads board drag-and-drop (web only, no API change)
`apps/web/src/app/dashboard/leads/page.tsx`: cards are draggable (HTML5 DnD);
dropping on a stage column calls the **existing** `PATCH leads/:id` stage
endpoint — drag is purely a convenience over it. The move is optimistic; if
the PATCH fails the card **snaps back** and an error banner explains why
(verified live that an invalid stage is refused with 400, which is exactly
the failure the snap-back handles). The per-card stage `<select>` is
unchanged and keeps working (mobile/accessibility). A hint line under the
board documents both paths and points to the inbox pipeline board.

### 2. Inbox pipeline: derived "Shipped" stage
`InboxService.BOARD_STAGES = [new, talking, ordered, shipped, delivered,
repeat]`. The **stored** stage vocabulary is unchanged (U5 set) — `shipped`
is **derived-only**:

**Exact state mapping** (board stage ← real state):

| Board stage | Label | Source of truth |
|---|---|---|
| `new` | 🆕 New Lead | stored `pipelineStage = new` (conversation created, no reply yet) |
| `talking` | 💬 Talking | stored `talking` (auto on first agent/bot reply; also settable by drag) |
| `ordered` | 🛒 Order Placed | stored `ordered` (auto when a chat order is created; settable by drag) and no linked shipment in transit/delivered |
| `shipped` | 🚚 Shipped | **derived:** stored `ordered` + a linked order's `CourierShipment.status = in_transit` |
| `delivered` | ✅ Completed | **derived:** stored `ordered` + a linked order `completed`/`delivered` or a shipment `delivered`/`partial_delivered` (the U5 derivation, kept) |
| `repeat` | 🔁 Repeat | stored `repeat` (auto when a returning customer orders again) |

Rules and honesty boundaries:
- Shipment statuses use the real courier vocabulary
  (`in_review, pending, in_transit, delivered, partial_delivered, cancelled,
  returned`). `in_review`/`pending` shipments do **not** count as shipped —
  the parcel has not moved yet; `cancelled`/`returned` shipments leave the
  card at Order Placed (nothing was faked to keep it "moving").
- `shipped` **cannot be set manually**: it is not in `PIPELINE_STAGES`, so
  the conversation PATCH validation rejects it, and the web board's Shipped
  column accepts no drops (dropping is disabled, with an explanatory title).
  A card leaves Shipped only when the underlying shipment/order state
  changes — exactly the "no drifting manual field" requirement.
- Board cards now also expose `latestShipmentStatus` alongside
  `latestOrderStatus`.
- No schema change was needed (derivation is read-time), so the reserved
  migration number 20261010510000 was never used.

## Verification
- **Unit:** `m51-pipeline.spec.ts` — 6 tests: no shipment → ordered;
  `in_review` → ordered (not shipped); `in_transit` → shipped with the
  status on the card and `storedStage` still `ordered`; `delivered` →
  delivered; board exposes exactly the six stages in owner order; `shipped`
  is in `BOARD_STAGES` but not in the settable `PIPELINE_STAGES`.
- **Live (sandbox):** seeded conversation (stored `ordered`) + order +
  shipment `in_transit` → board showed the card under **shipped** with
  `latestShipmentStatus: in_transit`; after setting the shipment to
  `delivered` the board moved it to **delivered** and shipped emptied.
  Leads: create → stage `new`; `PATCH` stage → `qualified` (the endpoint
  DnD uses); invalid stage → **400**.
- **Full checks:** API suite **519 tests / 75 suites pass** (M50+M51+M57
  tracks combined at verification time); full monorepo build green.
- **Not live-proven:** the literal mouse drag in a browser (headless sandbox
  has no browser session for the tenant app) — the drag handlers call the
  same PATCH endpoints proven live above, and the web build compiles them.

## Roadmap note
Batch 1 of the Next-Level program (M50 + M51) is complete. Next per the
approved plan (`docs/next-level-feature-plan.md`): M52 Courier Live
Quotation, then M53 Bulk Courier Booking + Label/Invoice PDF.
