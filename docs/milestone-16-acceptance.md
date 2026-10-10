# Milestone 16 — Phase E (Trust & Delivery): Acceptance

Completed 2026-10-10 on the owner's explicit go-ahead, following
`docs/customers-automation-review-2.md` Phase E. Schema: 65 models
(+CourierShipment, +PaymentVerification; Order.conversationId;
ChannelMessage transcription fields), migration
`20261010160000_m16_phase_e` applied.

## Delivered

1. **Courier — Steadfast** (API shape verified from the published
   Packzy API before implementation: base portal.packzy.com/api/v1,
   Api-Key/Secret-Key headers, POST /create_order, GET
   /status_by_trackingcode/{code}, GET /get_balance)
   - Connect: credentials verified against the real API (balance
     call) before anything is saved; stored AES-GCM encrypted;
     failures surface Steadfast's own message as a readable error.
   - Booking from the Orders page: recipient defaults from the
     order's customer, COD amount = the COD order's real total, a
     shipment counts only with a courier consignment + tracking code
     in the response; duplicate active bookings are refused.
   - Status sync per shipment or sync-all; status is always the
     courier's own string. When a chat/bot order's parcel changes to
     a notable status, the customer is notified inside the original
     thread via the confirmed automated-send path, once per status.
   - Pathao/RedX slot into the same CourierShipment shape later
     (not implemented; no UI claims otherwise).
2. **Payment screenshot verification** (agent-assist): an agent taps
   verify on an inbound image; a vision model (the configured LLM
   provider - OpenAI/Anthropic/Gemini vision endpoints) extracts
   provider/TrxID/amount; the service compares against the expected
   total (the thread's awaiting COD order, else the customer's latest
   open order) and records matched / amount_mismatch /
   duplicate_trxid / no_expected_order / unverifiable plus flags.
   A reused TrxID anywhere in the org is flagged as fraud. The
   result is stored, shown in-thread, and noted internally; it NEVER
   marks an order paid by itself. Without a vision-capable provider
   the API refuses with an explicit configuration error.
3. **Voice-note transcription**: OpenAI Whisper (language bn) or
   Gemini audio; the transcript is stored on the message with its
   provider, shown in-thread, and fed into intent classification.
   Anthropic (no speech API) and unconfigured setups get an honest
   refusal.

## Verification

- API tests: 226 passed (12 new): client envelope/error/consignment
  rules; connect verify + encrypted storage + invalid-key refusal;
  booking defaults + COD minor units + duplicate refusal; sync
  transition + single customer notification; screenshot matched /
  mismatch / duplicate-TrxID; transcription + intent fill; honest
  refusals without a provider.
- LIVE against the real Steadfast API from the sandbox: connecting
  with deliberately invalid keys returned Steadfast's own
  "401: Unauthorized Access (invalid API credentials)" as a clean
  400 to the caller, and nothing was saved (connection still false).
  Real booking/status need the owner's merchant keys.
- All builds pass; migration applied; servers restarted; courier
  connection endpoint live-checked.

## Known limitations

- Steadfast only; delivery-charge quoting (their rate API) not
  integrated - the bot's delivery charge stays the business's own
  setting.
- Screenshot verification quality depends on the owner's vision
  model; it is an assist signal with the raw extraction stored for
  audit, not proof of payment.
- Transcription runs on demand (button), not automatically on every
  voice note, to keep provider costs explicit.
