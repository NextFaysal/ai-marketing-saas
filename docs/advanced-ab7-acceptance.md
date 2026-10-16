# AB7 (AX15–AX20) — Growth & Intelligence — Acceptance

Batch AB7 of the E-Commerce Advanced Program, built on branch
`completion` (base `83e7444`, AB6 HEAD). LOCAL COMMITS ONLY — no
push. Migration `20261017070000_ab7_growth_intelligence`
(additive only: 6 new tables + 7 nullable Order columns) has NOT
run on any real DB — sandbox fresh-DB proof only (see Gates).

## Commits (9)

| Commit | Content |
|---|---|
| `4ff8a4e` | Foundation: schema + migration + `web-push` dep (coordinator) |
| `701110e` | AX17 social-proof feed + settings (API) |
| `b40cde5` | Dashboard web surfaces (AX15–AX20) |
| `e1bd7a0` | AX15 AI review insights (API) |
| `502f683` | AX20 forecasting v2 + landing significance |
| `51bddde` | AX16 web push (API + sweep job) + app.module wiring (Webpush + SocialProof modules) |
| `ee22436` | AX18 recovery coupon workflow action + 3-step preset + sequence state |
| `c7cdb7e` | AX19 order attribution stamps + source breakdown |
| `2f5ff8f` | Shop web surfaces (AI box, push prompt + worker, social proof, attribution capture) |

Process note (honest): two daemon restarts killed the original
AX16/AX18/AX19/shop-web workers and one round of finishers. The
surviving partial work was audited hunk-by-hunk against the
briefs by the coordinator (the "stray" edits in integrations /
products turned out to be AX19's own upsertOrder choke +
single-product DTO threading), its specs were run, and the
coordinator landed the commits + central wiring + full gates.

## AX15 — AI review insights ✅

- `ProductReviewInsight` (unique org+product): summaryText,
  sentimentJson {positive, neutral, negative, total},
  themesJson (≤5), reviewCountAtGeneration, generatedAt,
  generatedById, modelLabel.
- STAFF-triggered only (`POST .../products/:productId/
  review-insight/generate`, OWNER/ADMIN/MARKETING_MANAGER/
  SUPPORT_AGENT). Collects the product's OWN visible reviews
  with rating + received + text (mirrors ProductReviewsService's
  own-review selection; external reviews never included),
  latest 100.
- LLM via the proposals.service path (LlmFactory +
  providerForOrg, jsonMode). No real LLM → the refusal is
  surfaced verbatim: "LLM কনফিগার করা নেই — AI সারসংক্ষেপ
  উপলব্ধ নয়". LLM/parse failure writes NOTHING — a previous
  insight stays intact.
- Count basis is ONE consistent set (visible + rated + received
  + text) for reviewCountAtGeneration, sentiment total, and the
  staff GET's currentReviewCount; staleness =
  max(0, current − atGeneration); the panel badges at ≥ 10
  ("নতুন রিভিউ এসেছে — আবার তৈরি করুন"). No automatic LLM
  spend, ever. LLM counts over the total are scaled down
  proportionally (floored); summary capped 1200 chars; themes
  trimmed, ≤5 × ≤80 chars.
- AIUsageRecord written mirroring chat.service (feature
  "review_insight"; provider tokens when exposed, else
  estimated=true/0), failure-isolated. Generation audited
  (`product_review_insight.generate`).
