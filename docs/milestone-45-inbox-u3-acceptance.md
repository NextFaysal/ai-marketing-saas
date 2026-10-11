# Milestone 45 (Unified Inbox U3) — AI Autopilot + Bot v2 (Acceptance)

Built 2026-10-10 from `docs/unified-inbox-plan.md` Phase U3.
Schema **103 models** (migration `20261010450000_m45_autopilot`:
Order.address; ChannelConversation.autoReplyPaused;
InboxSetting.perChannelModes + escalationThresholdMinor).

## What was built

- **Mode resolution v2**: per-intent → **per-channel** → global.
  Each channel (WhatsApp/Messenger/Instagram/Live Chat/…) can
  independently be off / draft / auto.
- **Escalation gate** (runs before any composing): complaint or
  negative sentiment, a human request ("এজেন্ট চাই", "মানুষ",
  "agent"…), a high-value open order above the operator-set
  threshold, or two consecutive ununderstood messages → the
  conversation's autopilot **pauses** (`autoReplyPaused`),
  priority rises, the team is notified, and the escalation is
  audited (`inbox.autopilot.escalated`). A human reply resumes
  autopilot automatically; the thread shows a paused banner with
  a manual resume button.
- **LLM autopilot tier**: when the rule composer has no grounded
  answer, a real LLM may compose a reply from a **verified fact
  pack only** (the same sources the rules use: matched product
  price/stock, the business's own policy text, the real latest
  order). A deterministic **number guard** rejects any reply
  containing a number that is not in the fact pack (Bengali
  digits normalized) — rejections are audited
  (`inbox.autopilot.guard_rejected`). NO_ANSWER, a missing
  provider, or the dev-template provider all mean: no reply.
  Every send carries `via: "autopilot"` evidence (LLM sends add
  `tier: "llm"`), keeping bot/workflow automation out of the
  autopilot statistics.
- **Bot v2**: multi-product cart (product → quantity →
  "আরো নিতে নম্বর, শেষ করতে 'শেষ'" loop, same-product quantities
  merge), one details pass, a summary listing every item with
  server-computed totals, and **Order.address end-to-end** —
  the bot and the manual chat-order form now store the delivery
  address on the order itself (and pass it to WooCommerce as the
  billing address) instead of burying it in an internal note.
- **Autopilot analytics** in the team report: sends (rules vs
  LLM), drafts suggested, conversations currently escalated.

## Bugs found live during verification (both pre-existing, both fixed)

1. **The order bot could never work on website live chat**:
   `sendAutomatedMessage` demanded a connected Meta integration
   before delivering, even though `deliverText` serves webchat
   in-process. Every bot message failed with "Messaging
   integration is not configured" and the session silently
   handed off. Webchat now skips the Meta gate.
2. **System audit rows never landed on a real database**:
   automated actors audit with userId "system", but AuditLog's
   userId is a real FK — every such insert (auto-reply sent/
   failed, lead ingestion, automated messages, escalations)
   failed with a foreign-key violation that AuditService
   swallowed. `AuditService.log` now records a null actor for
   "system" (the column is nullable by design).

## Verification
- **API tests: 455 pass (67 suites)** — including 9 new U3 tests
  (per-channel override, complaint/human/high-value escalation +
  pause persistence, LLM compose from the pack, invented-number
  rejection, dev-provider refusal, Bengali-digit number
  extraction, full bot cart walk to a two-item order with an
  address) and the M15 bot spec updated to the v2 flow (the
  "শেষ" cart step), its totals unchanged.
- **Live on the sandbox, end to end**: settings round-trip;
  per-channel draft mode produced a grounded draft (real price)
  for a webchat price question — filed, not sent; a full bot v2
  walk on the real server (শাড়ি ×২ + ব্যাগ ×১ → name/phone/
  address → confirm) created order CHAT-99CC9E, total ৳4,960
  incl. delivery, **address stored on the order**, two order
  items; team report shows the autopilot block.

## Not claimed / still open
- The LLM tier is unit-proven with a stub provider and
  live-unproven against a real LLM (no key yet — M30 Session 5;
  sandbox egress cannot reach api.openai.com). The contract is
  enforced in code either way: no real provider → no LLM reply.
- Escalation for an already-assigned hostile thread pauses
  autopilot and notifies; it does not by itself reassign the
  agent (the U2 sweep handles away/stale cases).
- bKash advance-payment links inside the bot are NOT built
  (needs the tenant's own bKash merchant — the platform never
  holds customer money); the bot remains COD-first.
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
