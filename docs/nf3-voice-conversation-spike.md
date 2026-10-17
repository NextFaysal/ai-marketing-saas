# NF3 Step-0 Spike — AI Voice Agent (real conversation) verify-first note

**Batch:** NF FB2 · **Date:** 2026-10-17 · **Status:** design note, committed BEFORE the NF3 build.
**Rule (plan + brief):** Owner decision D2 (voice provider + per-call cost + BD caller
number) is NOT taken. Nothing in this note claims a live call, a provider response
shape that was not evidenced, or Bengali speech quality. Summaries below are
paraphrases of official documentation fetched on 2026-10-17; no doc text is
reproduced beyond short technical identifiers (attribute / field names).

## A. Audit of the existing voice module (code, this tree @ 5cc9f1b6)

Files: `apps/api/src/voice/{voice.service,voice.controller,voice.module,voice.types,voice.spec}.ts`.

**Real:**
- `VoiceCallSetting` (per-org, unique): `enabled` default **false**, `autoCallNewCod`,
  `provider` ("twilio" | "mock", default "mock"), Twilio SID/token/caller-id fields
  entered by the owner in settings, `maxAttempts` default 3, retry interval, prompt intro.
- `OrderVoiceCall` rows per call: phone, provider, callSid, status, outcome
  (`pending|confirmed|rejected|unreachable|failed`), `speechPrompt`, digits, recording URL.
- `initiateCall`: org-scoped COD-order lookup, phone resolution, Bangla IVR prompt via
  `buildBanglaVoicePrompt` (brand + items summary + formatted total from the REAL order),
  then dispatch.
- Twilio dispatch: a real `POST …/Accounts/{sid}/Calls.json` form call (To/From/Url/
  StatusCallback) with the owner's own credentials; on missing credentials or a
  non-OK response the call row is marked failed with the provider's message — it does
  not pretend success.
- TwiML: `<Gather numDigits="1">` + `<Say language="bn-BD" voice="Polly.Nabanita">`;
  gather result maps digit 1 → confirmed, 2 → rejected, else unreachable, and syncs
  the outcome through `FraudShieldService.recordCodCall` (the existing COD record path).
- Status callback normalises Twilio statuses; busy/no-answer/failed → `unreachable`.
- A `simulate` tenant endpoint replays digit presses (dev/sandbox helper).

**Mock / not real:**
- The default provider is `mock`: dispatch only stamps a fake `mock_…` callSid and
  `in_progress`. Nothing conversational exists — the customer cannot speak; the only
  input channel is one DTMF digit.
- No speech-to-text, no multi-turn state, no intent handling, no conversation transcript
  storage, no staff handoff, no follow-up on no-answer beyond the outcome string.
- **Live-unproven:** no real Twilio call has ever been recorded as made from this
  system (no M30 voice session). The Twilio request shape in code is plausible and
  matches the classic Calls API, but it is not live-verified.

## B. Official documentation fetched (2026-10-17)

1. **Twilio `<ConversationRelay>` TwiML noun reference** —
   https://www.twilio.com/docs/voice/conversationrelay/conversationrelay-noun
   - Proved: the noun sits under `<Connect>`; `url` (required) is a `wss://` WebSocket
     endpoint owned by the application; Twilio's relay performs STT + TTS + session
     handling and exchanges messages with the app over that socket.
   - Attributes proved: `welcomeGreeting`, `language`, `ttsLanguage`,
     `transcriptionLanguage`, `ttsProvider` (Google | Amazon | ElevenLabs),
     `transcriptionProvider` (Google | Deepgram), `voice`, `speechModel`,
     `dtmfDetection`, `hints`; nested `<Language code=… ttsProvider=… voice=…
     transcriptionProvider=… speechModel=…/>` per language; nested `<Parameter>`
     values arrive in the setup message's `customParameters`.
   - Also proved: using ConversationRelay requires completing Twilio's onboarding
     steps and agreeing to their Predictive/Generative AI addendum (an owner/account
     action, not a code action).
   - NOT proved there: that any specific provider supports Bengali (see 3), any price,
     any BD number availability.

2. **Twilio ConversationRelay WebSocket messages** —
   https://www.twilio.com/docs/voice/conversationrelay/websocket-messages
   - Proved message shapes: inbound `setup` (sessionId, callSid, from/to, callStatus,
     customParameters), `prompt` (voicePrompt = the caller's transcribed speech,
     lang, last = final-for-turn flag), `dtmf` (digit), `interrupt`
     (utteranceUntilInterrupt, durationUntilInterruptMs), `error` (description);
     outbound reply shape `{type:"text", token, last}` — the app sends text, the relay
     speaks it.
   - This is the exact contract the NF3 message handler is built against. The shapes
     are used as TypeScript interfaces; no other fields are assumed.

3. **Google Cloud Speech-to-Text supported languages (official)** —
   https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages
   - Proved: `bn-BD` (Bengali, Bangladesh) is a listed STT language (V2 models
     chirp_3 / long / short; V1 models incl. telephony-class models). ConversationRelay's
     documented `transcriptionProvider="Google"` therefore has an evidenced Bengali
     transcription path on paper.
   - NOT proved: Deepgram Bengali support (not evidenced in anything fetched — Deepgram
     is therefore NOT offered as a Bengali option in the NF3 settings), end-to-end
     accuracy/quality of bn-BD on Bangladeshi phone audio (only a live call can prove
     that), and any Google TTS Bengali voice via Twilio (not fetched) — the TTS side
     keeps using the Amazon Polly voice the existing IVR already names
     (`Polly.Nabanita`, `bn-BD`) as the default setting value, without a quality claim.

