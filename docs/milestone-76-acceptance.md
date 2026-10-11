# Milestone 76 — Acceptance (Business Brain v2)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
Plan: `docs/business-command-center-plan.md`.

## What was built
- **`apps/api/src/inbox/business-brain.ts`** — pure builders
  that turn Command Center data into verified fact lines:
  delivery (charges inside/outside, days, free-delivery
  threshold, minimum order), payment (COD availability,
  bKash/Nagad numbers, advance percent, payment note),
  contact (phone/email/address/website), hours (today's
  window + open-now verdict + return window). A missing
  fact produces NO line — never a guess.
- **`matchKnowledge`** — deterministic Bengali+English
  keyword matching over knowledge documents (title hits
  weigh double; a real overlap is required). The tokenizer
  includes Unicode marks (\p{M}): Bengali vowel signs are
  combining marks, and without them every word shatters —
  the spec caught this and it is regression-tested.
- **Fact pack v2** (`buildFactPack`): delivery/payment
  intents now draw profile facts FIRST and the policy text
  second (either source suffices — v1 demanded a policy);
  "other"/greeting questions get contact + hours facts;
  FAQ/knowledge matches are appended for EVERY intent; the
  business name comes from the Organization row (v1 read a
  nonexistent profile.name field — dead code, fixed).
- **Rule composer**: delivery/payment answers lead with the
  profile numbers, policy excerpt after; evidence is typed
  business_profile when the profile sourced the answer.
- **Order bot**: its delivery charge falls back to the
  profile's inside-Dhaka charge when no bot-specific
  charge is set (bot setting still wins).

## Verification
- API jest: **693 pass / 98 suites** (6 new M76: builder
  purity, matcher ranking + no-match honesty, pack from
  profile alone, FAQ found by keywords, empty world → null
  pack).
- Full monorepo build green.
- **Live proof** (T1 Shop, which has NO shipping policy):
  a webchat visitor asked "ডেলিভারি চার্জ কত?" and the
  autopilot replied on its own: "ঢাকার ভিতরে ডেলিভারি
  চার্জ: BDT 60.00। ঢাকার বাইরে: BDT 120.00। ঢাকায়
  ডেলিভারি সময়: 2 দিন। ঢাকার বাইরে: 4 দিন।" — every
  number straight from the Settings hub (Milestone 75).
  Under v1 this question received silence.

## Notes
- The FAQ half of the pack feeds the LLM tier; with no LLM
  key in the sandbox that path is covered by service tests
  (the parallel track's P3 live checks exercised the same
  pack plumbing). The rule-tier improvement above is the
  live-proven part.
- One honest wrinkle found while proving: "ডেলিভারি চার্জ
  কত টাকা?" classifies as price (the "কত টাকা" price phrase
  outranks delivery) — pre-existing classifier behaviour,
  unchanged here.
