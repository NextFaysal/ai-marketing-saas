# CX Batch 5 Acceptance Document: CX8, CX12a

**Date:** 2026-10-13  
**Status:** Accepted & Verified  
**Package:** Category 1 — Customer Experience (CX)

---

## 1. Scope & Implementation Summary

### CX8: Packing Scanner — Vision Label & Product Scanner
- **Problem Solved:** E-commerce packing mistakes (sending wrong SKU, missing items, or duplicate products in parcels) cause high return and exchange logistics costs.
- **Implementation:**
  - **Prisma Schema:** Created `PackingScanLog` and `PackingScanItem` models linked to `Order` and `OrderItem`.
  - **Endpoints & Service:**
    - `POST /packing-scan/start`: Starts or resumes a packing session for an order, pre-populating expected item quantities.
    - `POST /packing-scan/:scanId/verify`: Verifies scanned SKU/barcode against expected items, counts matched vs over-packed quantities.
    - `POST /packing-scan/:scanId/complete`: Finalizes session as `verified` (if all matched) or `overridden` (requires `overrideMismatch: true` + merchant notes).
    - `POST /packing-scan/vision`: AI Vision parser for parcel shipping label / invoice to detect order number, tracking number, and customer phone.
    - `GET /packing-scan/history`: Fetches past packing scan verification history for audits.

### CX12a: Setup Guide & Practice Mode (Interactive Simulation)
- **Problem Solved:** Store owners and support agents need a safe sandbox to test AI bot behavior, FAQs, delivery rules, and order flows without sending experimental messages to real Facebook/WhatsApp customers.
- **Implementation:**
  - **Prisma Schema:** Added `PracticeScenario` (pre-configured scenarios) and `PracticeSession` (live test sessions with transcripts and scoring).
  - **Endpoints & Service:**
    - `GET /inbox/practice/scenarios`: Built-in templates for price inquiry (`scen-price-inquiry`), full order placement (`scen-order-flow`), and return policy (`scen-return-policy`).
    - `POST /inbox/practice/sessions`: Initializes a test session with scenario prompt.
    - `POST /inbox/practice/sessions/:sessionId/message`: Simulates customer messages through `InboxService.testComposeReply`, generating grounded replies using the business's actual instructions and knowledge base, saving transcript history.
    - `POST /inbox/practice/sessions/:sessionId/complete`: Completes session with score and operator feedback.
    - `GET /inbox/practice/sessions`: Lists previous practice sessions.

---

## 2. Test Verification

Run command:
```bash
pnpm --filter @repo/api test -- apps/api/src/inbox/cx-batch4.spec.ts apps/api/src/inbox/cx-batch5.spec.ts
```

Results:
- **Test Suites:** 2 passed, 2 total
- **Tests:** 20 passed, 20 total (12 in `cx-batch4.spec.ts`, 8 in `cx-batch5.spec.ts`)
- **Regressions:** 0 detected.
