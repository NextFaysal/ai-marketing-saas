# Milestone 32 Acceptance — Advertising Stretch Pack

Date: 2026-10-10. The stretch pack from the Next Roadmap plan
(Part 2.3 + gap C3). One migration
(`20261010320000_m32_stretch`: `CampaignPlan.advantagePlus`).
Schema stays 88 models. API tests: 332 pass (9 new in
`apps/api/src/publishing/phase-m32.spec.ts` and
`apps/api/src/campaigns/phase-m32.spec.ts`).

## 1. TikTok video creative upload
`publishTikTok` now accepts `videoUrl`. When present, the chain
uploads via `/file/video/ad/upload/` (UPLOAD_BY_URL) and creates a
`SINGLE_VIDEO` ad carrying the returned `video_id`; without it the
M20 image path is byte-identical. Neither URL → 400 before any API
call. A video upload returning no video id fails the publication —
never presented as uploaded. Web: TikTok form gained an optional
Video URL field (image no longer forced).

## 2. Advantage+ Sales
- New blueprint `advantage_plus_sales` (the blueprint list is now
  five) and a plan-level `advantagePlus` flag with a builder toggle
  (hidden once published). Duplicates/A-B clones keep the flag.
- Publish structure follows Meta's Advantage+ shape: the budget
  moves to the CAMPAIGN (Advantage Campaign Budget — the first ad
  set's daily budget becomes it), ad sets are created with NO
  budgets of their own, and targeting gains
  `targeting_automation: { advantage_audience: 1 }`. Every part is
  recorded (publish-log step `advantage_plus` + audit entry) so
  the structure is auditable.
- Guards: validation rejects Advantage+ on non-OUTCOME_SALES plans;
  the toggle refuses published plans (structure is fixed at
  creation time); publish refuses Advantage+ with no daily-budget
  ad set (there would be no campaign budget).

## 3. Google Performance Max skeleton
`POST publish/google-pmax`, same publication discipline as Search:
OAuth → budget → PAUSED PERFORMANCE_MAX campaign →
geo-suggest-resolved location criteria → PAUSED asset group →
text assets (headlines/long headlines/descriptions/business
name) → image assets (logo + marketing images fetched server-side
and uploaded as base64 bytes — Google has no by-URL image asset)
→ asset-group links by field type → UNIT_INCLUDED all-products
listing-group root. Asset minimums are Google's published ones
(3–15 headlines ≤30, 1–5 long ≤90, 2–5 descriptions ≤90, business
name ≤25, 1–20 images) and are enforced BEFORE any API call or
record. Any failed step = publication "failed" with Google's own
error and earlier resource names kept. Web: full PMax form on the
Ad Accounts page.

## 4. Meta-side product sets
`POST catalogs/:catalogId/product-sets/:setId/publish` translates
a local set definition into a catalog filter
(`buildMetaProductSetFilter`: category `i_contains`, price `lte`
in the same minor-unit numbers the batch push sends, availability
`eq "in stock"`, combined with `and`) and creates it via
`/{catalogId}/product_sets`. Created ONLY with a Meta-returned
set id (stored as externalSetId, status "created"); a Meta
rejection is stored on the set (status "failed" + Meta's verbatim
error) and surfaced. Re-publishing a created set is a no-op.
Deletion now also attempts a Meta-side delete (new `graphDelete`
helper) and reports `metaDeleted` honestly — a Meta failure never
traps the local record. Web: Audiences page shows set status
(local / Meta-created with id / failed with error) and the create
button.

## Verification
- Builds: full monorepo `pnpm -r build` clean (0 TS errors).
- Tests: 51 suites / 332 API tests pass (was 323).
- Live on the sandbox (fresh DB after a VM replacement — see
  below): blueprint list shows all five incl.
  `advantage_plus_sales`; instantiating it yields a draft with
  `advantagePlus: true`; the toggle flips it both ways; PMax with
  2 headlines → 400 before any record; TikTok publish with no
  creative → 400 with the explicit message; product-set publish on
  a missing catalog → 404.

## Sandbox incident (same day, recovered)
A VM replacement wiped pnpm, /tmp helpers, and the PostgreSQL
DATA again (cluster binaries survived). Recovered with the known
recipe (pnpm reinstall, marketing user/db recreated, all 26
migrations + seed re-applied, CLI admin grant re-run). The demo
org id is now `9754697f-ede5-4d8d-b1ec-e7953fdb9a7b`; the fresh DB
has NO TOTP enrolment, so the M28 demo-login trap does not apply
to this incarnation. This is the second full wipe — it reinforces
the M29 recommendation (permanent deployment).

## Honest limits
- No live platform evidence yet for any of the four: TikTok video
  upload, an Advantage+ publish, a PMax chain, and a Meta product
  set all need the owner's real accounts (checklist section 22).
  Unit tests stub the platforms' documented response shapes; the
  PMax listing-filter `caseValue` and the product-set filter
  grammar follow Meta/Google's published references, and any
  platform rejection lands verbatim on the record — nothing is
  presented as created without a returned id.
- The Advantage+ campaign budget takes the FIRST ad set's daily
  budget; plans with several differently-budgeted ad sets should
  be split — this is logged at publish time, not silently merged.
- PMax supports one asset group and the all-products listing
  root; per-category listing trees and additional asset groups
  are follow-ups, not claimed here.
