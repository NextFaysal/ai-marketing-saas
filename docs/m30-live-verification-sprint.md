# Milestone 30 — Owner Live-Verification Sprint Guide

Purpose: close the live-verification checklist (sections 0–22) with
real accounts, one session at a time. Every item is ticked ONLY on
the stated evidence — a clicked button is not evidence. Software
side is ready for every session; each session needs only the
owner's accounts listed in it.

How credentials change hands: the owner types them into the app's
own connect forms (every integration verifies against the real
platform BEFORE saving, and secrets are stored AES-256-GCM
encrypted and never displayed again). Never paste raw keys into
chat. Sessions run either on the owner's deployment (preferred —
see the deployment runbook) or in a scheduled sandbox window.

## Already closed without owner accounts (evidence on file)
- Base system on real PostgreSQL; webchat widget end-to-end;
  courier auth boundaries (Steadfast / Pathao prod / RedX each
  returned their own credential error; nothing was saved);
  CAPI honest refusal without a token; public report link without
  login; M22–M24 and M32 boundary validations.
- Pathao SANDBOX E2E: attempted 2026-10-10 twice (delivery day and
  again in the evening) through the app's own connect flow with
  Pathao's published sandbox test credentials — the sandbox host
  itself returns Cloudflare 522 (origin down), confirmed by direct
  request as well. The flow is ready; it closes the day Pathao's
  sandbox is back, or immediately with production credentials
  (Session 6).

## Session 1 — WooCommerce (owner item 1) · ~30 min
Bring: a WooCommerce store + REST API keys (read/write) from
WP Admin → WooCommerce → Settings → Advanced → REST API.
Do: connect from Integrations (keys verified live before saving)
→ sync products → sync orders → add tracker.js per the
Attribution page snippet → place a real test order on the store
with UTM parameters.
Pass evidence: Sync Jobs COMPLETED with counts matching the
store; the test order appears in Orders; a chat order for a
Woo-sourced product shows its Woo push outcome (synced).

## Session 2 — Meta core (items 2, 3) · ~45 min
Bring: a Meta app (developers.facebook.com) + a user/system token
with ads_read.
Do: connect Meta in Integrations → connect the ad account → run
insights sync (30d) → run ad-level + breakdown syncs (incl.
device/region/hourly) → provide an Ad Library token and run one
competitor scan.
Pass evidence: DailyAdMetric rows match Ads Manager totals for a
known day; Analytics shows real campaign rows (platform and
first-party numbers kept separate); competitor ads listed with
source URLs.

## Session 3 — Meta publishing + CAPI (items 3, 13) · ~60 min
Needs: token upgraded with ads_management (App Review may gate
this — start the review early; it is the longest pole).
Do: build a tiny-budget plan → approve → publish (PAUSED) →
activate briefly → edit a live ad-set budget → edit a schedule →
sync object statuses (include one deliberately non-compliant ad
to see DISAPPROVED surface) → run a dayparting job cycle →
instantiate the Advantage+ blueprint and publish it (budget on
the campaign) → save the real CAPI dataset id + token, send a test
event, place a COD order and confirm the Purchase event.
Pass evidence: Meta ids on every object; Ads Manager shows the
same statuses/budgets; Events Manager shows the test + Purchase
events with matching event ids (dedupe with the pixel).

## Session 4 — Inbox & messaging (item 4) · ~45 min
Bring: WhatsApp Business number + Facebook Page on the same app;
subscribe the app to the page's `leadgen` webhook field.
Do: connect messaging → send real WhatsApp + Messenger messages
→ reply with text/image/voice → intent + auto-reply (draft mode)
on a real "দাম কত?" → COD confirmation from a chat order →
template broadcast to a small real list → run a tiny CTWA ad and
message from it → submit a Lead Ad form.
Pass evidence: messages land in the 3-pane inbox with intent
labels; sends show real platform message ids; CTWA report counts
the chat against the ad; the lead appears in CRM with its form
answers.

## Session 5 — LLM provider (item 5) · ~20 min + decision
Decide ONE provider (OpenAI / Anthropic / Gemini) and bring its
API key. Since Milestone 33 the key is entered in the Admin
Console (Settings -> Dynamic Platform Config -> AI/LLM) — no
server env needed — and the built-in Test button performs a real
completion before the session starts.
Do: generate a daily report → ask the AI chat three data
questions → translate one thread → summarize one thread → send a
payment screenshot in a chat → transcribe one voice note.
Pass evidence: answers cite the org's real numbers (the chat is
read-only by design); vision verdict written as an internal note
(never auto-paid); transcript stored with its provider name.

## Session 6 — Couriers in production (items 6, 7, 8) · ~45 min
Bring: Steadfast key+secret (portal.packzy.com), Pathao merchant
API credentials (merchant.pathao.com → Developer API), RedX
access token (merchant.redx.com.bd).
Do per provider: connect (verified against the real API before
saving) → book ONE real order → sync status → confirm the
customer got the chat notification.
Pass evidence: consignment/tracking ids on the shipments;
provider status reflected in the shared vocabulary; Pathao
delivery fee shown from the booking response.

## Session 7 — Google Ads (item 9) · ~45 min
Bring: APPROVED developer token + OAuth client + refresh token.
Do: connect → sync insights → publish one Search campaign WITH
keywords/sitelinks → publish one Performance Max campaign →
place an order carrying a real gclid and run the offline
conversion upload.
Pass evidence: campaign-level rows match Google Ads for a known
day; both publications read created_paused with ids; the Search
campaign shows its keywords in Google Ads; the offline conversion
appears in Google Ads (allow its normal reporting delay).

## Session 8 — TikTok (item 10) · ~30 min
Bring: TikTok Marketing API app + advertiser token + an Events
API pixel code.
Do: connect → sync → publish one image campaign and one VIDEO
campaign → fire a CompletePayment via an order with a ttclid.
Pass evidence: rows match TikTok reporting; both publications
created_paused (video ad shows the returned video id); the event
appears in TikTok Events Manager.

## Session 9 — Shopify (item 11) · ~30 min
Bring: a custom app (read_products/read_orders) token + secret.
Do: connect → sync products/orders → register webhooks → place a
store order and watch it arrive by webhook.
Pass evidence: sync counts match the store; webhook order lands
without a manual sync.

## Session 10 — Email & SMS (item 12) · ~30 min
Bring: SMTP credentials; SSL Wireless account with balance and
an approved sender id.
Do: send a broadcast email to a small real list → send an SMS
broadcast → run the "new order ≥ 1000 → thank-you email"
workflow with a qualifying order.
Pass evidence: per-recipient delivery rows show the gateways'
own message ids; the workflow run is logged end to end.

## Closing the sprint
When a session passes, its checklist boxes are ticked in
`docs/live-verification-checklist.md` with the date and the
evidence summary, and the outcome is recorded in the milestone
log. Items a platform refuses (e.g. App Review pending) stay
open with the refusal quoted — they are never ticked on intent.
The sprint can run in any order after Session 2 (Meta gates the
most), and Session 5 (LLM) is independent of all others.
