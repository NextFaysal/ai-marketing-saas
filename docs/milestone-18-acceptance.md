# Milestone 18 Acceptance — Phase G: Signal & Measurement

Delivered 2026-10-10 on the owner's approval of the advertising
review (`docs/advertising-review.md`). Schema: 70 -> 74 models
(ConversionApiSetting, ConversionEventLog, DailyAdBreakdown + fields).
Migration `20261010180000_m18_phase_g` applied.

## Delivered

**G1. Meta Conversions API** (`apps/api/src/conversions/`)
- Per-org settings: dataset/pixel id, optional dedicated CAPI token
  (AES-GCM; otherwise the Meta Ads integration token is used),
  test event code, purchase trigger, enabled flag, lead-event flag.
- Purchase events from REAL orders on the configured trigger:
  placed (order.created), cod_confirmed (the M13 chat-confirmation
  event), delivered (store sync reaching status completed).
  Lead events from lead.created. Payloads: SHA-256 hashed email /
  phone (BD numbers normalized to 880...), external_id, value in
  major units, SKUs, num_items; best-effort fbc rebuilt from our own
  tracker touchpoints.
- Success discipline: a log row is "sent" ONLY when Meta answers
  events_received >= 1; failures are logged with Meta's error.
  One Purchase per order, enforced by a unique (org, eventId) log.
  event_id = `purchase-<order number>`; tracker.js now fires the
  browser pixel event with the SAME event id when fbq exists, so
  browser + server deduplicate at Meta.
- Test events: a real call using the org's test_event_code; the log
  and UI live on the Ad Accounts page with the last 10 events.

**G2. Ad-level insights** — Meta sync at level=ad into DailyAdMetric
(ad/adset ids + names, reach, video views from video_view actions).
Frequency is computed at read (impressions/reach), never stored as
a float. `GET ad-metrics` aggregates per ad with CTR/CPA; Analytics
shows the Creative Performance table. The metric unique key now
includes ad set/ad ids so campaign rows (empty ids) coexist.

**G3. Breakdowns** — DailyAdBreakdown sync for age,gender and
publisher_platform,platform_position from the insights API's own
breakdown values; `GET breakdowns` aggregates; two panels in
Analytics (top 8 by spend).

**G4. Attribution window setting** — Organization.attributionWindowDays
(7/14/30/60/90, validated); reconcile/report resolve the org setting
by default; Attribution page has the window selector (applies to new
reconciles; the UI says so honestly).

## Verification
- API tests 242 pass (9 new: hashing, purchase flow + dedupe +
  trigger gating + zero-received failure + cancelled skip + test
  code requirement, ad normalize + client level, window validation);
  the M5 ads spec fake was updated to the extended metric key.
- Live (fresh sandbox DB after a VM replacement wiped Postgres —
  reinstalled, all 18 migrations + seed re-applied): CAPI settings
  roundtrip; test event without any Meta token returns an honest
  400 explaining the missing token (nothing faked); attribution
  window roundtrip 14 -> back to 30; ad-metrics/breakdowns return
  honest empty arrays before any sync.
- Demo org re-seeded and re-configured (bot on, delivery 60 BDT,
  auto-reply draft, round-robin, CAPI settings saved with trigger
  cod_confirmed — informational only, no token connected).

## Limitations
- CAPI can only be fully live-verified with the owner's dataset id +
  token; purchase events fire only from wired producers (store sync,
  chat orders, COD confirm, delivery status) — CSV/manual orders do
  not emit order.created and are not sent (honest gap, documented).
- Ad-level sync covers Meta only (Google/TikTok stay campaign-level).
- Breakdown sync is a separate explicit action, not yet scheduled.
