# Campaign Builder Frontier NB6 — Acceptance (CN13 + CN14)

Branch `campaign-next`, base NB5 close `330ce80`. Built to the
Frontier plan
(`~/workspace/goals/ai-marketing-saas-platform-build/files/Campaign-Builder-Frontier-Plan-2026-10-15.md`,
NB6 section). Local commits only — **no push** (owner-gated).
The batch was recovered by a finisher after the original
coordinator died in a daemon restart: its two commits
(schema + API core) were on disk, its service/spec tail was
uncommitted. The finisher inspected everything, finished the
specs, proved the trigger wiring, built the missing web
surfaces, and ran the closing gates serially.

## Commits

| Commit | Content |
| --- | --- |
| `3910aaa` | NB6 schema — migration `20261013910000_cn13_cn14_frontier` (additive): `CampaignAdSet.destinationType / whatsappIntegrationId / whatsappPhoneNumberId / whatsappPhoneNumber`, `CampaignAd.whatsappWelcome`, `OfflineConversionSetting.datasetId / leadFeedbackEnabled` |
| `3a23410` | NB6 API core — CN13 CTWA destination validation + publish payload + readiness + conversation reporting; CN14 Meta offline upload (dataset CAPI) + dedup, meta in the trigger loop, lead-quality feedback on `lead.stage_changed` |
| `e17ad6b` | CN13 specs (13 tests) + `updateAdSet` clearing consistency (clearing the destination clears the number binding with it). One spec regex aligned to the real CN3 matrix message — the refusal behaviour was already correct, the expected string was not |
| `a00e164` | CN14 specs (12 tests): meta upload + both dedup layers, trigger wiring, failure isolation, lead feedback send/no-send gates |
| `9263c5e` | Web: builder CTWA destination picker + welcome editor + conversation reporting; ad-accounts Meta offline-conversions surface |
| (this doc) | NB6 acceptance |

## CN13 — Click-to-WhatsApp Ads (real CTWA)

**Spike verdict: CONFIRMED, with one correction to the plan.**
Basis: Meta's "Ads that click to WhatsApp" developer guide
(developers.facebook.com, updated 2026-05-21). The guide's
destination value is `destination_type: "WHATSAPP"` — **not**
`ON_WHATSAPP` as the plan's draft wording guessed. Confirmed
shapes, all implemented as documented:

- Ad set: `destination_type "WHATSAPP"`, `promoted_object
  { page_id (required), whatsapp_phone_number (optional) }`,
  per-objective optimization-goal table (ENGAGEMENT /
  LEADS / SALES / TRAFFIC). `POST_ENGAGEMENT` is outside
  this builder's goal vocabulary and `OFFSITE_CONVERSIONS`
  is excluded deliberately: the guide's WhatsApp
  promoted_object carries no pixel fields, so WhatsApp
  Sales here optimizes on CONVERSATIONS and measures
  outcomes through CN14's feedback loop instead.
- Creative: link-data with link
  `https://api.whatsapp.com/send`, CTA `WHATSAPP_MESSAGE`
  with `app_destination "WHATSAPP"`, and the optional
  `page_welcome_message` (VISUAL_EDITOR v2 text_format:
  `autofill_message` with prefill, or `ice_breakers` —
  max 3, prefill dropped when ice-breakers are present).

Shipped:

- The ad set binds to one of the org's **CONNECTED WhatsApp
  Integrations** (`GET …/campaign-plans/whatsapp-destinations`
  lists them without secrets). The number is never
  client-supplied: at save time the service verifies the
  Integration row (exists, org-owned, CONNECTED) and reads
  the display digits back from Meta with the connection's
  own token. Digits Meta will not return store **null** —
  never invented — and publish then omits the optional
  `whatsapp_phone_number`, so Meta uses the Page-linked
  number; the publish log (`whatsapp_destination` step)
  states which of the two happened.
- Save-time matrix (shared by add + update + validatePlan):
  destination⇔number binding, objective × goal table,
  page required, and hard conflicts with catalog / lead
  form / pixel conversionEvent. Video ads on a WhatsApp
  set are a validation error (CTWA creative here is a
  link creative).
