# Milestone 75 — Acceptance (Business Command Center, part 1)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
Schema 106 models; migration `20261010750000_m75_command_center`.
Plan: `docs/business-command-center-plan.md`.

## What was built
- **BusinessProfile operational layer** (the facts customers
  ask daily and the AI must quote): address, city,
  businessHours (weekly windows JSON — the M68 shape),
  delivery charges inside/outside Dhaka (BigInt minor),
  free-delivery threshold, delivery days inside/outside,
  COD availability, minimum order, bKash/Nagad numbers,
  payment note, advance-payment percent, return window.
- **Validation with teeth**: money is non-negative integer
  minor units stored as BigInt; payment numbers are
  normalized (Bengali digits + separators) and must be a
  real 01xxxxxxxxx mobile number; business hours pass the
  M68 window/timezone validators. Bad input → 400, nothing
  saved.
- **GET business-profile/completeness**: eight sections
  (identity, contact, hours, delivery, payments, policies,
  knowledge, products) computed from real rows, a percent,
  and `aiCanAnswer` — which question families (price/stock,
  delivery, payment, contact/hours, FAQ) the AI can answer
  from verified data today.
- **Settings page = the hub**: completeness meter + section
  checklist + "AI যা উত্তর দিতে পারবে" chips on top, then
  inline editors for identity / contact-address-hours /
  delivery-return / payments (taka in the form, paisa at
  the API), with the Knowledge page linked for policies and
  FAQ. Branding and 2FA cards remain below.

## Verification
- API jest: **687 pass / 98 suites** (4 new M75: BigInt
  storage + number normalization, malformed number and
  bogus hours refused, profile JSON money-as-strings,
  completeness from empty 0% to full 100%).
- Full monorepo build green.
- **Live proof** (T1 Shop): completeness started at 0%
  with every aiCanAnswer false; after one PATCH (Bengali-
  digit bKash number included) it rose to 63% with
  delivery/payment/contact-hours flipping true, the number
  stored normalized, a malformed number refused with 400.
- **Real bug caught by the live test**: GET/PATCH profile
  responses 500'd with "Do not know how to serialize a
  BigInt" once a charge was set (the PATCH's data had in
  fact saved). Fixed with `profileJson` (money leaves as
  strings) on both paths + a regression spec.

## Not built yet (by plan)
- M76: the Business Brain fact pack v2 (FAQ matching +
  these operational facts) feeding autopilot/drafts/bot.
- M77: the AI Assistant brain tool + owner AI instructions.
