# Milestone 50 — COD Fraud / Return Risk Score — Acceptance

**Status: DELIVERED (local commit only — no GitHub push, per the owner's push rule).**

## What was built

A deterministic return/fraud risk score computed **only from the merchant's own
organisation data**, shown as a warning — it never blocks, holds or alters an
order. Code: `apps/api/src/orders/risk-score.ts` (pure scorer, no I/O),
`apps/api/src/orders/risk.service.ts` (org-scoped data assembly), wired into
Orders, Customer 360 and the inbox chat-order path.

### Design decision: compute-on-read, NO schema change
The score is computed on read from the org's existing orders/shipments — no
columns, no snapshot table, no migration. A snapshot would drift from the real
history the moment a later order is delivered/returned; computing on read keeps
the score always consistent with the data the merchant can see. (The reserved
migration number 20261010500000 was therefore never used.)

### Phone matching
Same convention as the rest of the codebase (Leads/CRM, inbox
`normalizePhone`): digits only, compared on the **last 10 digits**. For an
order, the phone is resolved from `customer.phone` → the order's courier
shipment `recipientPhone` → the linked conversation's `contactPhone`. No phone
→ band `unknown`.

### History & outcome classification (real vocabularies only)
All prior orders **in the same organisation** whose resolved phone matches
(excluding the target order itself):

Classification (`classifyOutcome`, first match wins):

- **returned**: any of the order's shipments has status `returned` — checked
  first, because the parcel physically came back even if a store status lags
- **cancelledOrFailed**: order status `cancelled` or `failed`
- **refunded**: order status `refunded`
- **delivered**: order status `completed`/`delivered`, or a shipment
  `delivered`/`partial_delivered`
- **open**: everything else (pending/processing/on-hold/…) — never counted
  against the customer

`decided = delivered + returned + cancelledOrFailed + refunded`.

### Scoring rules (exactly as implemented in `scoreRisk`)
- No history at all, **or** no decided outcomes → band **`unknown`**, score
  `null`. A brand-new customer is NEVER "low".
- Otherwise `score = round(100 × (returned + cancelledOrFailed + refunded) / decided)`.
- **Solid evidence (decided ≥ 3):** negative rate ≥ 0.50 → `high`;
  ≥ 0.25 → `medium`; else `low`.
- **Thin evidence (decided 1–2):** rate 1 → `high`; rate > 0 → `medium`;
  rate 0 → `low` — and the reasons always state verbatim that the evidence is
  thin (see strings below).
- COD history is reported (count of COD orders) but does not add points.
- **Location signal (reason-only, never points):** if the target order's
  normalised address exactly matches a previously *delivered* order's address,
  a reason notes the match. No area/district inference is performed.

### Reason strings (verbatim from `risk-score.ts`; Bengali)
- No history: `এই ফোন নম্বরে আগের কোনো অর্ডারের ইতিহাস পাওয়া যায়নি — তথ্য নেই, তাই ঝুঁকি বলা যাচ্ছে না।`
- History line: `এই ফোনে আগের Nটি অর্ডার: ডেলিভারি হয়েছে Xটি, রিটার্ন Yটি, বাতিল/ব্যর্থ Zটি, রিফান্ড Wটি, এখনো চলমান Vটি।`
- COD: `আগের অর্ডারগুলোর মধ্যে Nটি ছিল ক্যাশ অন ডেলিভারি (COD)।`
- No decided outcomes: `আগের অর্ডারগুলোর কোনোটিরই চূড়ান্ত ফলাফল (ডেলিভারি/রিটার্ন/বাতিল) এখনো জানা যায়নি — তথ্য অপর্যাপ্ত, তাই ঝুঁকি বলা যাচ্ছে না।`
- Thin evidence: `সতর্কতা: মাত্র Nটি অর্ডারের চূড়ান্ত ফলাফলের ওপর ভিত্তি করে স্কোর — প্রমাণ খুবই কম, নিজে যাচাই করে সিদ্ধান্ত নিন।`
- Returns: `আগের Nটি অর্ডার কুরিয়ার থেকে রিটার্ন এসেছে — এটাই সবচেয়ে শক্তিশালী ঝুঁকির signal।`
- All delivered: `আগের সব (Nটি) চূড়ান্ত অর্ডারই সফলভাবে ডেলিভারি হয়েছে।`
- Address match: `এই অর্ডারের ঠিকানা আগের একটি ডেলিভারি-হওয়া অর্ডারের ঠিকানার সাথে হুবহু মিলেছে (ঠিকানা শুধু তথ্য হিসেবে দেখানো হলো — স্কোরে এর কোনো প্রভাব নেই)।`
- Low: `আগের ইতিহাস অনুযায়ী রিটার্ন/বাতিলের হার কম।`
- Medium: `চূড়ান্ত অর্ডারগুলোর মধ্যে P% রিটার্ন/বাতিল/রিফান্ড হয়েছে — মাঝারি ঝুঁকি।`
- High: `চূড়ান্ত অর্ডারগুলোর মধ্যে P% রিটার্ন/বাতিল/রিফান্ড হয়েছে — উচ্চ ঝুঁকি।`
- Suggestion (high): `পরামর্শ: এই অর্ডারে ডেলিভারি চার্জ অগ্রিম নেওয়ার কথা ভাবতে পারেন। স্কোরটি শুধু সতর্কতা — অর্ডারটি আটকানো হয়নি।`
- Suggestion (medium): `পরামর্শ: প্রয়োজনে গ্রাহককে ফোনে যাচাই করে ডেলিভারি চার্জ অগ্রিম চাইতে পারেন। স্কোরটি শুধু সতর্কতা — অর্ডারটি আটকানো হয়নি।`

Merchant-facing wording is "রিটার্ন ঝুঁকি" — the word "fraud" is never shown to
anyone, and nothing accusatory is ever sent to the customer.

## Surfaces
1. **Orders list** — each row carries `risk {band, score}`; badge in the UI
   (🔴 উচ্চ / 🟠 মাঝারি / 🟢 কম / ⚪ তথ্য নেই ঝুঁকি). **Order detail** — full
   risk object; clicking the badge opens the reasons panel, loaded from the
   dedicated endpoint `GET /organizations/:orgId/orders/:orderId/risk`.
2. **Customer 360** — detail returns `risk` (history = the customer's own
   orders ∪ all org orders sharing their phone); UI shows a risk card with
   band, score and reasons.
3. **Chat order path** — `createChatOrder` (bot- or agent-created) computes the
   risk, returns it in the response, and when the band is not `low` writes an
   audit row `inbox.order.risk_warning`. The inbox UI shows the agent a
   warning banner after creating an order with medium/high risk. The customer
   never sees any of this.

## Bugs found & fixed on the touched paths (live-found)
- `GET /customers/:id` and `POST /inbox/conversations/:id/orders` returned
  **500 "Do not know how to serialize a BigInt"** whenever orders were present
  — both response builders converted only some `*Minor` BigInt fields. All
  minor fields are now stringified (same class of bug fixed in M40). A
  JSON-serializability regression test covers the customer path.
- The inbox risk dependency initially used an inline `import()` type, which
  Nest could not resolve as a DI token (risk silently `null`); switched to a
  normal import.

## Verification
- **Unit:** `risk-score.spec.ts` — 12 tests: pure scorer (unknown for no
  history and for no decided outcomes, thin-evidence labelling, high-return,
  good-customer, refund counting, location match, phoneKey last-10 matching,
  outcome classification incl. shipment-returned-wins) + RiskService tenant
  isolation against a stub Prisma (another org's orders with the same phone
  are invisible; summaries only for own orders) + customer-360 BigInt
  regression. Full API suite: **519 tests / 75 suites pass** (includes the
  parallel M57 track's tests). Full monorepo build green.
- **Live (sandbox):** fresh tenant + seeded history (1 returned shipment,
  1 completed, same phone; second org with same phone + 3 cancels):
  orders list showed `medium, score 50`; `/risk` returned the full Bengali
  reasons with history total 2 (other org invisible); cross-org `/risk`
  request → 403 (TenantGuard); customer detail returned the risk summary;
  chat order response carried the risk and an `inbox.order.risk_warning`
  audit row was written.
- **Tenant isolation:** guaranteed by construction (every query is
  org-scoped) + unit test + the live cross-org check above.

## Honest limits
- The score is only as good as the org's recorded history: orders imported
  without phones, or deliveries never marked in the system, are invisible to
  it (band `unknown`, never a false "low").
- Exact-address matching is deliberately strict; near-duplicate addresses do
  not match (no fuzzy inference).
- Web UI verified by build + API responses; no pixel-level browser check was
  run in the sandbox.

## Roadmap note
Next in the approved Next-Level sequence: M51 Kanban Pipeline (same batch),
then M52 Courier Live Quotation. The governing plan is
`docs/next-level-feature-plan.md` (first committed with this milestone).