- Public: `GET public/shop/:orgSlug/products/:productSlug/
  review-insight` → the insight payload or `{ insight: null }`
  (200); PDP renders the labelled box ("ক্রেতাদের রিভিউ থেকে
  তৈরি AI সারসংক্ষেপ" + date + sentiment bar + themes) only
  when an insight exists. generatedById/model never leak to the
  public payload (spec-pinned).

## AX16 — Web push for shop visitors ✅ (BUILD — dependency landed)

- `web-push` 3.6.7 + `@types/web-push` installed in @repo/api
  (sandbox install needed a lockfile group fix: the userns
  cannot chown to the unmapped `nogroup` gid — `root:root` on
  the lockfile unblocked pnpm).
- `ShopPushSetting`: VAPID keypair generated ONCE on first
  enable (never regenerated), private key sealed via
  common/platform-config `seal`; enabled default FALSE.
- Public: push-config (key hidden when disabled),
  push-subscribe (https endpoint validated; disabled shop →
  403; upsert by org+endpoint; foreign customerId dropped to
  null), push-unsubscribe (marks "gone", idempotent — the row
  is kept because deliveries reference it).
- Staff: setting GET/PUT (audited), test-device registration,
  test-send (real campaign row, test devices only), campaigns:
  create → inline fan-out ≤ 500 active subscriptions, remainder
  = queuedCount; list + detail (foreign → 404). Campaign URL:
  shop-relative only. VAPID subject =
  `process.env.WEB_PUSH_SUBJECT ?? "https://app.qosprey.com"`.
- Sends: payload {title, body, url}, TTL 86400; success → sent
  + push-service statusCode; 404/410 → subscription AND
  delivery "gone" (never retried); other errors → failed
  (message ≤300 chars); one failure never aborts a batch.
- Sweep: job `web_push_sweep` (JOB_TYPES + template +
  executeJob case; AutomationModule imports WebpushModule,
  service injected @Optional LAST) drains queued campaigns —
  ≤5 campaigns/run, ≤500 deliveries each — via the same
  drainCampaign() (skips subscriptions that already hold a
  delivery row for the campaign). **Per-org enablement required
  at deploy.**
- Web: worker served by a route handler at `/shop-push-sw`
  with `Service-Worker-Allowed: /shop/` + JS content type,
  registered with scope "/shop/" — it coexists with the
  dashboard PWA worker (root scope, caching) because scopes
  differ and the shop worker has NO caching duties; push
  prompts therefore live on shop surfaces only (documented in
  the component). Prompt: after promptDelaySec, permission
  flow, subscribe, POST push-subscribe; dismiss remembered 30
  days (localStorage); every failure silent.
- Dashboard composer copy is honest: "পুশ সার্ভিস গ্রহণ
  করেছে" — no read/open claims anywhere.

## AX17 — Social-proof popups (REAL orders only) ✅

- `SocialProofSetting` (enabled default FALSE, lookbackHours
  24 [1–168], intervalSec 25, displaySec 6, maxPerSession 5,
  minTotalMinor nullable BigInt) + staff GET/PUT (guarded,
  audited, ranges re-validated in the service).
- Public feed `GET public/shop/:orgSlug/social-proof`:
  disabled → exactly `{ enabled: false }`; enabled → config +
  up to 10 items, newest first, from the canonical sold set
  (`isSoldOrder` from storefront/ec27-discovery — no new
  status set invented) within the lookback window.
- Item keys are EXACTLY { buyerFirstName, district,
  productName, hoursAgo } (spec asserts the key set):
  first name = first whitespace token of Customer.firstName
  only; district = structured Customer.address.district, else
  parseBdAddress (high/medium confidence only) over address
  text — null when unknown, never guessed; productName =
  first item's snapshot name; hoursAgo = integer bucket.
  NO amounts (privacy choice — totals are never shown), NO
  order numbers/ids, NO phone. Feed-build failure after slug
  resolution degrades to empty items, never a 500.
- Impressions: a DEDICATED lightweight counter endpoint
  (POST .../social-proof/impression, rate-limited) increments
  SocialProofSetting.impressions only when a row exists —
  chosen over the GC1 popup-event recorder because that
  counter belongs to the StorePopup model/kinds; posture
  mirrors recordPopupEvent (always { ok: true }).
- Shop component: theme-aware, bottom-left, dismissible,
  sessionStorage session cap, pauses when the tab is hidden.
  Settings UI carries the verbatim line: "এখানে শুধুমাত্র
  আপনার দোকানের আসল অর্ডার দেখানো হয় — ভুয়া বা সাজানো
  প্রমাণ তৈরি করা হয় না।"

## AX18 — Multi-step cart recovery ✅

- Workflow action `issue_recovery_coupon` (workflows.service):
  in STEP_TYPES; validation requires templateId (mirror of
  send steps); dry-run detail line added.
- Exactly-once: **the step identity decision** — workflow
  steps carry no id field, so the step is identified by
  POSITION (top-level index, or `i.then.s` inside a branch
  arm — executeStep now receives a stepRef). Position is
  stable across resumes because runs execute their frozen
  stepsSnapshot and resume continues at nextStepIndex. Before
  issuing, the action queries StoreDiscount for origin
  "abandoned_recovery" + sourceRef `wf:{runId}:{stepRef}` and
  reuses the code on a hit (crash-between-create-and-log
  safe); a reused coupon's validity line uses REMAINING hours
  from endsAt. The shared EC10 method does NOT dedupe by
  sourceRef (its call sites pass checkout/cart ids and guard
  with audit markers), so the pre-check lives in the action,
  keyed on the wf: ref — EC10 behaviour unchanged.
- **Send plumbing decision (merged):** issuance goes through
  AbandonedCheckoutsService.issueRecoveryCoupon (the GB7
  method, made public; respects AbandonedCouponSetting —
  disabled/failed → null). Null → StepSkippedError → stepsLog
  status "skipped", run CONTINUES (never fails the run);
  missing DI wiring also skips honestly. On a code, ONE
  message is sent through the send branch's own machinery
  (template lookup → resolveRecipient on the run context →
  MessagingService.sendToRecipient; the TEMPLATE's channel
  decides email/SMS): body = rendered template + EC10-format
  coupon lines appended, AND `couponCode` is passed as a
  template variable (vars = { ...context, couponCode } — the
  code wins over any stray context key), so templates
  authored with {{couponCode}} also work. Send-outcome
  discipline mirrors send_sms (opt-out = skip, other non-sent
  = step failure). The full code appears in the staff-only
  stepsLog detail (EC10 precedent: staff can already see
  issued recovery codes).
- DI: WorkflowsService takes AbandonedCheckoutsService
  @Optional LAST (MS8/MS9 constructor precedent);
  WorkflowsModule imports CommerceModule (commerce never
  imports workflows — no cycle); CommerceModule exports the
  service.
- Preset `cart_recovery_3step` in JOURNEY_PRESETS beside
  `cart_recovery`: wait 60 → send_sms → wait 1380 (23h) →
  issue_recovery_coupon → wait 2880 (48h) → send_sms (≈72h
  total). Template body deliberately has NO coupon code (the
  coupon step composes its own message). Installs DISABLED
  via the existing installer — installing is the merchant's
  act. The ms8-bridge preset-catalogue spec was updated for
  the sixth preset (count assertions only).
- EC10 sequence state: `GET organizations/:organizationId/
  abandoned-checkouts/:checkoutId/sequence` (canonical route
  via AbandonedSequenceController — CommerceController's
  prefix is .../commerce, so the canonical path lives in its
  own controller class with identical guards; commerce-prefixed
  aliases also registered). Depth achieved: the service
  resolves the checkout (AbandonedStoreCheckout or StoreCart,
  org-scoped, else 404), scans the org's latest 200
  WorkflowRuns, and matches by run context keys (checkoutId /
  cartId / abandonedCheckoutId / externalCheckoutId) —
  returning enrolment, workflow name, run status, current
  step index, the stepsLog entries, and last activity; no
  match → { enrolled: false }.

## AX19 — Order-level attribution stamps ✅

- `AttributionDto` + `normalizeAttribution` (common/
  attribution.dto.ts): utm* trimmed ≤200, clickIdType ∈
  fbclid|gclid|ttclid, clickId ≤500; normalizer drops
  empty/whitespace to ABSENT keys (columns stay null).
- Threading: `attribution?` on shop CheckoutDto +
  ExpressCheckoutDto, single-product PublicCheckoutOrderDto
  (products), LandingOrderDto (inherits it). The **choke is
  the ONE order door**: each placement spreads the normalized
  block into the upsertOrder input (NormalizedOrder carries
  the fields), and IntegrationsService.upsertOrder stamps
  them on the CREATE branch ONLY — a re-upsert never rewrites
  the placement-time record. POS / manual / external sync
  pass nothing → null = untracked.
- Staff order payloads (pubOrder) expose utmSource +
  clickIdType (the raw clickId and full UTM set stay on the
  row only).
- ON9 "বিক্রির উৎস": `GET organizations/:organizationId/
  commerce/analytics/sources?days=` — sold orders (this
  service's revenue definition: status ∉ cancelled/refunded/
  failed, Dhaka-day window on placedAt ?? createdAt) grouped
  by (utmSource ?? "সরাসরি/অজানা") with orders +
  revenueMinor (BigInt-safe string), revenue-desc; totals
  { orders, revenueMinor, withClickId, stampedOrders }. The
  attribution ENGINE (src/attribution/) is untouched
  (verified by diff) and remains the multi-touch system; the
  stamps are the order-level record (commented in code +
  dashboard note).
- Web capture: the first-party tracker (public/tracker.js)
  already stores the session's UTM/click-id values in
  sessionStorage `tp_sess`; `getAttributionForCheckout()`
  parses it (first click id wins, fbclid → gclid → ttclid;
  first-touch = first write wins and is never overwritten).
  Honest scope: sessionStorage means "first touch" is per
  browser SESSION — no durable cross-session first-touch
  store exists, and none was fabricated. The shop checkout,
  landing, and single-product submit sites attach
  `attribution` only when the helper returns ≥1 field.

## AX20 — Forecasting v2 + A/B significance ✅

Formulas as built (header comment in
inventory-intelligence.service.ts; all from the existing
single sold-order scan, in-memory per row — no per-row
queries; v1 fields byte-identical in behaviour):

- Windows: last-30 `t ∈ [now−30d, now]` (matches v1),
  prior-30 `[now−60d, now−30d)`, last-90 for the weekday
  profile. vel30/velPrior are units/day.
- `trendGrowthPct = (vel30 − velPrior)/velPrior × 100`
  (1-decimal); **null when velPrior = 0** (incl. both-zero).
- `weekdayFactors[w]` (w = JS getDay(), 0 = Sunday):
  raw = (units on w ÷ occurrences of w in 90d) ÷ (90d units
  ÷ 90), then divided by their mean (mean ≈ 1). Requires
  ≥21 DISTINCT sales days in 90d, else all 1.0.
- `trendFactor = velPrior > 0 ? clamp(vel30/velPrior, 0.5,
  2.0) : 1`. `projectedDailyDemand = vel30 × trendFactor ×
  (mean factor over the next 7 calendar days)` (3-decimals;
  0 when vel30 = 0). Note: any 7 consecutive days contain each
  weekday once, so the next-7 factor mean is ~1 by
  construction — the projection is effectively trend-driven,
  stated as built.
- Stockout v2: day-by-day simulation from tomorrow
  subtracting `vel30 × trendFactor × factor[weekday]`; first
  day cumulative ≥ stock wins; 365-day cap → nulls; stock ≤ 0
  with vel30 > 0 → 0 / now (mirrors v1); vel30 = 0 → nulls.
- `demandBasis`: "trend_seasonal" when ≥21 distinct
  sales-days exist, else "velocity".
- Dashboard shows basis badge, trend with +/− colouring, v2
  date primary with v1 secondary when they differ, and the
  verbatim note "পরিসংখ্যানভিত্তিক অনুমান — নিশ্চয়তা নয়".

Landings significance (landings/significance.ts, pure):
- `twoProportionZTest(x1, n1, x2, n2)` — pooled SE, two-sided
  p via the Abramowitz–Stegun 26.2.17 normal CDF. Guards:
  n = 0, pooled p ∈ {0,1}, or SE = 0 → { z: 0, pValue: 1 };
  exactly-equal rates short-circuit to p = 1.
- **Control = the variant with the most views** (ties →
  earliest created; independent of the serving isControl
  flag). Control's own vsControl = null. Conversions reuse
  the existing stats definition (orders by landingVariantId ÷
  variant view events); serving/weights untouched.
- `vsControl`: significant = p < 0.05 AND both sides ≥ 30
  views; if either side < 30 views → { pValue: null,
  significant: false, note: "insufficient_data" } (the p is
  NOT computed/reported on insufficient data).
- `winnerId`: the highest-conversionRate DISTINGUISHABLE
  variant — a non-control qualifies when significant with
  rate > control's; the control qualifies when a rival is
  significant with a lower rate and control holds the top
  rate; otherwise null. Display only — NO auto-switching
  anywhere (plan exclusion); dashboard shows conversion-rate
  column, "তাৎপর্যপূর্ণ" marker (p on hover), "বিজয়ী"
  badge, "পর্যাপ্ত ডেটা নেই".
- Known-value specs: 50/1000 vs 30/1000 → z ≈ 2.2822,
  p ≈ 0.0225 (significant); 40/1000 vs 30/1000 → z ≈ 1.2167,
  p ≈ 0.2237 (not significant); Φ(0) = 0.5, Φ(1.96) ≈ 0.975.

## Gates (coordinator-run, exit-code checked)

| Gate | Result |
|---|---|
| API jest (5 chunks, --runInBand, workspace-disk cache) | **396 suites / 4,441 tests — ALL PASS** (baseline 388/4311 → +8 suites / +130 tests = exactly the 8 new AB7 spec suites: review-insights 10, social-proof 19, webpush + recovery-action 34, attribution + sequence 28, forecast 9, significance 15, + neighbours) |
| API tsc --noEmit | exit 0 |
| Web vitest | **64 files / 524 tests — ALL PASS** (baseline 469 → +55) |
| Web tsc --noEmit | exit 0 |
| Full build `pnpm -r build` | exit 0 (7/7 incl. both Next builds) |
| prisma validate | exit 0 (DATABASE_URL dummy) |
| Fresh-DB (PostgreSQL 16, throwaway cluster, dropped after) | **180/180 migrations applied clean**, 278 public tables (AB6: 272 → +6 AB7 tables, all verified present by name); Order carries all 7 attribution columns; AB7-object migrate-diff drift = 0 lines |

Known flake posture: none of the AB7 chunks flaked. One
chunk-3 rerun was needed for an environment reason only —
/tmp (512MB tmpfs) filled up (ENOSPC in jest's haste map);
caches were moved to workspace disk and the chunk passed in
full. The cx3/inbox flake named in the brief did not appear.

## Deploy notes

- Run migration `20261017070000_ab7_growth_intelligence` on
  the real DB (it has run ONLY on sandbox fresh Postgres).
- Enable the per-org job `web_push_sweep` for orgs that will
  send push campaigns beyond the 500-subscriber inline chunk.
- `WEB_PUSH_SUBJECT` env may override the VAPID subject
  (default https://app.qosprey.com).

## Honest limits

- **No live proof of anything in AB7** (standing M30 debt):
  no real LLM generation (stubbed-provider specs only — in
  production the generate button refuses honestly until the
  org configures an LLM), no real browser push subscription
  or delivery (web-push module mocked in specs; VAPID +
  fan-out logic is spec-proven only), no live workflow run of
  the 3-step preset, no live checkout stamped (spec-level
  choke proof).
- AX15 counts only reviews with text (rating-only reviews are
  not summarizable and are excluded from the count basis by
  design, documented in code).
- AX16: subscriptions gathered on the dashboard origin can
  register only as staff test devices; shop-visitor prompts
  work on shop surfaces under the /shop/ worker scope — a
  merchant whose shop is served outside /shop/ paths gets no
  prompt (scope is a web-platform constraint, documented).
- AX17: the impression counter is a public increment (same
  posture as GC1 popup impressions) — a vanity metric, not a
  security boundary.
- AX18: sequence state matches runs by context keys over the
  org's latest 200 runs — older enrolments fall off the scan
  window and report as not enrolled.
- AX19: attribution is first-touch per browser session
  (sessionStorage) — cross-session/cross-device journeys are
  the attribution engine's job, not the stamps'.
- AX20: weekday bucketing uses local calendar days; the
  statistics are deterministic estimates, labelled as such —
  no ML is claimed anywhere.