- Readiness: a `whatsapp` check — ok when the bound
  connection is CONNECTED, **error** (plan not ready)
  when it dropped or was removed.
- Reporting: `GET …/:planId/whatsapp-conversations` counts
  conversations per ad from the EXISTING inbox referral
  capture (`Conversation.ctwaSourceId` = Meta ad id),
  labelled verbatim: conversations **STARTED**, matched by
  first-message referral — not messages, not unique
  people; only webhook-stored conversations count.
- The old `wa.me` blueprint remains what it always was —
  a plain link ad — and is not presented as CTWA anywhere.
- Web: destination + connection pickers in the ad-set add
  and edit forms (only CONNECTED connections selectable;
  disconnected shown disabled with their status; the
  zero-connected state is an explicit red notice — connect
  WhatsApp in the Connect Center first), a CONVERSATIONS
  goal option, the Meta-read-back number on the ad-set
  summary line, an ad-level Welcome editor (greeting /
  prefill / ice-breakers) shown only on WhatsApp sets,
  and the conversation report in the performance area.

## CN14 — Conversion feedback loops

**Spike verdicts.**
(a) *Legacy Offline Conversions API: DISCONTINUED —
NO-BUILD.* Meta ended offline event-set creation in
May 2024 and the Offline Conversions API itself in
May 2025. The current documented path is the **Conversions
API to a dataset**: `POST /{dataset_id}/events` with
`action_source "system_generated"` for CRM/backend events —
the exact endpoint this codebase's `MetaCapiClient`
already speaks. Built on that path.
(b) *Lead quality: CONFIRMED.* Meta's Conversion Leads
payload specification (developers.facebook.com): a CRM
event to the dataset — `event_name` = the CRM stage,
`user_data.lead_id` carrying the leadgen id,
`custom_data` with the two required fields
`lead_event_source` and `event_source: "crm"`. Built as
documented; no export-only fallback was needed.

Shipped (all inside the EXISTING `OfflineConversionsService`
— the platform union grows to `meta`; no second system):

- **Meta order upload** (`uploadForOrder(…, "meta")`):
  system_generated `Purchase` with hashed `em` / `ph` /
  `external_id` user_data (Meta matches on customer data,
  not a click id), `custom_data` value/currency/order_id/
  num_items/content_ids. An upload counts as sent **only**
  when Meta answers `events_received >= 1` — the same
  confirmation semantics as the google/tiktok paths.
