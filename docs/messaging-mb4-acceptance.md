# Messaging Advanced MB4 (MX10 + MX11) — Batch Acceptance

Status: CODE-COMPLETE in worktree `~/workspace/ai-marketing-saas-mx`,
branch `messaging-advanced`, base `5f7e5172` (MB3 head). **Local
commits only — nothing has been pushed.** No live provider proof
anywhere in this batch (M30 still owed); the two MB4 migrations
have NOT been run on any real DB (fresh-Postgres proof only, in the
Gates section below).

Per-item detail: [messaging-mx10-acceptance.md](messaging-mx10-acceptance.md) ·
[messaging-mx11-acceptance.md](messaging-mx11-acceptance.md)

## Commits

| Item | Commits |
|---|---|
| MX10 | `751d9171` implementation (schema/migration `20261019050000_mx10_growth`, tokens, resolver stages, preference center, double opt-in, forms/QR/keyword, CSV wizard, consent export, web) · `5e61bc7e` acceptance doc |
| MX11 | `5b3dd076` implementation (schema/migration `20261019050100_mx11_intelligence`, engagement module, evaluator conditions, NL draft, suppression suggestions, holdout, web, specs) · `27dd02a1` acceptance doc |
| MB4 | this doc |

## Step 0 — audit findings (summary; full evidence in the MX10 doc)

- **MS2 consent machinery**: signed tokens are HMAC-SHA256 over
  `JWT_SECRET` (the unsubscribe-token module); MX10 added new token
  purposes inside that same module rather than a second scheme.
  Preferences are enforced at audience resolve time; MX10 added
  resolver stages (pending exclusion, topic match, per-contact
  frequency cap) inside that same path.
- **LeadForm verdict**: LeadForm is the Meta Lead Ads builder
  (Meta-synced submissions, no public submit endpoint) — MX10
  opt-in forms are messaging-native by design; the integration
  point is the shared `Lead` row (signups land as real Leads with
  `source: "messaging_form"`), so nothing is forked or duplicated.
- **Consent history was ABSENT pre-MX10** (preference rows flipped
  in place; only manual dashboard actions had audit logs). MX10's
  `MessageConsentEvent` is now the recording source; history
  honestly begins at MX10 — no backfill.
- **A/B ALREADY EXISTS** (`Broadcast.abVariant/abGroupId`,
  deterministic hash split at prepare, per-variant funnels) —
  MX11 did not rebuild it. **Holdout did NOT exist** anywhere —
  MX11 built it as a bucket of the same hash.
- **RFM already exists** (`messaging/rfm.ts`, `rfm_segment`
  condition, shared `computeOrderAggregates`) — MX11's engagement
  score is computed beside RFM on the same aggregates.
- **Engagement data**: `MessageDelivery` lifecycle fields +
  `MessageLinkClick` + order aggregates linked to CUSTOMERS ONLY;
  leads have no order linkage (delivery/click data only). The
  MX11 formula is honest about this per entity and per channel
  (SMS records no open/delivered signals and earns none).

## MX10 — Growth Tools & Preference Center v2 (migration `20261019050000_mx10_growth`)

- Public preference center on the existing signed-token
  discipline: channel toggles, topics, per-contact frequency cap —
  all written to the real preference store and enforced by the
  resolver (spec-proven through the resolve path). Unsubscribe-all
  stays one click; the MS2 unsubscribe flow is untouched.
- Double opt-in: signups start `pending`; the resolver AND
  `sendToRecipient` exclude pending (provider never called,
  spec-proven). Confirmation is a real send on the existing email
  path with a signed confirm link; a WhatsApp pending confirms via
  the form keyword. An existing opt-out is never flipped back by
  signup or confirm (spec-proven).
- Growth builders: messaging-native opt-in forms (CRUD, popup
  configuration, iframe embed snippet, public join page); QR code
  generated server-side from the actual join URL using the repo's
  existing `qrcode` dependency; keyword opt-in inside the MS2/MX6
  inbound dispatch (STOP/START supreme; reserved/campaign-claimed
  keywords refused). Signups are pickable in the audience builder
  via the existing `source` condition — no evaluator change.
- CSV import wizard: mapping step, then hygiene BEFORE commit
  (duplicate in-file, duplicate vs existing contacts, invalid
  email/phone, role addresses) with a per-row exclusion reason;
  the report is persisted on `MessagingCsvImport` and
  downloadable; only clean rows import, stamped consent source
  `import`; double-commit refused; existing opt-outs stay supreme.
- Consent audit export from `MessageConsentEvent` (written by the
  preference center, unsubscribe, STOP/START, signup, confirm,
  manual and import paths), with the "history begins at MX10"
  statement in UI and export.

## MX11 — Predictive Audiences & Engagement Score (migration `20261019050100_mx11_intelligence`)

- Engagement score: pure documented formula in
  `messaging/engagement.ts` (clicks ×15 max 30 · opens ×8 max 24 ·
  delivered-only ×4 max 12 · orders ×6 max 18, customers only ·
  recency 16/10/5/0; cap 100; zero history = 0), **computed on
  read, never stored** (RFM precedent — no refresh job, no
  staleness to disclose). Usable as the `engagement_score`
  condition in the MS3 evaluator for both entities; the formula
  is shown verbatim in the UI with per-contact evidence.
- Rule-based segments via a `predictive_segment` condition —
  churn-risk, likely-to-buy, high-LTV — each rule stated in plain
  language in the UI and labelled **"rule-based estimate"**
  everywhere. Thresholds are org-configurable on `MessagingSetting`
  (churn-risk silent days 60, likely-to-buy min score 60, high-LTV
  min spent 500000 minor, suppression pair), strict-range
  validated; boundary cases are spec-pinned.
