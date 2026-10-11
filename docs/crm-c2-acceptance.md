# CRM C2 — Lead Scoring · Acceptance

Package: Leads & CRM Remaining Package (docs/leads-crm-package-plan.md), Batch 1, item C2.
Before C2 there was **no lead score anywhere**. C2 adds a deterministic, compute-on-read score modelled on the M50 COD risk-score discipline (`apps/api/src/orders/risk-score.ts`): the pure function `scoreLead()` in `apps/api/src/crm/lead-score.ts` reads **only the lead's own real data** — its row, its LeadActivity history, and its linked customer's delivered orders. **No schema change, no stored score, no ML, no invented signals.**

## Scoring table (verbatim, max 100, clamped 0..100)

| Signal | Points |
|---|---|
| Stage — new | +2 |
| Stage — contacted | +12 |
| Stage — qualified | +22 |
| Stage — proposal | +30 |
| Stage — won | +30 |
| Stage — lost | +0, and the **final score is capped at 10** |
| Value — none / ৳0 | +0 |
| Value — >৳0 and <৳1,000 | +5 |
| Value — ৳1,000–4,999 | +10 |
| Value — ৳5,000–19,999 | +15 |
| Value — ≥৳20,000 | +20 |
| Activities (LeadActivity rows) — 0 | +0 |
| Activities — 1–2 | +5 |
| Activities — 3–5 | +10 |
| Activities — ≥6 | +15 |
| Recency — last touch ≤1 Dhaka day ago | +15 |
| Recency — ≤3 days | +12 |
| Recency — ≤7 days | +8 |
| Recency — ≤14 days | +4 |
| Recency — older | +0 |
| Follow-up — scheduled in the future | +10 |
| Follow-up — due today | +5 |
| Follow-up — overdue | −10 |
| Follow-up — none set | +0 |
| Linked customer (`customerId` set) | +5 |
| Linked customer has ≥1 delivered order (status `completed` or `delivered`, same org) | +5 |

Definitions:

- **Last touch** = max(`lastContactedAt`, latest LeadActivity `createdAt`), falling back to the lead's `createdAt`. Recency is measured in whole **Asia/Dhaka calendar days** (same day-boundary helper as C1).
- **Value** thresholds are in BDT against the stored `valueMinor` (poisha): <100,000 → +5 tier; <500,000 → +10; <2,000,000 → +15; otherwise +20.
- **Bands**: `won` → **hot** regardless of points; `lost` → **cold** (after the cap); otherwise score ≥60 **hot**, 30–59 **warm**, <30 **cold**.
- **Reasons**: every signal emits exactly one verbatim Bengali reason line with its points (e.g. `ফলোআপের তারিখ 3 দিন পেরিয়ে গেছে — দেরি হওয়া নেতিবাচক সংকেত (−10)।`), so the score is fully explainable from the UI (badge tooltip + detail block).
- **Thin data**: when activityCount ≤1 **and** no value **and** no linked customer **and** no `lastContactedAt`, the result carries `thinData: true` and the verbatim caution: "সতর্কতা: এই Lead সম্পর্কে তথ্য খুবই কম — কোনো কার্যকলাপ, মূল্য বা যোগাযোগের রেকর্ড প্রায় নেই। স্কোরটি শুধু প্রাথমিক ধারণা; আরও তথ্য জমলেই এটি বদলাবে।" The score is still computed from what exists — it is never dressed up as certainty.

## Surfaces

- **List** (`GET /organizations/:id/leads`): every row gains `score: { score, band, reasons, thinData }`, computed in bulk (one activities query + one delivered-orders query for the whole page, org-scoped).
- **`sort=score`**: scores only exist after computing them, so sorting is applied to the fetched candidate set — the list endpoint's existing capped set (`orderBy updatedAt desc, take: 200`, merged leads excluded, stage/source/search filters applied first). Honest limit: with more than 200 unmerged leads, sorting ranks the 200 most recently updated candidates, not the entire org history; the default (no `sort`) ordering is unchanged.
- **Detail** (`GET …/leads/:leadId`): the same `score` object, computed from an uncapped activity query (the 50-row display page is not reused for scoring).
- **Web (Leads page)**: score chip on every pipeline board card (🔥 hot / 🌤️ warm / ❄️ cold, full reasons as tooltip), a "স্কোর (বেশি → কম)" option in the sort select (board columns keep the returned order within each stage, so high scores float to the top of their column), and a score block on the lead detail with the band label, every reason line, and a note that the score is recomputed on read, never stored.

## Live verification (sandbox, 2026-10-11)

Verified over real HTTP against the locally running API + Postgres (fresh org): `GET leads?sort=score` returned the three seeded leads in descending score order with hand-verified arithmetic — Won lead 40 (30 stage + 5 created-activity + 15 recency − 10 overdue follow-up; band hot by the won rule), Overdue lead 37 (12 contacted + 15 for ৳7,500 + 5 activity + 15 recency − 10 overdue; warm), Future lead 32 (2 new + 5 + 15 + 10 scheduled follow-up; warm, `thinData: true` — only the system "created" activity exists). `GET leads/:id` returned the same score with all five Bengali reason lines.

## Tests

- `apps/api/src/crm/lead-score.spec.ts` (new): each signal in isolation (stage ladder, all five value thresholds incl. boundary values ৳999/৳1,000/৳4,999/৳5,000/৳19,999/৳20,000, activity tiers, recency tiers at every boundary day, follow-up +10/+5/−10, customer + delivered), combined maximum = exactly 100, floor clamp at 0, lost cap + cold, won hot, band edges (60/59-ish/29), latest-touch selection, thin-data trigger and each single-signal escape; surfaces: list enrichment + `sort=score` order, delivered orders counted **only within the same org** (cross-org and cancelled orders excluded), cross-org `getOne` = 404 and cross-org list isolation.