4. **Twilio Programmable Voice pricing — Bangladesh (official page fetched)** —
   https://www.twilio.com/en-us/voice/pricing/bd
   - Proved: pay-as-you-go per-minute pricing exists for BD-terminated calls, and the
     page carries separate per-minute line items for Conversation Relay and for Gather
     speech recognition, plus phone-number rental. (The page's numeric values are
     rendered client-side and did not appear in the text fetch; the SIP-trunking BD
     page surfaced in search results with a BD route price, but that is trunking, not
     Programmable Voice, so it is NOT used as the voice price.)
   - NOT proved: the exact per-minute Programmable Voice / ConversationRelay price for
     BD, and whether Twilio sells Bangladeshi local/mobile numbers at all — nothing
     fetched evidences BD number inventory. The existing product already sidesteps
     this: the caller ID is whatever number the owner configures in voice settings.
   - Consequence for D2: the owner must read the live numbers in his own Twilio
     console (BD outbound per-minute + ConversationRelay per-minute + number
     availability) before any live enablement. No price is hardcoded anywhere in NF3.

5. **Twilio `<Gather>` speech (existing fallback path)** — the current IVR's Gather is
   DTMF-only in code. The BD pricing page (4) lists Gather Speech Recognition as a
   priced feature, which evidences the feature exists, but NF3 does not build on it:
   ConversationRelay (1)+(2) is the evidenced conversational path, and one path is
   enough for v1.

## C. Architecture decided from the evidence

- **Port:** `VoiceConversationProvider` with a `mode` label carried in EVERY API
  response, mirroring FB1's manual-mode honesty:
  - `simulation` (v1 working path): a clearly-labelled dev/simulation provider. It
    drives the full conversation state machine over tenant HTTP endpoints
    (start → customer "speaks" text turns → agent replies as text). No telephony,
    no STT/TTS — the customer's typed text stands in for the transcript, and every
    response carries `mode:"simulation"`. This is the spec-provable surface.
  - `twilio_relay` (config-gated): generates the evidenced ConversationRelay TwiML
    (`<Connect><ConversationRelay url language="bn-BD" transcriptionProvider="Google"
    ttsProvider="Amazon" voice=…><Parameter name="callId"/></ConversationRelay></Connect>`)
    ONLY when the org's voice settings carry the owner's relay WebSocket URL and the
    conversation feature is enabled. A transport-agnostic message handler maps the
    evidenced WebSocket message shapes (setup/prompt/dtmf) onto the same conversation
    engine and returns the evidenced `{type:"text", token, last}` replies — the exact
    function a WebSocket gateway would call per message. **The WebSocket gateway
    transport itself is NOT BUILT in FB2** (the Nest app has no WS gateway today;
    bolting one on is a deployment decision for the owner alongside D2) — recorded in
    the acceptance NOT BUILT list, never implied otherwise.
- **Conversation engine** (provider-independent): deterministic multi-turn state
  machine + a keyword intent matcher over Bengali + English phrases (confirm / cancel /
  change address / change delivery time / talk to human). It is deliberately NOT an
  LLM free-chat: every agent line is a template filled ONLY from the real order +
  `OrgBrainService.getContext(org, {audience:"customer"})` PUBLIC facts (SA-B1 law L3 —
  internal profile fields never enter a call). Low/no-confidence or a second
  consecutive misunderstanding ends politely with a staff handoff.
- **Actions (Smart AI law L5 — existing service paths only, verified from results):**
  confirm → `FraudShieldService.recordCodCall(org, "ai-voice-agent", orderId,
  "confirmed")`; cancel → `recordCodCall(…, "rejected")` + `OrdersService.updateOrder`
  status `cancelled` (a transition the order state machine allows from pending/
  processing); address change → `OrdersService.updateOrder({address})` and nothing
  else; delivery-time change → `OrdersService.updateOrder({internalNote})` recording
  the customer's requested time (DeliverySlot is a checkout-slot catalogue, not a
  per-order reschedule field — using it would be fabrication) + staff follow-up;
  human handoff → `createAgentNotification` to the org's OWNER/ADMIN members.
  Each terminal action runs **exactly once** per call (guarded by the call's recorded
  conversation outcome). The agent never moves money, refunds, or changes prices —
  those DTO fields are never touched.
- **Data:** migration `20261030000000` — `VoiceCallSetting` gains conversation fields
  (enabled flag for the agent, mode, relay URL, STT/TTS provider + voice, language);
  `OrderVoiceCall` gains conversation outcome/summary/follow-up fields; new
  `VoiceConversationTurn` table persists every turn (org-scoped, per call).
  The call summary is readable on the order via the existing voice-calls list.
- **No-answer follow-up:** when a conversation call ends busy/no-answer/failed, a
  **staff follow-up task** is recorded on the call + an AgentNotification is created
  for OWNER/ADMIN members telling staff to follow up on WhatsApp from the inbox.
  Labelled honestly everywhere: there is NO automatic WhatsApp send in NF3 — the
  platform has no single-recipient WhatsApp send path outside a live inbox
  conversation, and inventing one would be a parallel sender.
- **Safety:** the conversation agent is OFF unless `VoiceCallSetting.enabled` AND the
  new per-org conversation flag are on; the platform AI kill switch
  (`killSwitches().aiDisabledOrgIds`) blocks initiation; attempts respect the existing
  `maxAttempts`; every initiation, turn outcome and action is audit-logged.

## D. What this spike did NOT prove (owner still owes D2)

- Any live call, BD caller-number procurement, exact per-minute cost, bn-BD accuracy
  on real phone audio, TTS naturalness. All of it waits on the owner's Twilio account,
  his D2 decision, and an M30-style live session — exactly as the plan recorded.
