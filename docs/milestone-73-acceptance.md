# Milestone 73 — Acceptance (Team T4: Agent Self-Service & Signature)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
Schema 106 models; migration `20261010730000_m73_signature`.

## What was built
- **My Performance** (`GET inbox/my-performance?days=`):
  the signed-in member's OWN scorecard row (indirect via
  the M70 teamScorecard — same math, same period), their
  rank and the team size for context, and their normalized
  "today" from the M69 activity board (state, replies,
  closes, open queue, on-shift). Members who are not
  agent-role get `me: null` — nobody else's numbers are
  exposed through this endpoint.
- **Chat signature** (AgentState.signature /
  signatureEnabled):
  - `GET/PUT inbox/my-signature` — self only; text is
    trimmed, capped at 300 chars; enabling with an empty
    signature can never switch on.
  - `InboxService.sendReply` gained `opts.signature`: when
    opted in, the sender's enabled signature is appended
    (`body + "\n\n" + signature`) BEFORE the message row is
    created, so the stored message, the channel delivery
    and the preview all carry exactly the same text.
  - Opted in: the inbox composer send and approved AI
    drafts (human sends). NOT opted in: system templates
    (COD confirmation, CSAT invite), autopilot, the order
    bot, workflows — automated messages never carry a
    personal signature.
- **Web**: the inbox "সেটিংস ও টিম" view gains a
  **আমার পারফরম্যান্স ও স্বাক্ষর** card — the member's own
  indicator + rank, period counts, CSAT, open queue and
  today's state, plus the signature editor (enable toggle,
  textarea, honest note about where it applies).

## Verification
- API jest: M73 spec 4/4 (pure join, trim/cap/enable rules,
  withSignature on/off/absent, myPerformance returns only
  the caller's rows in the REAL teamActivity shape).
  The same live cycle caught and fixed two real-shape
  issues the fakes hid: AgentState's composite key is
  `organizationId_userId` (field order), and teamActivity
  returns `members`/`activityState`/nested `today`.
- **Live proof** (fresh T1 Shop after a sandbox rebuild):
  agent saved a signature → their reply to a real webchat
  conversation was stored and sent as
  "ধন্যবাদ! দাম ১২০০ টাকা।\n\n— T1 এজেন্ট, T1 Shop সাপোর্ট টিম"
  (status sent); signature disabled → the next reply went
  out plain. my-performance returned the agent's own row.

## Not built / limits
- Signatures apply to text replies; media captions are
  not signed in v1.
- The signature is plain text (channels render text);
  no HTML/markdown formatting is promised.
