# Workflows W7 — Acceptance (Cart Recovery, AI Action, Channel Webhooks, Multi-Condition & Export/Import)

Status: **DELIVERED & VERIFIED**
(2026-10-12).

## What was built
- **Trigger `cart_abandoned`**:
  - `WORKFLOW_TRIGGERS` and `EVENT_TO_TRIGGER` (`cart.abandoned`).
  - Added `scanAbandonedCarts(now)` in the leader-claimed 5-minute background loop: derives abandoned carts via `deriveAbandonedCarts(events, now)` from the last 7 days of tracking events (`add_to_cart`, `checkout_started`, `purchase`), deduped so each cart fires once in 24 hours.
  - Enriches context with `cartValue`, `itemsCount`, `itemsSummary`, `visitorId`, and contact info (`contactEmail`, `contactPhone`, `contactName`), so messages and emails can target the shopper directly.
  - Added to web triggers and form condition fields (`cartValue`, `itemsCount`).
- **Action `notify_channel`**:
  - Real-time webhook alerting for Slack (`{ text }`), Discord (`{ content }`), and custom HTTPS endpoints with security guards (`isBlockedWebhookHost` against SSRF/private IPs, HTTPS only, 10s timeout).
- **Action `ai_generate`**:
  - LLM-backed dynamic text and note generation via `LlmFactory` (OpenAI / Anthropic / Gemini with graceful fallback).
  - Configurable destination: direct conversation internal note, lead activity note, or stored into context (e.g. `{{aiResult}}`) for subsequent SMS/Email steps.
- **Multi-Condition Form Builder**:
  - Replaced the single-condition form restriction with a flexible multi-condition array (`formConditions`).
  - Users can add multiple filter rules (`+ শর্ত যোগ করুন` / `মুছুন`) across any trigger context fields.
- **Workflow Export & Import (JSON)**:
  - 1-click clipboard copy / `.json` file download (`📋 এক্সপোর্ট`).
  - 1-click JSON import modal (`📥 JSON ইমপোর্ট করুন`) with instant validation and form prefill.
- **Three New Presets in Gallery**:
  - `cart_recovery_alert` ("Abandoned Cart রিকভারি")
  - `vip_order_channel_alert` ("VIP অর্ডারে Slack/চ্যানেল অ্যালার্ট")
  - `ai_inbox_reply_assist` ("AI ইনবক্স নোট ও অ্যাসিস্ট")

## Verification
- API specs: `apps/api/src/workflows/w7-extensions.spec.ts` (trigger creation, AI generation execution, channel webhook validation & SSRF blocking, presets registration).
- Web specs: `apps/web/src/lib/workflow-graph.test.ts` (identity round-trip for `notify_channel` and `ai_generate`).
- Builder and canvas UI consistency verified.