- NL segment draft through the MS9 guard path verbatim
  (kill-switch 403 / daily cap 429 before the provider,
  returned-only). Creation happens only via the existing
  saved-audience path on human confirm. Invalid AI output returns
  verbatim with validator errors; unparseable output returns raw
  text + errors; the dev provider is an honest 502. Specs prove
  no audience is created in any failure mode.
- Suppression suggestions: read-only list with per-contact
  evidence (spec-proven: viewing writes nothing). Apply is an
  explicit human action through `setPreference`, writing a real
  opt-out + an MX10 consent event, enforced at resolve
  (spec-proven). No sweep, cron or auto-apply exists.
- Holdout: `Broadcast.holdoutPercent` (1–50) recorded on the
  broadcast, `holdoutCount` stamped at prepare. One hash for
  holdout + A/B (holdout bucket first, A/B split over survivors —
  disjoint by construction, spec-proven partition). Held-out
  contacts get no recipient row, no provider call, no delivery;
  pause+resume never re-rolls (MX1 frozen rows; re-prepare
  refused); the report shows the held-out count.

## Gates (coordinator-run, serially)

- **API jest (full): 495 suites / 5,585 tests — 5,584 pass.** The
  sole failure is `cc26-payout-automation` (1 test), the
  pre-existing, base-adjudicated failure that predates MB1 and is
  untouched by MB4. Method: the monolithic run was killed when
  `/tmp` (a 512 MB tmpfs) filled and the runtime restarted mid-run
  — the run was therefore executed grouped by `src/` directory
  (61 groups), `--runInBand`, 4 GB heap, jest cache AND `TMPDIR`
  on the workspace disk; every suite ran exactly once (495 spec
  files on this tree) and the group summaries are summed above.
  MB3 → MB4 delta is exactly +2 suites / +42 tests (MX10's 16 +
  MX11's 26). The messaging group alone: 25 suites / 420 tests,
  all pass.
- **API tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Web vitest: 83 files / 706 tests, all pass** (same totals as
  MB3 — MX10/MX11 web work added no new vitest files; the
  Messaging page has no page-level vitest).
- **Web tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Next build (apps/web): green** — `✓ Compiled successfully`,
  static pages 93/93, `/dashboard/messaging` at 52.8 kB (MB3:
  45.6 kB — the growth is MX10's Growth card/public pages and
  MX11's Audience Intelligence card); the three new public routes
  are in the build: `/preferences/[token]`, `/optin/[token]`,
  `/join/[organizationId]/[slug]`.
- **Prisma validate: valid.**
- **Fresh-Postgres migrate deploy: 221/221 migrations applied
  cleanly** (`All migrations have been successfully applied.`) on
  a newly created empty database (`mxfresh_mb4`); 324 public
  tables afterwards (321 at MB3 + `MessageConsentEvent` +
  `MessagingOptInForm` + `MessagingCsvImport`); verified in the
  fresh DB: `MessagePreference.topics` + `maxPerDay` present,
  `Broadcast.topic` + `holdoutPercent` + `holdoutCount` present,
  `MessagingSetting.churnRiskSilentDays` + `likelyToBuyMinScore`
  + `highLtvMinSpentMinor` present.

**Batch gate verdict: GREEN** — the only failing test in the
entire suite is the pre-existing, base-adjudicated cc26
payout-sweep failure, which predates MB1 and is untouched by MB4.

## NOT BUILT / honest limits (batch-wide; per-item evidence in the per-item docs)

MX10:
- **JS embed/popup loader script** — no script-serving machinery
  exists in the repo; popup configuration + iframe embed shipped
  instead.
- **SMS double opt-in confirmation** — no inbound SMS path exists
  in the codebase, so an SMS-only pending signup could never
  confirm; forms requiring double opt-in without an email channel
  or WhatsApp keyword are refused at create (no fake states).
- **Confirmation-email delivery row** — the confirmation mail uses
  the real provider path directly (the send path's pending guard
  would correctly block it); state lives in the preference row +
  consent event. Recorded as a deviation in the MX10 doc.
- **Per-row differing consent sources inside one CSV file** — the
  file is the asserted source; imported preferences are stamped
  `import` with the import id.
- **Topic taxonomy CRUD** — topics are free strings surfaced from
  real rows; no taxonomy store exists to reuse.

MX11:
- **Stored score / score history / trends** — deliberately not
  built (computed-on-read, RFM precedent); no surface asks for
  score-over-time, and a stored copy would add staleness.
- **Per-channel scores / per-contact thresholds** — thresholds are
  org-level (the established MessagingSetting pattern); per-channel
  normalization is not honestly supported by the data (SMS has no
  open/delivered signals).
- **Journey/workflow holdout** — holdout is a broadcast
  prepare/resolve tool beside A/B; workflow sends have no prepare
  step or A/B seam.
- **Suppression suggestions for csv/test recipients** — no contact
  row exists to suppress through the preference store; the apply
  path works on real customer/lead rows only.
- **NL draft via the dev-template provider** — refused with an
  honest 502; there is no fact-assembly analogue for audience
  rules, and template output presented as an AI draft would be
  fabrication.

Batch-wide:
- No live provider proof anywhere (M30 owed): the confirmation
  email path, the NL draft with a real LLM, scores against a real
  org's history, and a real holdout send are code+spec proven
  only. The two MB4 migrations have run only on the fresh scratch
  DB, never on a real one.
