# MX6 — Two-way & Interactive Campaigns — Acceptance

Status: **CODE-COMPLETE** (local commits only, no push). Org-authored
keyword rules + polls matched against inbound WhatsApp replies in the
Unified Inbox: tagging, an org-authored auto-reply through the real
inbox send path, poll votes with latest-wins tally, an AI
classification *suggestion* workflow behind the MS9 guard path, and
the delivery → inbox conversation bridge.

Commits (branch `messaging-advanced`, base `29d078e0`):

- `d27a049f` — MX6: schema + migration `20261019030200_mx6_keyword_campaigns`
- `5fc64201` — MX6: keyword campaigns service + API
- `c32e9c80` — MX6: inbox hook chain + reply port
- `a6618bd4` — MX6: specs (messaging 22 + inbox 6)
- `ea535f0e` — MX6 web: Keyword Campaigns section + delivery conversation link
- (this doc's commit — see git log)

## Reply-port design (as landed)

MessagingService has no per-recipient WhatsApp send
(`sendToRecipient` is email|sms only) and must never import Inbox
(Inbox already depends on Messaging). Following the codebase's
MS8 `registerWorkflowCreator` pattern:

- `MessagingService.registerInboxReplyPort(port)` stores an
  `InboxReplyPort { sendConversationText(orgId, conversationId, text)
  → { providerMessageId } }`.
- `InboxService.onModuleInit()` registers itself (defensive `typeof`
  check, WorkflowsService precedent — spec constructions with stub
  messaging services are unaffected).
- The port's implementation, `InboxService.sendKeywordAutoReply`,
  creates the ChannelMessage row (`direction: "out"`, `autoReply:
  true`, `autoReplyEvidence: { via: "keyword_campaign" }`) and sends
  through `deliverText` — the same choke point as agent replies and
  the autopilot. The row becomes `"sent"` **only** with the real
  platform message id (`statusForDelivery`); a delivery failure
  marks it `"failed"` with the platform's error and **throws**, so
  Messaging records the hit action as `failed` with the real reason.
- Absent port (InboxModule not booted / older build): the action is
  recorded `skipped` with the reason — never claimed sent.
- A keyword reply just arrived inbound, so the WhatsApp 24h window
  is open by construction; `deliverText` enforces whatever the
  channel enforces and its result is surfaced verbatim. Audited as
  `inbox.keyword_auto_reply.sent` / `.failed` (userId "system").

## Shipped, with evidence

### 1. Migration + schema
`20261019030200_mx6_keyword_campaigns` — additive, two new tables:
`MessagingKeywordRule` (kind `keyword`|`poll`; `tag` + `applyTagTo`
Json; `autoReplyText`; `pollOptions` Json; index
`(organizationId, enabled)`) and `MessagingKeywordHit` (per-action
outcomes Json; AI suggestion fields; indexes `(organizationId,
ruleId, createdAt)` and `(organizationId, conversationId)`).
House-style honest comments in `schema.prisma` (reserved keywords
unclaimable, WhatsApp-only v1, opt-out-confirm rule). `prisma
validate` green.

**Shape refinement (per the brief's explicit allowance):** instead
of separate `tagCustomer`/`tagConversation` columns, a rule carries
ONE tag string (`tag`) + `applyTagTo: ("customer"|"lead"|
"conversation")[]`. The "customer" target falls back to the linked
lead when the conversation has no customer, and the hit outcome
records which entity was actually tagged.

### 2. Rule management API (`messaging.controller.ts`)
`GET/POST/PATCH messaging/keyword-rules` (WRITE_ROLES),
`DELETE messaging/keyword-rules/:id` (OWNER/ADMIN, like
templates/audiences), `GET messaging/keyword-rules/:id/tally`,
`GET messaging/keyword-hits` (recent, `ruleId` filter),
`POST messaging/keyword-hits/:id/classify` and
`POST messaging/keyword-hits/:id/apply-label` (WRITE_ROLES).
List responses carry a real per-rule `hitCount`; hits carry the
rule's name/kind for display. Creates/updates/deletes/classify/
label decisions are audited.

Validation (service layer, `validateKeywordRule`; PATCH validates
the MERGED shape):
- keyword required (keyword rules); normalized trim +
  Latin-case-insensitive — the same normalization the MS2 hook
  uses (now shared constants `KEYWORD_RESERVED_STOP/START` +
  `normalizeKeywordText`; `handleInboundKeyword` uses them too,
  values unchanged).
- **Reserved keywords refused** — the full STOP set (STOP, STOP
  ALL, UNSUBSCRIBE, বন্ধ করুন, স্টপ) + START set (START, চালু করুন),
  in rules and inside poll options.
- **Duplicate claims refused** — a keyword already claimed by
  another ENABLED rule of the org, including inside another
  poll's options; also refused within one poll's own options. A
  disabled rule claims nothing (its keyword can be re-claimed).
- Polls: 2..6 options, each with a label + ≥1 keyword; polls
  carrying a tag/auto-reply are refused (votes only in v1).
- Keyword rules need ≥1 action (tag or auto-reply); tag and
  applyTagTo must come together; autoReplyText ≤ 1000 chars.
- channel: only `"whatsapp"` — anything else is a 400 naming
  the reason (SMS: no inbound path exists; email: replies not
  hooked).

### 3. Inbound processing
- Inbox chain (`InboxService.processInboundIntelligence`): the
  existing MS2 hook result is captured; **only when it did NOT
  match** is `messagingPrefs.handleKeywordReply(orgId,
  conversation, text)` called, best-effort (`.catch(() =>
  undefined)`), same placement, WhatsApp only. STOP/START
  exclusivity is therefore structural — and
  `handleKeywordReply` *also* re-checks the reserved set itself
  (defense in depth: even if the preference hook throws and the
  chain proceeds, a STOP can never produce a campaign hit —
  pinned in both specs).
- Match = exact whole-message claim (keyword rules + poll
  options) over the org's enabled WhatsApp rules, same
  normalization. No claim → `{ matched: false }`, **no hit row**
  (non-campaign chatter is not recorded). Exactly one hit row
  per matched message.
- Actions, each outcome recorded in the hit's `actions` Json
  (`applied | skipped | failed` + real reason):
  - tag → Customer.tags (Json append, dedupe, others preserved),
    Lead.tags (direct target or customer fallback),
    ChannelConversation.tags — per `applyTagTo`; a missing
    link/not-found/already-present case is recorded honestly.
  - autoReplyText → sender's WhatsApp preference checked FIRST
    via the existing `findOptOut` lookup: opted out →
    `skipped` "sender opted out" (tags still apply — they
    record the customer's own explicit reply; only the send
    is blocked). Otherwise the registered port sends; the
    outcome carries `providerMessageId` on success or the real
    error on failure.
- Poll match → hit with `pollOptionKey`, `actions: null` (a
  vote; no tags, no auto-reply in v1).

### 4. Poll tally
`GET messaging/keyword-rules/:id/tally` — **semantics: one voter
= one conversation; a voter may change their vote by replying
with another option's keyword — each conversation counts once,
under its LATEST hit; earlier votes from the same conversation
do not count.** Returns per-option `{ key, label, votes }` +
`totalVoters`. Tally on a keyword rule is an honest 400.

### 5. AI classification (suggestions only)
- `POST classify` runs the hit's matched text through the
  **same MS9 guard path** verbatim: `checkMessagingAiLimit`
  (org kill switch → 403; daily cap counted from AIUsageRecord
  on the shared `messaging_copy` feature → 429) before any
  provider call, `messagingAiProvider`, one usage record per
  completed call. The prompt demands exactly one of `interest |
  complaint | opt-out | other` (JSON); an off-vocabulary or
  unparseable answer is the MS9-style 502 with nothing stored.
  The dev-template provider is not a model and cannot classify
  — honest 502, no suggestion stored (never a fabricated label).
- Success stores only `suggestedLabel` + `classifyStatus:
  "suggested"`. **Nothing is applied at this stage.**
- `POST apply-label` confirm → `confirmedLabel` stored; for
  interest/complaint the label is ALSO appended as a tag on the
  conversation (visible to agents, reversible). **For opt-out
  the label is stored ONLY — confirming a suggestion NEVER
  writes a MessagePreference and never suppresses anyone.**
  Suppression happens only through the real STOP path, which is
  instant and already supreme. (Rule stated in the schema
  comment, the service comment, the UI copy, and pinned by
  spec.) Dismiss → `classifyStatus: "dismissed"`, nothing
  applied. Deciding without a pending suggestion is a 400.

### 6. Delivery report → Inbox link
`listDeliveries` rows (legacy bare array AND paged shape) gain
`conversationId: string | null`: ONLY channel `"whatsapp"` rows
resolve — ChannelConversation matched by (organizationId,
channel "whatsapp") with digits-only(externalContactId) ==
digits-only(delivery.address), batched (the page's rows resolve
through one conversation query). Every other channel, no
conversation, or any lookup failure → null. Never guessed.

**Inbox deep-link verdict: NOT SUPPORTED.** Verified in
`apps/web/src/app/dashboard/inbox/page.tsx`: there is no
`useSearchParams`/query-param conversation selection at all —
a conversation opens via internal state (`openConversation`).
The web row therefore links plainly to `/dashboard/inbox`
("💬 কথোপকথন"). The inbox page was NOT modified (out of
scope, per the brief).

### 7. Web — Keyword Campaigns section (`dashboard/messaging`)
"💬 Keyword Campaigns (রিপ্লাই ক্যাম্পেইন)" card at the end of
the Messaging page, in the page's patterns + Bengali copy:
- Rules list: name, kind chip (🔑 কীওয়ার্ড / 🗳️ পোল), enabled
  chip, real hit count, keyword/option summary, action summary,
  enable toggle, edit, delete (OWNER/ADMIN note).
- Create/edit form: kind switch (locked during edit, with the
  reason shown — poll option keys are preserved verbatim on
  edit because recorded votes reference them); keyword input
  with the reserved-keyword note; tag string + apply-to
  checkboxes (কাস্টমার (না থাকলে লিড) / লিড / কথোপকথন);
  auto-reply textarea with the honest note (Inbox কথোপকথনেই
  পাঠানো হবে — গ্রাহক মেসেজ পাঠালেই কেবল এই পথ খোলে; STOP
  পাঠালে কোনো ক্যাম্পেইন-রিপ্লাই যাবে না; Opt-out থাকলেও
  রিপ্লাই যাবে না); poll options editor (label + comma
  keywords, 2..6 rows, add/remove).
- Poll tally: per-option bars with real vote counts +
  percentages + total voters, with the latest-vote note.
- Recent hits: matched text, rule/option, per-action outcome
  chips (হয়েছে / বাদ + reason / ব্যর্থ + reason, provider id
  when sent), AI suggestion chip with শ্রেণি নির্ণয় button and
  confirm/dismiss when a suggestion exists (with the opt-out
  honesty note); confirmed/dismissed states shown.

### 8. Specs (new files only; no existing spec modified)
- `apps/api/src/messaging/mx6-keyword-campaigns.spec.ts` —
  **22 tests**: reserved refused (STOP + lowercase start +
  Bengali বন্ধ করুন/স্টপ/চালু করুন; reserved inside a poll
  option); duplicate claim refused (case-insensitive, against
  a poll's options, within one poll) + disabled-rule re-claim;
  non-WhatsApp honest 400s; no-action rule refused; customer
  tag append + dedupe with outcomes; lead fallback + lead/
  conversation targets; opted-out sender → reply skipped,
  tag applied, port never called; no port → skipped honestly,
  hit recorded; port success (provider id) + port failure
  (real error); STOP/START never a hit at this layer +
  chatter writes no row; poll vote + changed-vote tally
  (distinct conversations, latest wins); tally-on-keyword 400;
  classify stores a suggestion and applies nothing (one usage
  record); confirm interest tags the conversation; **confirm
  opt-out writes NO preference row**; dismiss; kill-switch
  403 / cap 429 with nothing stored; dev provider 502;
  off-vocabulary 502; delivery conversationId (WhatsApp digit
  match incl. "+880 1712-…" formatting, sms → null, no
  conversation → null) in both listing shapes.
- `apps/api/src/inbox/mx6-inbox-hook.spec.ts` — **6 tests**:
  STOP → campaign handler never called; START → same; non-
  keyword text → handler called once with (org, conversation,
  text); throwing campaign handler does not break ingest
  (classification still lands); throwing preference hook does
  not break ingest; `onModuleInit` registers the port and its
  send goes through the real conversation path (webchat
  delivery: stored message `sent`, `autoReply: true`,
  `via: "keyword_campaign"` evidence, provider id returned).

## Gates (scoped, exact)

- `npx jest src/messaging src/workflows src/inbox --runInBand`:
  **89 suites / 963 tests, all passed** (messaging 18/314,
  workflows 16/79, inbox 55/570). Environment note: the combined
  run needs `NODE_OPTIONS=--max-old-space-size=4096` in this
  sandbox — at the default ~2 GB heap the single-process run
  OOM-aborted midway (each directory also run separately at
  the default heap: all green).
- `npx tsc --noEmit -p tsconfig.json` (apps/api): **green**.
- `npx tsc --noEmit -p tsconfig.json` (apps/web): **green**.
- `npx vitest run --passWithNoTests` (apps/web): **82 files /
  703 tests, all passed**.
- `npx prisma validate` (packages/db, dummy DATABASE_URL):
  **valid**.

## NOT BUILT (with evidence)

- **SMS keyword campaigns** — there is NO SMS inbound path
  anywhere in the codebase (no provider webhook writes inbound
  SMS into messaging/inbox); a rule on SMS could never fire.
  The API refuses channel "sms" with exactly that reason.
- **Email keyword campaigns** — email replies are not hooked
  into messaging preferences or campaigns (the only inbound
  email machinery is the inbox email lane, which has no
  messaging hook). Refused with that reason.
- **Messenger keyword campaigns** — deliberately not hooked
  (the MS2 dead-data rationale: a Messenger PSID matches no
  send/preference keying, so a rule or preference keyed by it
  could never match anything). Channel value "messenger" is
  refused as non-WhatsApp like the rest.
- **Template-based auto-reply outside the 24h window** — not
  applicable by construction: the keyword flow always starts
  from a fresh inbound message, so the WhatsApp customer-
  service window is open; the reply is the org's plain text
  through the conversation send path, never a template send.
- **Deep-link into a specific inbox conversation** — the
  inbox page exposes no URL selection mechanism (verified);
  the delivery link goes to the Inbox plainly. Modifying the
  inbox page was out of scope for MX6.
- **Poll tags / poll auto-replies** — v1 polls record votes
  only; the validator refuses tag/auto-reply fields on poll
  rules instead of silently ignoring them.
- **Cascade on keyword auto-replies, per-channel throttle** —
  out of the MX6 brief (MX2 cascade covers broadcast attempts;
  the inbox send path's own discipline applies to replies).

## Deviations

- Rule shape refined as the brief explicitly allowed: ONE
  `tag` string + `applyTagTo[]` instead of `tagCustomer` +
  `tagConversation` columns (see §1).
- `listDeliveries` legacy (no-params) responses now also carry
  `conversationId` per row — additive field, same array shape;
  the MS7 spec pinning the legacy/paged behaviour passes
  unchanged.
- No live proof: no real WhatsApp number, Meta app or LLM key
  was exercised (M30-owed, as with the rest of the package).
  The port send is proven against the webchat delivery path in
  spec; the Meta WhatsApp leg rides the same `deliverText`
  choke point as agent replies.
