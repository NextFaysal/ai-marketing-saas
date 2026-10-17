# FB2 Acceptance — NF3 AI Voice Agent + NF4 Service & Appointment

**Batch:** New Features Frontier FB2 (NF package approved in full by the owner 2026-10-17)
**Worktree/branch:** `~/workspace/ai-marketing-saas-nf`, `new-frontier` · **Base:** `5cc9f1b6` (FB1 code-complete, 226 migrations)
**Local commits only — nothing pushed.** Migration claim used: `20261030000000` (NF3) + `20261031000000` (NF4).

## Per-item record

| # | Commit | Item |
|---|---|---|
| 1 | `4bfb044f` | NF3 Step-0 spike: `docs/nf3-voice-conversation-spike.md` (existing-IVR audit + official-doc evidence + architecture) |
| 2 | `e4fb6bd1` | NF3 schema + migration `20261030000000_nf3_voice_conversation` (VoiceCallSetting conversation fields, OrderVoiceCall conversation/follow-up fields, new `VoiceConversationTurn`) |
| 3 | `23e3caeb` | NF3 conversation engine + `VoiceConversationProvider` port (simulation / twilio_relay) + service, Relay message adapter, Relay TwiML, no-answer follow-up, controller/module wiring |
| 4 | `7ed0f294` | NF3 specs — `voice-conversation.spec.ts` (21 tests) |
| 5 | `907b7222` | NF4 schema + migration `20261031000000_nf4_service_bookings` (ServiceOffering, ServiceStaff→Membership, StaffAvailability, ServiceBooking) |
| 6 | `ce1cfb34` | NF4 booking API (tenant + public controllers, slot engine, overlap transaction, deposit quote) + `service_booking_reminder_sweep` automation wiring |
| 7 | `ae2341ad` | NF4 specs — `booking.spec.ts` (24 tests) |
| 8 | `91b92894` | NF4 web — `lib/booking.ts` (+12 tests), `/dashboard/services`, `/dashboard/bookings`, public `/shop/[orgSlug]/booking`, nav entries; per-item detail in `docs/nf4-booking-acceptance.md` |

## NF3 — what shipped

- **Conversation engine** (deterministic state machine, not an LLM free-chat): greeting → decision → collect address / collect delivery-time / two-step cancel-confirm → done. Bengali+English keyword intents (confirm / cancel / change address / change delivery time / talk to human); ambiguous or twice-misunderstood → polite human handoff. Every agent line is a template filled ONLY from the real order + `OrgBrainService` **customer-audience PUBLIC** facts — internal profile fields/documents are never read into a call (spec-proven with an INTERNAL sentinel that never appears in any agent line).
- **Actions via existing service paths only (L5), verified from results, exactly once per call** (guarded by `actionAppliedAt`): confirm → `FraudShieldService.recordCodCall("confirmed")`; cancel → `recordCodCall("rejected")` + `OrdersService.updateOrder({status:"cancelled"})`; address → `updateOrder` with ONLY `{address}`; delivery-time → `updateOrder` with ONLY an internalNote recording the requested time (DeliverySlot is a checkout-slot catalogue, not a per-order reschedule field — not misused) + staff notification; human → `createAgentNotification` to ACTIVE OWNER/ADMIN members. A failed verification leaves the call honestly un-actioned with the failure in its summary. The agent never touches money/refund/price fields.
- **Safety:** agent refuses unless org voice `enabled` AND new `conversationAgentEnabled` are on (default OFF), refuses AI-kill-switched orgs (403, same as chat), respects existing `maxAttempts`; every terminal action audit-logged (`voice.conversation_action`).
- **Modes, labelled in every response:** `simulation` (the working, spec-provable path — typed text stands in for the transcript; no telephony) and `twilio_relay` (config-gated: generates the spike-evidenced ConversationRelay TwiML only when the owner has configured a relay WebSocket URL; a transport-agnostic handler maps the evidenced WebSocket message shapes — setup/prompt/dtmf — onto the same engine and returns the evidenced `{type:"text", token, last}` replies; falls back to the existing IVR TwiML when unconfigured).
- **No-answer follow-up:** busy/no-answer/failed conversation calls get `followUpStatus:"pending"`, `followUpChannel:"whatsapp_manual"` + a staff AgentNotification that explicitly says no automatic message was sent — staff follow up on WhatsApp from the inbox. There is NO automatic WhatsApp send (no single-recipient send path exists outside a live inbox conversation; none was invented).
- **Turns persisted** per call (`VoiceConversationTurn`, org-scoped); the call summary is on the order via the existing voice-calls read plus the new conversation read endpoint.

### Step-0 evidence (NF3) — summarised in `docs/nf3-voice-conversation-spike.md`
Fetched 2026-10-17 from official docs: Twilio `<ConversationRelay>` TwiML noun reference (noun under `<Connect>`, `wss://` app endpoint, STT/TTS handled by the relay, `transcriptionProvider` Google|Deepgram, `ttsProvider` Google|Amazon|ElevenLabs, nested `<Language>`/`<Parameter>`, onboarding + AI addendum required); Twilio ConversationRelay WebSocket-messages reference (setup/prompt/dtmf/interrupt shapes + outbound text shape); Google Cloud Speech-to-Text supported-languages list (`bn-BD` listed — the evidenced Bengali STT path is therefore via the Google transcription provider; Deepgram Bengali was NOT evidenced and is not offered); Twilio BD Programmable Voice pricing page (per-minute BD + ConversationRelay + Gather-speech line items exist — numeric values render client-side and did not appear in the text fetch, so NO price is recorded or hardcoded anywhere).
**Not proved:** any live call, BD number availability in Twilio inventory, exact per-minute cost, bn-BD accuracy on real phone audio, TTS quality. All of it waits on the owner's Twilio account + D2.

