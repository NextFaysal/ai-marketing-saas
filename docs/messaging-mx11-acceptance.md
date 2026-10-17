# MX11 — Predictive Audiences & Engagement Score · Acceptance

Batch: MB4 (2 of 2 — MX10 was 1 of 2; MB4 complete with this item). Worktree `~/workspace/ai-marketing-saas-mx`, branch `messaging-advanced`, base HEAD `5e61bc7e` (MB1–MB3 + MX10). Local commits only — no push.
Migration: `20261019050100_mx11_intelligence` (the next slot after MX10's `20261019050000`, as assigned).

Step-0 audit: performed by the MX10 worker and recorded in `docs/messaging-mx10-acceptance.md` §5–6 — this build follows it without re-deriving: **A/B already exists** (not rebuilt), **holdout did not exist** (built fresh at the A/B hash seam), **RFM already exists** (`messaging/rfm.ts`, `rfm_segment` condition) — the engagement score is built *beside* it on the same `computeOrderAggregates` plumbing, and order history links to **customers only** (lead scores rest on delivery/click data alone).

---

## Design decisions (recorded as required)

### Score: COMPUTED on read, never stored
Following the RFM precedent exactly (`computeRfm` computes quintiles at report/resolve time and stores nothing), the engagement score is computed on read by `MessagingService.buildEngagementMap` and the pure `computeEngagementScore` in `apps/api/src/messaging/engagement.ts`.
- **Refresh path:** none needed — there is no copy to refresh. Every read (report, audience resolve, suggestions) recomputes from the current `MessageDelivery` / `MessageLinkClick` / order-aggregate rows.
- **Staleness:** zero by construction at read time; the honest cost is one bounded aggregate pass per read (deliveries + clicks capped at 50,000 rows each, order aggregates via the existing DB-side `groupBy`), and the map is built **only when a condition or endpoint actually reads it** (the RFM "compute only when needed" discipline in `resolveCustomAudienceInChunks` / `audienceFactsForRecipient`).
- **Migration consequence:** no score table/columns exist; the migration only adds the holdout fields + threshold settings.

### Holdout × A/B composition: they compose (no gate needed)
Both read **one** hash — the existing A/B discipline `h = (h*31 + code) >>> 0` over `` `${type}:${id}` `` (`engagement.ts` `recipientHash` is byte-identical; the spec proves agreement against an inline re-implementation). A/B reads `h % 2`; holdout reads `h % 100 < percent`. At prepare, holdout is applied **first**, then the A/B split runs over the survivors: a recipient is held out *or* in exactly one variant — disjoint by construction, no double exclusion, and the spec proves the partition on a 20-customer fixture. For an A/B pair, **both variant rows stamp the same `holdoutCount`** (the pair shares one audience and one holdout bucket — it is the pair's held-out count, not half per variant).

### High-LTV vs RFM (no duplicated computation)
High-LTV reads the **same** `computeOrderAggregates` numbers as RFM/MS3 — there is no second order-aggregation path. The rule itself differs from RFM's `big_spenders` deliberately: RFM is a *relative quintile* inside the org's own base; high-LTV is an *absolute org threshold* (≥ 2 orders AND total spent ≥ `highLtvMinSpentMinor`). Both facts are stated in the doc/UI rather than one silently replacing the other.

---

## Shipped — item-by-item audit vs the MX11 requirements

### Schema / migration — `20261019050100_mx11_intelligence`
Additive only, no backfill:
- `Broadcast.holdoutPercent Int?` (NULL = no holdout, every pre-MX11 row) + `Broadcast.holdoutCount Int?` (stamped at prepare).
- `MessagingSetting` thresholds with schema defaults: `churnRiskSilentDays` 60, `likelyToBuyMinScore` 60, `highLtvMinSpentMinor` 500000 (= ৳5,000), `unengagedSuppressDays` 90, `unengagedMinSends` 3.

### 1. Engagement score per contact ✅
- **Formula (pure, `engagement.ts`, documented + shown verbatim in the UI):** clicks `min(clicks×15, 30)` + opens/reads `min(opens×8, 24)` + delivered-but-not-opened `min(delivered×4, 12)` + orders `min(orders×6, 18)` (customers only) + recency of last engagement (≤7d: 16 · ≤30d: 10 · ≤90d: 5 · older/never: 0), capped at 100. One delivery never earns both delivered and open points (delivered-only excludes opened/read deliveries).
- **Inputs are real records only:** confirmed (`status = "sent"`) `MessageDelivery` rows — broadcast *and* workflow deliveries both count (one shared store; the frequency cap's broadcast-only scope is a different rule and unchanged) — `MessageLinkClick` rows by `recipientKey`, and order aggregates via the existing `computeOrderAggregates`. csv/test recipients have no entity id behind their deliveries and honestly never get a score.
- **Per-channel honesty:** a signal a channel cannot produce is simply absent — SMS records no delivered/open (no documented DLR), email opens exist only via the open pixel, WhatsApp via webhooks. The formula never normalizes or fills in; this is stated in the module doc, the UI formula panel source text, and here.
- **Audience condition:** `engagement_score` (number, eq/gte/lte/gt/lt) added to the MS3 evaluator's common field set in its existing style, wired into both resolver fact builders + the MX8 per-recipient facts. A contact with zero history has a real computed **0** (so `engagement_score eq 0` honestly matches the never-engaged); a null fact (engagement data unreadable) makes the condition FALSE, per the evaluator's documented null semantics.
- **UI:** the Audience Intelligence card shows the formula verbatim (`ENGAGEMENT_FORMULA_TEXT`), per-contact evidence (sends/opens/clicks/orders/spend behind each score) and the "rule-based estimate" label.
- **Spec proof:** fixed fixtures pin the weights/caps/recency tiers at exact boundaries, determinism (same inputs → same score), and the zero-history floor 0; service specs resolve `engagement_score` conditions from seeded real rows (a 2-click/2-open customer scores exactly 62).

### 2. Rule-based segments ✅
- `predictive_segment` (eq) added to the evaluator for **both** entities, value strictly validated against `churn_risk | likely_to_buy | high_ltv` (an unknown value is a write-time 400, like `rfm_segment`).
- **Rules (plain language, shown in the UI next to the counts):**
  - *churn_risk* — previously engaged (any open, click or order) AND silent ≥ `churnRiskSilentDays` since the last engagement.
  - *likely_to_buy* — score ≥ `likelyToBuyMinScore` AND last engagement within 30 days (the 30 days is a fixed, documented part of the rule, not a hidden knob).
  - *high_ltv* — customers only: ≥ 2 real orders AND total spent ≥ `highLtvMinSpentMinor`. Leads can never be in it (no order linkage) — stated in the rule text.
- **Labelled "rule-based estimate" everywhere:** the engagement report (`label` field + UI badge), the segment rules list, the audience-builder field labels, and the suppression list. The words "AI prediction"/"ML" appear nowhere for these.
- **Thresholds org-visible + org-configurable** via the existing MessagingSetting pattern: strict integer ranges at write time (invalid → 400), defensive default reads, exposed in the settings GET view and editable in the Consent settings form.
- **Spec proof:** every segment is boundary-tested just inside / just outside (silent exactly 60d in, 59d out; score exactly at threshold in, one below out; spend exactly at threshold in, one minor less out; 1-order and lead high-LTV exclusions).

### 3. Natural-language segment draft ✅
- `POST messaging/ai/segment-draft` → `draftSegmentFromDescription`, going through the **MS9 guard path verbatim**: `checkMessagingAiLimit` first (platform kill switch → 403, per-feature daily cap counted from `AIUsageRecord` → 429, both **before** the provider is resolved), then `messagingAiProvider`, one usage record per completed call under the same `messaging_copy` feature.
- The prompt hands the model the evaluator's **exact** field vocabulary for the requested entity (from `fieldsForEntity`) and demands the exact definition JSON shape.
- **Returned-only:** the endpoint writes nothing — no audience, no broadcast. Creation happens only when a human presses the confirm button in the UI, which calls the **existing** `POST messaging/audiences` saved-audience path with the (possibly hand-edited) draft.
- **Validation honesty:** a draft failing `validateAudienceDefinition` returns `valid: false` with the draft **verbatim** (never silently corrected) + the validator's exact error; unparseable output returns `draft: null` + the raw text + errors. With no real LLM configured the endpoint is an honest **502** (a dev template cannot write audience rules — deliberately *not* the MS9 dev-template treatment, recorded here as a conscious difference: MS9's dev fallback assembles merchant-supplied facts into copy, which has no analogue for rule generation).
- **Spec proof:** kill switch ⇒ 403 + provider never called + zero audiences; cap ⇒ 429 likewise; valid output ⇒ draft only, audience count stays 0 until `createSavedAudience` is called with it; invalid output ⇒ draft + errors, zero audiences; unparseable ⇒ draft null + raw text; dev provider ⇒ 502.

### 4. Unengaged suppression SUGGESTIONS ✅
- `GET messaging/suppression-suggestions` is **read-only** (spec proves preference + consent-event tables are byte-untouched by calling it). Rule: ≥ `unengagedMinSends` confirmed sends AND no open/read/click/order for ≥ `unengagedSuppressDays` (never-engaged counts as silent, with `lastEngagementAt: null` shown as "never"). Each suggestion carries the evidence: last engagement date, sends since then, total sends, score, and any channels already opted out. Contacts already opted out on *every* channel they have an address for are not suggested.
- **Apply is the only write, and it is a human action:** `POST messaging/suppression-suggestions/apply` (WRITE_ROLES; the UI additionally asks for `window.confirm`) writes real `opted_out` rows through `setPreference` (source `manual`, MX11 note, actor `user:<id>`) — which records the MX10 `MessageConsentEvent` — and is then enforced by the resolver's existing suppression stage (spec-proven). Already-opted-out / address-less items come back as named skips, never fake successes. There is **no sweep, no cron, no auto-apply anywhere** (grep-verifiable: the only caller of `applySuppressionSuggestions` is its controller route).

### 5. Holdout group ✅
- `holdoutPercent` (integer 1–50, validated at create with an honest 400) is stored on the Broadcast (both A/B variants + the WhatsApp base inherit it via the shared base objects, like `topic`); clone does **not** copy it (a clone is a fresh single draft — the MS10 A/B-strip precedent).
- Excluded at prepare in **both** prepare paths (MX1 recipient-table + legacy snapshot) via `splitHoldout`, before the A/B filter; `holdoutCount` is stamped on the row. Preview accepts the same percentage and reports `excludedHoldoutCount` from the same bucket, and its total/cost use the post-holdout set.
- **Spec proof:** (a) held-out contacts get no recipient row, no provider call and no delivery row across a full send; (b) a pause + resume cycle sends each kept contact exactly once, the recipient rows are identical before/after, re-prepare is refused (frozen set — the MX1 determinism), and no held-out contact is ever sent; (c) `getBroadcastReport` returns `holdout: { percent, heldOutCount, label }` and the web report panel renders it. A/B + holdout composition is proven as a partition (disjoint variants covering exactly the non-held-out set, split by the same hash parity).

### Web UI ✅
All on the existing Messaging page, in its existing style:
- **Audience Intelligence (MX11) card** next to the RFM card: "rule-based estimate" badge, the formula in plain language, segment rules + live counts with thresholds interpolated, a top-contacts table with per-contact evidence, the NL draft box (description + entity → draft JSON in an editable textarea, validation errors shown, confirm button that saves through the existing audience path), and the suppression suggestions list with evidence + per-channel batch apply.
- **Audience builder:** `Engagement Score` (number) and `Predictive Segment` (select with the rule-based-estimate labels) conditions for both entities.
- **Composer:** holdout percentage input with the determinism note; preview shows the held-out count; the broadcast report panel shows the holdout section.
- **Settings:** the five MX11 thresholds in the Consent settings form (the form PATCHes the whole settings object, as before — the GET view now includes the new fields, and `applySettingsView` merges them).

---

## NOT BUILT (with reasons / evidence)
- **Stored score / score history / trend** — deliberately not built: the RFM precedent is computed-on-read, and no surface in the plan asks for score-over-time. A stored copy would introduce exactly the staleness the honesty rules forbid claiming away.
- **Per-recipient (contact-local) thresholds or per-channel scores** — thresholds are org-level (MessagingSetting, one row per org — the established pattern). A per-channel score would need per-channel normalization the data cannot honestly support (SMS has no open/delivered signals at all).
- **Journey/workflow holdout** — MX11's holdout is a *broadcast* comparison tool (the requirement's seam is the broadcast prepare/resolve path, beside A/B). Workflow sends share `MessageDelivery` but have no prepare step or A/B seam; not built, not implied.
- **Suppression suggestions for csv/test recipients** — they have no entity id or persistent contact row to suppress through the preference store by contact; the apply path works on real customer/lead rows only. (A csv address can still be opted out manually via the existing preference tools.)
- **NL draft via the dev-template provider** — refused honestly with a 502 (see item 3): there is no fact-assembly analogue for audience rules, and presenting template output as an AI rule draft would be fabrication.
- **Messenger broadcast / payment links / AI auto-send or auto-suppress** — excluded by standing rules; untouched. The AI draft path creates nothing, ever.

## Deviations
- The NL segment draft records its AI usage record when the provider call *completes*, including when the returned rule then fails validation — the draft (valid or not) is the completed call's product and is returned to the user. This follows the MS9 "one record per completed call" rule; kill-switch/cap rejections still record nothing (they happen before the provider).

## Scoped gates run (serial, this worker)
- MX11 spec: `mx11-intelligence.spec.ts` — **26/26 pass**.
- Full messaging + inbox spec folders (`jest src/messaging src/inbox --runInBand`, workspace cache dir): **80 suites / 990 tests pass** (MX10's final baseline was 79/964; +1 suite / +26 tests is exactly MX11).
- API tsc (`tsc --noEmit -p tsconfig.json` in apps/api): **clean**.
- Web tsc (`tsc --noEmit` in apps/web): **clean**. Web vitest scoped: `src/lib/sms-segments.test.ts` 5/5 (no messaging-page vitest exists; full web vitest is the coordinator's gate).
- `prisma validate` (packages/db schema, with a placeholder `DATABASE_URL` for the CLI): **valid**.
- NOT run (coordinator's gates, per assignment): full repo jest, fresh-Postgres migrate deploy (migration union will then be 221).

## Live-proof note
No live provider proof (M30 still owed): the NL draft with a real LLM, the score against a real org's delivery history, and a real holdout send are code+spec proven only.
