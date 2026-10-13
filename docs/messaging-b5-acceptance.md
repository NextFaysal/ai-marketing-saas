# Messaging Power — Batch B5 Acceptance (MS9 AI for Messaging + MS10 Management Polish)

Branch `ms-package`, base B4 HEAD `d9590fe`. Local commits only — NOT pushed.

## Gate (B4 baseline → B5 final)

| Check | B4 baseline | B5 final |
|---|---|---|
| API jest (full) | 222 suites / 2091 tests | **224 suites / 2132 tests — TWO consecutive full runs, both fully green** (+41 = MS9 18 + MS10 23) |
| API tsc | clean | clean |
| Web vitest | 148/148 | 148/148 |
| Web tsc | clean | clean |
| Next build | green | green (`/dashboard/messaging` 28.4 kB) |
| Prisma validate | valid | valid (after `20261013180000_ms10_broadcast_archive`) |

**Flake record (not hidden):** during an intermediate neighbouring-suites run
(messaging + inbox + workflows + ai = 81 suites), the KNOWN pre-existing
`cx3-debounce` timing flake failed 2 tests. Standalone re-run: **18/18 pass**.
Both full package-gate runs were completely green. Root cause remains open
(pre-existing, unrelated to messaging — it also appeared in B4's baseline run).

## Audit findings that fixed the design (before any code)

1. **Broadcast bodies render AT SEND TIME from the broadcast row.**
   `processBroadcast` re-reads the row between chunks and passes
   `broadcast.subject/body/htmlBody` + the snapshot entry's per-recipient
   **vars** to the sender. Snapshot entries store vars only — never rendered
   text. Consequence (the brief's primary branch): PATCH on a **paused**
   broadcast honestly changes what the *remaining* recipients receive, and the
   web edit form's confirm copy says exactly that. Spec-proven end to end
   (prepare-state → pause → edit → resume sends the new body/subject only).
2. **AI wiring without a module cycle.** AiModule imports MessagingModule
   (never the reverse). `LlmFactory` is a dependency-free class reading the
   same effective platform config, so MessagingModule provides its own
   instance — behaviour identical, no forwardRef, no new import direction.
   `MessagingService` takes it as an optional 5th constructor arg; all
   pre-existing 4-arg spec constructions keep working.
3. **Text-draft precedent is creative-studio, not vision.** VisionService
   supplied the kill-switch/cap/usage discipline; creative-studio supplied
   the draft shape: real-facts-only prompts, JSON-mode parsing, and the
   **dev-template path** (deterministic template variants from real facts,
   explicitly labelled — the dev provider's `complete()` output is never
   presented as AI copy).

## MS9 — AI for Messaging (shipped)

- **Copy drafts** — `POST messaging/ai/draft` (WRITE_ROLES): channels email/sms
  (WhatsApp 400s — it sends approved Meta templates only). Prompt built from
  REAL context only: the org's `BusinessProfile` fields that exist (the same
  row inbox AI + the assistant read) and, when `productId` is given, that
  product's row. Foreign/missing product ⇒ **404**. Response: exactly the
  parsed variants (≤2) + `providerLabel`. **Drafts are returned only** — spec
  pins that broadcast/template/delivery table counts are unchanged after a
  call. SMS variants carry `smsParts` from the MS4 `smsSegments` helper
  computed on the returned text.
- **Subject variants** — `POST messaging/ai/subjects`: 3 variants, same
  discipline.
- **ONE usage accounting scheme (decision locked):** both endpoints use the
  single feature **`messaging_copy`** — one shared daily cap, one ledger.
  Kill switch ⇒ 403, cap ⇒ 429, both BEFORE any provider call (spec: provider
  call count stays 0). One `AIUsageRecord` per completed call, with the
  provider-reported tokens (`estimated` from the provider result; dev path
  records provider `dev-template`, `estimated: true`).
- **Unparseable provider output ⇒ 502** "AI উত্তর বোঝা যায়নি — আবার চেষ্টা করুন।"
  and NOTHING is stored — including no usage record. *Deviation from
  creative-studio* (which records usage before parsing): the brief's rule for
  this endpoint wins; a failed parse consumes no local cap and leaves no rows.
- **Dev provider:** deterministic template variants assembled from the real
  facts only (goal, product name/price/compare-at, USP, description excerpt —
  no discount/deadline/stock claim is ever added), response labelled
  `providerLabel: "dev-template"`, `isRealLlm: false`, with a Bengali/English
  notice that the UI shows verbatim.
- **Send-time suggestion (deterministic, no LLM)** — `GET messaging/ai/send-time`:
  the org's own `MessageLinkClick` + delivery `openedAt`/`readAt` events of
  the last 90 days, bucketed by Asia/Dhaka hour (Intl-based `dhakaHour`, spec
  pinned: 20:15 UTC → hour 2). Below **100 events**: `{ available: false }`
  WITH the real count stated. At/above: top-3 hours + a `method` label saying
  this is historical association, not a guarantee.
- **Segment suggestion (deterministic, no LLM)** — `GET messaging/ai/segment-suggestion`:
  pure rules over real `computeRfm` counts (threshold **≥ 20**): at_risk →
  win-back, lost → reactivation, champions → early access, new → welcome.
  Every segment suggestion carries `audienceType: "segment"` +
  `audienceSegment` — selectable verbatim in the composer (spec maps each
  kind). Plus the WhatsApp advisory: opt-in required AND zero opted-in
  preferences ⇒ a `whatsapp_optin_empty` suggestion (size 0, NO audience
  attached — there is nothing to select for it). No data ⇒ `[]`.
- **Web:** "🤖 AI দিয়ে লিখুন" panel inside the composer (goal, optional
  product, audience hint, bn/en; variant cards; a variant fills subject/body
  only on click, with a `window.confirm` when the fields are non-empty);
  "AI Subject প্রস্তাব" button + clickable chips beside the Subject field;
  send-time + segment suggestion cards above the create form (the segment
  card's button selects that segment in the form; unavailable send-time shows
  the honest reason line).

## MS10 — Management polish (shipped)

- **PATCH `broadcasts/:id`** (WRITE_ROLES). Matrix: **draft + scheduled** →
  content and `scheduledAt` (shared future-date rule; `null` unschedules a
  scheduled broadcast to draft, a no-op on a draft); **paused** → content
  only; **sending/sent/partial/failed/cancelled ⇒ 400 naming the status**;
  archived ⇒ 400 (unarchive first). Channel is immutable.
  Create-time validation is genuinely shared, not copied: the MS6
  `templateComponents` validator and the scheduledAt future-date rule were
  **extracted** from create/schedule into service helpers that create,
  schedule and PATCH all call; template checks reuse create's exact
  lookups/messages (foreign template 404, channel mismatch 400, email needs
  a subject, body required — evaluated on the merged row). WhatsApp: body
  edits refuse (the template owns the body); swapping `whatsappTemplateId`
  re-derives the stored body from the new template, exactly like create.
- **Clone** — `POST broadcasts/:id/clo
...[truncated 4217 chars]