# Milestone 77 — Acceptance (Command Center, part 3: AI Behaviour)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
Schema 106 models; migration `20261010770000_m77_ai_behaviour`.
**The Business Command Center program (M75–M77) is complete.**

## What was built
- **Owner AI behaviour on the profile**: `aiInstructions`
  (the owner's standing directions for tone/conduct) and
  `aiReplyLanguage` (bn | en | auto — a closed set, anything
  else is a 400). Edited in the Settings hub's new
  **AI আচরণ** card, with the boundary printed on it:
  instructions steer conduct, never facts.
- **AI Assistant brain tool v2** (`get_business_knowledge`):
  the result now carries the Command Center **facts** (the
  same verified lines the inbox quotes), the owner's
  instructions + language, and **matchedDocuments** — FAQ
  documents ranked by the user's actual question via the
  M76 matcher over a 100-document pool, replacing the blind
  most-recent-20 as the relevance path (recent docs still
  flow). The planner passes the raw question as `query`
  (keyword plan widened to delivery/payment/FAQ/contact
  topics); the plan sanitizer admits only a bounded
  200-char string for it — every other key is dropped.
- **Instructions at work**: the assistant's grounded system
  prompt gains the owner's instructions (framed so the
  grounding rules win any conflict) and the reply-language
  preference; the inbox autopilot's LLM tier gets the same
  treatment through the fact pack, with the deterministic
  number guard still deciding what may be said.
- **Template answers upgraded too**: with no LLM key, the
  deterministic renderer now prints the Command Center
  fact lines and the matched FAQ — so the improvement is
  visible even before a provider is configured.

## Verification
- API jest: **697 pass / 98 suites** (4 new M77: tool
  carries facts + instructions + ranked match; no query →
  no matches; sanitizer bounds/drops; language closed set).
- Full monorepo build green.
- **Live proof** (T1 Shop): instructions + language saved
  through the profile API ("fr" refused 400); a warranty
  FAQ added; the owner asked the Assistant "আমাদের
  ডেলিভারি চার্জ আর ওয়ারেন্টি নীতি কী?" and the answer
  contained the Settings facts verbatim (BDT 60.00 /
  120.00, 2/4 days, COD, the bKash number) AND the matched
  FAQ — before M75–M77 the assistant knew none of this.

## The Command Center, end to end
Owner sets everything once in **Settings → Business
Command Center** (identity, contact, hours, delivery,
payments, AI behaviour; policies + FAQ alongside) → a
completeness meter shows what is missing and what the AI
can answer → the inbox autopilot, the rule composer, the
order bot and the AI Assistant all read from that single
source → every quoted number is a stored fact, and
anything unset is honestly "not known".
