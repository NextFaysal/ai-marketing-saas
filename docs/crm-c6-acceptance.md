# CRM C6 — Lead Funnel Report · Acceptance

Package: Leads & CRM Remaining Package, Batch 3 (plan: `docs/leads-crm-package-plan.md`).
Endpoint: `GET organizations/:organizationId/crm/funnel?days=30`
(`CrmReportController`, `@PermissionArea("customers")` — same guards and `crm` path family
as Custom Fields). Computation: `LeadsService.funnel`, from real Lead rows only.
Tests: `apps/api/src/crm/lead-funnel.spec.ts`.

## Definitions (verbatim — also printed in small print on the Leads page)

- **Window:** the leads **created** in the last `days` Asia/Dhaka calendar days, today
  included: `[start of (today − days + 1), start of tomorrow)` in Dhaka day bounds (the
  C1 two-pass Intl solver, `dhakaDayStartUtc`). A lead created exactly at the window start
  is IN; exactly at the end is OUT. `days` must be an integer **1..365**; anything else
  (0, 366, non-numeric, fractional) is a `400`. Default **30**.
- **Merged leads are EXCLUDED everywhere** (`mergedIntoId IS NULL` filter): a merged
  lead's history lives on the surviving lead, so counting it would double-count.
- **Per source:** `created` (leads created in the window), `byStage` (counts over the six
  pipeline stages), `won` (stage `"won"`), `wonRate = won / created`,
  `converted` (leads with `customerId NOT NULL` — lead→customer conversion),
  `conversionRate = converted / created`, `wonValueMinor` (sum of `valueMinor` over the
  **won** leads only, BigInt serialized as a string).
- **Rates are `null` when `created = 0`** — an empty source has no rate, never a
  fabricated 0. Rates are rounded to 4 decimal places. `wonValueMinor` for an empty/wonless
  source is the honest sum `"0"`.
- **Sources:** the known vocabulary first, in this fixed order — `manual, whatsapp,
  messenger, instagram, telegram, email, website, webchat, woocommerce,
  facebook_lead_ads` (the manual-create vocabulary plus every source the ingestion paths
  actually write: channel names, `webchat`, Meta leadgen) — then any other source strings
  present in the window's data, alphabetically.
- **Totals:** the same aggregation over all sources combined (`source: "total"`).
- Aggregation reads at most 20,000 lead rows per call (documented cap, far above any
  current org's window volume).

## Web surface

A **"📈 Lead ফানেল" panel on the Leads page** (the Analytics page is ad-performance
oriented; every other CRM surface — follow-up board, pipeline, scores — already lives on
the Leads page, so the funnel belongs with them). Per-source table: created, a stage
distribution strip (proportional segments over the six stages, counts printed below),
won, won rate, converted, conversion rate, won value; a bold totals row; a period
selector (**৭ / ৩০ / ৯০ দিন**) wired to `?days=`; the definitions above in small print.

## Test evidence

`lead-funnel.spec.ts` — 5 tests against a fixture org whose figures were computed by hand
first: per-source and totals figures match exactly (manual 3 created / wonRate 0.3333;
whatsapp won with no value → `wonValueMinor "0"`); a merged won lead is excluded
(facebook_lead_ads created = 1, not 2); window boundaries are exact (at-start in,
before-start out, at-end out); the 7-day window drops older sources and a source absent
from both data and vocabulary disappears entirely; cross-org isolation (org-2 sees only
its own lead); an empty org returns honest zeros + null rates without crashing; `days`
validation (0 / 366 / "abc" / 30.5 → 400, default 30, "90" accepted).

## Live evidence (sandbox, 2026-10-11)

Same run as C5 (`/tmp/c5c6-live-check.mjs`, **21/21** over real HTTP): on a fresh org,
a won manual lead (value 1000, converted to a customer), a new manual lead and a new
WhatsApp lead produced exactly the hand-computed funnel — manual: created 2, won 1,
wonRate 0.5, converted 1, conversionRate 0.5, `wonValueMinor "100000"`; whatsapp:
created 1, wonRate 0; totals: created 3, wonRate 0.3333; an untouched known source
(messenger) reported created 0 with **null** rates; `days=0` and `days=abc` → 400; and
the first org's funnel counted only its own 5 leads (cross-org isolation).
