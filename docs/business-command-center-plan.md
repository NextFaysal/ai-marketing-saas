# Business Command Center — Plan (M75–M77)

Owner direction (2026-10-11): Organization Settings must become
POWERFUL — the business owner sets EVERYTHING about the business
in ONE location, and the AI collects its information from that
location and works from it. Super powerful, real-world useful.

## Audit (2026-10-11, verified in code)
- BusinessProfile today is descriptive only (description,
  industry, brand voice, goals, contact email/phone). NO
  operational facts: no address, no business hours, no delivery
  charges/times, no payment numbers, no COD/min-order/return
  rules — yet customers ask the AI exactly these, daily.
- BusinessPolicy: typed free-text rows (shipping/payment/
  refund/return/…) — used by the inbox fact pack for ONE row
  of one type.
- KnowledgeDocument (faq/note/claim/template): read ONLY by
  the AI Assistant (a "take 20 most recent" tool). The inbox
  autopilot fact pack never sees FAQs; the order bot uses its
  own inbox-setting delivery charge.
- The inbox fact pack (buildFactPack) is thin: matched
  product price/stock, ONE shipping/payment policy, latest
  order status — and a dead `profile.name` check (the profile
  has no name field; the org name lives on Organization).
  When it finds nothing verified it returns null and the AI
  stays silent — a richer brain directly means more grounded
  answers.
- Settings are scattered: /dashboard/settings (branding, 2FA),
  /dashboard/knowledge (profile + policies + documents),
  inbox settings, integrations, billing. No single hub, no
  completeness or AI-readiness signal.

## M75 — Command Center data + hub (this milestone)
- BusinessProfile gains the operational layer (typed columns;
  money as BigInt minor like monthlyBudgetMinor):
  address, city, businessHours (JSON, same weekly-window
  shape as agent schedules), deliveryChargeInsideMinor,
  deliveryChargeOutsideMinor, freeDeliveryAboveMinor,
  deliveryDaysInside, deliveryDaysOutside, codAvailable,
  minOrderMinor, bkashNumber, nagadNumber, paymentNote,
  advancePaymentPercent, returnWindowDays.
- GET organizations/:id/business-profile/completeness —
  per-section checklist (identity, contact, hours, delivery,
  payments, policies per type, FAQ count, products) with a
  percent and per-consumer AI readiness (inbox autopilot,
  assistant) — computed from real rows only.
- Settings page becomes the HUB: completeness meter on top;
  sections পরিচিতি / যোগাযোগ-ঠিকানা-সময় / ডেলিভারি /
  পেমেন্ট / নীতিমালা ও FAQ (existing knowledge endpoints,
  linked + summarized) / ব্র্যান্ডিং / নিরাপত্তা — the
  business sections editable inline in one place.
- Writes validated (non-negative money, 0–100 percent,
  BD phone shape for payment numbers — loose), audited as
  today.

## M76 — Business Brain service + inbox wiring
- A BusinessBrainService assembles the verified fact pack v2
  from the hub: org name (real source), profile facts
  (delivery charges/times, free-delivery threshold, COD,
  payment numbers + advance rule, business hours, address,
  contact), ALL policy types, and FAQ/knowledge entries
  matched to the customer's words (deterministic keyword
  scoring; no embeddings dependency).
- Wired into: autopilot LLM tier (replaces buildFactPack's
  internals, keeping the number guard fed with the new
  numbers), the rule composer's delivery/payment answers,
  AI draft context, and the order bot's delivery charge
  (precedence: inbox bot setting → profile charge).

## M77 — Assistant + AI behavior controls
- AI Assistant gains a get_business_brain tool (structured
  hub data) and a keyword knowledge search (replacing the
  blind take-20), so chat answers about delivery/payment/
  hours cite the hub.
- AI behavior section in the hub: owner-written custom
  instructions (profile.aiInstructions — injected into
  assistant/autopilot prompts as owner instructions; can
  never override the verified-facts/number guard), reply
  language preference, tone presets tied to brandVoice.

## Rules kept
- No fabricated facts anywhere: empty settings show as
  "সেট করা নেই" and the AI says it does not know rather
  than inventing (existing NO_ANSWER discipline).
- Money stays integer minor units; every number the AI may
  quote enters through the verified fact pack.