## NF4 — what shipped

Detail in `docs/nf4-booking-acceptance.md`. Headlines: services CRUD; staff linked to existing Membership (no parallel user table); weekly availability (org timezone, minutes-from-midnight); pure slot engine (working hours − bookings − buffer, full-fit rule); booking create runs a transaction overlap re-check (409 Bengali; touching boundary allowed); guest booking links/creates a Customer by (org, phone) through the existing customer table with `source:"booking"`; status machine pending→confirmed→completed/no_show/cancelled with guards; deposit quoted from the org's existing BusinessProfile deposit config via `depositFor(..., "manual")` and tracked as a labelled manual state — **no gateway charge, no PaymentVerification is ever created for a booking**; reminders via the existing `ShopAccountService.sendShopSms` helper (tenant SMS gateway → platform fallback) from the new per-org job `service_booking_reminder_sweep` (registered, **not enabled for any org**), with `reminderSentAt` stamped before the attempt so a booking is reminded exactly once and a missing channel records `failed_no_channel` instead of resending; dashboard Services + Bookings pages and a public storefront booking page (service → staff → date → slot → details → pending confirmation), all Bengali-labelled; public endpoints expose slots only, never other bookings.

## Gates (run serially, recorded as they finished)

| Gate | Result |
|---|---|
| NF3 targeted jest (worker) | voice.spec 14/14 + voice-conversation.spec 21/21 = **35/35 PASS** |
| NF4 targeted jest (worker) | booking.spec **24/24 PASS**; automation suites (touched wiring) 14 suites **83/83 PASS** |
| Coordinator independent re-run (voice + booking) | 3 suites **59/59 PASS** |
| API tsc `--noEmit` | PASS (worker NF3, worker NF4, coordinator build below) |
| API build (`tsc -p tsconfig.build.json`) | **PASS** |
| Web targeted vitest (worker) | booking lib 12/12 + nav-commerce 6/6 PASS |
| Web full vitest | **113 files / 947 tests PASS** (FB1 was 935; +12 booking lib tests) |
| Web build | **PASS** — routes `/dashboard/services`, `/dashboard/bookings`, `/shop/[orgSlug]/booking` present |
| Fresh-PG (throwaway local PG16 + pgvector, empty DB, `prisma migrate deploy`) | **228/228 migrations applied, 0 unfinished** (226 base + `20261030000000` + `20261031000000`); new tables verified present: VoiceConversationTurn, ServiceOffering, ServiceStaff, StaffAvailability, ServiceBooking |
| **Boot smoke** (API dist booted against the fresh-PG DB) | **PASS** — API boots, `GET /health` → `{status:"ok"}`; RouterExplorer mapped ALL new routes (voice-conversation start/turns/read, `GET /voice/twiml-conversation/:callId`, 16 booking tenant routes, 4 public booking routes); live probe of `/public/booking/<unknown>/services` returned the designed Bengali 404 |
| Full API jest suite | Not run as a single gate (brief gates = targeted suites + regressions, as in FB1) |

**Migration-range watch (for the union release):** the Campaign Advanced (CA) line also circled the `20261030000000+` range in its plan (its build runs from a different base in its own worktree). FB2 has now used `20261030000000` + `20261031000000` with those exact folder names on this line; whoever integrates must check the CA line's actual folder names before the union fresh-PG — same-timestamp different-name folders deploy lexicographically, identical names would collide.

## NOT BUILT

- **Any live voice call** — no Twilio call was made; needs the owner's Twilio account, a caller number, his D2 provider/cost decision, and ConversationRelay onboarding (incl. Twilio's AI addendum) on his account.
- **The WebSocket gateway transport** for ConversationRelay — the message handler is built and spec-tested against the evidenced message shapes, but the Nest app has no WS gateway; adding one is a deployment decision alongside D2. Until then `twilio_relay` produces TwiML + handler logic only.
- **Live STT/TTS** of any kind; Bengali speech quality is unproven in both directions. Simulation mode is the only runnable conversation path today, and it is labelled as such everywhere.
- **Automatic WhatsApp follow-up** after a missed voice call (labelled manual staff task instead — see NF3 above).
- **Booking deposits online** — manual state only, by deliberate honesty call (the AB4 deposit config is checkout-shaped; its `depositFor` quote is reused, its collection flow is not).
- **WhatsApp booking reminders** (SMS via the existing shop-SMS helper only — no per-recipient WhatsApp template path exists); per-staff↔per-service mapping (v1: any active staff takes any active service, stated in code); recurring bookings; customer self-service cancel/reschedule; telemedicine/video (plan exclusion).
- **Live proof of EVERYTHING in FB2:** no migration has run on a real database, no SMS has been sent, nothing is deployed. M30-style verification is owed with the owner's real accounts, as with FB1.

## Owner decisions / actions still owed

1. **D2 — voice provider + cost:** read the live per-minute numbers (BD outbound + ConversationRelay) and BD number availability in his own Twilio console; approve the relay path + WS gateway deployment if live voice is wanted. Simulation mode works without any of this.
2. **D4 — service segment confirmation:** NF4 was built per his full-package approval; whether service businesses (salon/clinic/coaching…) become a marketed target segment is still his positioning call.
3. Push instruction for this line (union release with the other lines; check the CA migration folders first — see the watch note above) + manual Dokploy Redeploy.
4. Per-org enables after deploy, if wanted: voice conversation agent per org (settings, default OFF), `service_booking_reminder_sweep` per org.