- **Dedup, two layers.** The `event_id` is the
  deterministic `purchase-{orderKey}` `ConversionsService`
  already uses. (1) This surface's own log: a prior `sent`
  returns `alreadySent`. (2) Before sending, if the org's
  Conversions API pixel **is** this dataset and its log
  holds a `sent` row under the same `event_id`, the upload
  records a named **skip** ("already delivered … under the
  same event_id") and makes zero network calls. A different
  dataset is not deduped and sends normally.
- **Honest skips, all logged:** no datasetId on the
  setting, cancelled/refunded order, and an order with no
  customer email/phone ("Meta has nothing to match … so
  nothing was sent").
- **Automatic order-lifecycle triggers — wiring verdict:
  it EXISTED in the coordinator's commits; the finisher
  verified it end-to-end and added the missing proof.**
  `OfflineConversionsService` subscribes in its constructor
  to the platform's existing domain events:
  `order.created` (emitted by the integrations upsert —
  store sync, manual orders, imports — and by inbox order
  creation), `order.cod_confirmed` (the inbox COD-confirm
  action), `order.delivered` (`OrdersService.updateOrder`
  → completed, and integrations sync). No new emit sites
  were needed and none were added. The handler is gated
  per org: feature flag → setting exists → `enabled` →
  trigger matches; disabled means **nothing is sent,
  ever**. Failure isolation is structural and now
  spec-proven: `EventsService.emit` dispatches handlers
  asynchronously and catches handler failures (logged),
  emissions happen **after** the order write completes,
  each platform upload is individually caught, and every
  outcome lands in `OfflineConversionLog`. The CN14 spec
  drives the real `OrdersService.updateOrder` with the
  upload stubbed to throw: the order reaches `completed`
  and stands, and the log records `failed`.
- **Lead quality feedback** on `lead.stage_changed`:
  fires only for stages `qualified` / `won`, only for
  Meta lead-ads leads (`source "facebook_lead_ads"`, the
  only leads carrying a lead_id Meta recognises), only
  when the meta setting is enabled **and**
  `leadFeedbackEnabled` **and** a datasetId is set.
  `event_id lead-feedback-{leadId}-{stage}` dedupes repeat
  stage events. Best-effort by construction: outcomes are
  logged, nothing ever throws back into the CRM update
  (spec-proven with a throwing network).
- **Web:** the ad-accounts "Server Conversions" card gains
  the Meta surface — Meta account picker, Dataset (Pixel)
  ID, the shared trigger select, the lead-feedback toggle
  with a current-setting readout, and a meta backfill
  button (`upload-recent` accepts `meta`). Google/TikTok
  forms untouched.

## Closing gates (all run serially by the finisher)

| Gate | Result |
| --- | --- |
| API jest `--runInBand` (full) | **338/338 suites, 3376/3376 tests, exit 0** — zero failures; the cx3-debounce flake did not appear in this run |
| CN13 / CN14 specs | 13/13 and 12/12 (inside the full run; also run solo) |
| Web vitest | **39 files, 260/260** |
| tsc (api / web) | **0 / 0** |
| Prisma validate | valid |
| Monorepo build (`pnpm -r build`) | **7/7 packages Done, exit 0** |
| Fresh Postgres 16, full sequence (`prisma migrate deploy`, throwaway DB `nb6_fresh`) | **161/161 migrations applied clean**, last = `20261013910000_cn13_cn14_frontier`; 214 public tables; all NB6 columns verified present (`CampaignAdSet` destination/whatsapp columns, `CampaignAd.whatsappWelcome`, `OfflineConversionSetting.datasetId/leadFeedbackEnabled`); throwaway instance stopped and removed after the run |

Baseline movement vs NB5 close: API +2 suites / +25 tests
(exactly CN13's 13 + CN14's 12); migrations 160 → 161;
tables unchanged at 214 (the NB6 migration is additive
columns only).

## Honest limits

- **Nothing in NB6 is live-proven.** No real Meta account
  has seen any of it: CTWA campaign creation, the
  phone-number read-back, dataset event acceptance, and
  Conversion Leads acceptance are all spec/fixture-proven
  only (stubbed Graph). Live proof joins the CN12
  checklist (owner-gated: integration of this line with
  the other tracks → owner's push instruction → Dokploy
  Redeploy → real-account sessions). If a live session
  contradicts a documented shape, the affected surface is
  the rework item — the plan's standing warning.
- Migration `20261013910000_cn13_cn14_frontier` has **NOT
  run on any real database** — fresh-Postgres proof only.
- The phone-number digits read-back uses the WhatsApp
  connection's own token against the phone-number node;
  if Meta refuses, digits stay null and publish relies on
  the Page-linked number (named in the publish log) —
  which of these a real account does is a CN12 question.
- The `page_welcome_message` VISUAL_EDITOR v2 shape is
  implemented from the guide; no real Page has accepted
  one from this code yet.
- `events_received >= 1` is Meta's acceptance bar used
  across this codebase; it confirms receipt, not eventual
  match/attribution quality inside Ads Manager.
- Conversation counts cover only conversations the
  WhatsApp webhook stored whose first message carried the
  CTWA referral (the API label says so, verbatim, in the
  UI as well).
- Approval spine untouched: CTWA plans publish PAUSED
  through the same draft → approval → publish flow; no
  auto-publish, no auto budget movement, nothing in CN14
  moves money — it reports outcomes of orders that
  already happened.
- Push remains owner-gated: this batch is local commits
  on `campaign-next` only.
