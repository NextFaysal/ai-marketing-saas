# Multi-Language MB5 — Acceptance (ML13 AI unification · ML14 automation · ML15 NF5 + coverage)

Batch: MB5 of the Multi-Language Master Plan (§৬) — the last build batch
before MB6 hardening. Built on MB4 HEAD `552e6cc2`, branch `multi-language`,
worktree `~/workspace/ai-marketing-saas-i18n`.
Final code HEAD: `2cd7f9ab` (this doc commits on top). Local commits only —
**no push** (owner rule).
One migration: `20261121000000_mb5_message_template_variants`.

## Commits

| Commit | Scope |
|---|---|
| `9ce95335` | Step-0: `ai/owner-language.ts` resolver (D-MB5-1) + spec; messaging draft default on the resolver |
| `894c8a4d` | ML13: owner-facing AI consumers + inbox handover/templateDraft + resolver hardening |
| `34c6a2db` | ML14: order-notification per-locale config + workflow template variants (migration) |
| `0553e4da` | ML15: Category + BlogPost-title translations, coverage endpoint + admin page, web panels |
| `2cd7f9ab` | CD-9 finishing: panels mounted, coverage in admin nav, ON web editor variant-safe |

Worker split (disjoint, per the MB5 inventory): W-1 = ML13 (ai/social/
review-insights/support/inbox hunks), W-2 = ML14 + ML15 (order-notifications,
workflows, messaging CRUD, translations, admin, web panel). Workers did not
commit; the coordinator reviewed, assembled and committed per item. One
owner per file throughout (the MB2 lesson); `messaging.service.ts` was
single-owner W-2, with W-1's one hunk inside it landed by the coordinator
at step-0 before workers started.

## Decisions — as taken

All six inventory recommendations (D-MB5-1…6) were **adopted**; the
coordinator decisions CD-1…CD-9 are recorded in the batch record
(`hidden_files/multi-language-mb5-record.md`). The load-bearing ones:

1. **Owner-facing precedence (D-MB5-1):** `resolveOwnerLanguage` =
   per-call dto → org `aiReplyLanguage` (pinned bn/en) →
   `Organization.dashboardLocale` → acting `User.preferredLocale` → bn.
   Business language policy outranks display locales.
2. **The customer chain did NOT change.** The shipped Smart-AI R3
   precedence in `ai/reply-quality.ts` (`resolveReplyLanguage`:
   override → owner aiReplyLanguage → explicit org → detected → memory
   languagePref → bn) is spec-pinned and was left byte-untouched. The
   plan §৬ ML13 sentence describes a near-identical chain without the
   per-call override rung and ending at "org default" instead of the
   platform bn default — **the shipped chain wins over the plan text**;
   this deviation is recorded here deliberately. MB5's ML13 work was
   consumers, not a re-unification.
3. **ML14 depth (D-MB5-2 option ক):** order notifications got the full
   per-locale treatment as a **config-shape** extension of MB4's
   machinery (no second mechanism, no migration — the config is Json);
   workflow/journey sends got a variant-if-exists hook, not a full
   variant system. Broadcast personalization Tier-2 (already
   recipient-language-aware) was not touched.
4. **ML15 order (D-MB5-4):** Category first, BlogPost **title only**.
   Voice (D-MB5-5) stayed out of scope. Proactive's bn-body/en-title
   mix (D-MB5-6) was unified onto the owner chain.

## Item audit

### ML13 — AI language unification

**The resolver (new, step-0):** `apps/api/src/ai/owner-language.ts` —
pure `resolveOwnerLanguage` + `resolveOwnerLanguageForOrg` (defensive
fetcher: a missing/incomplete/rejecting model read degrades its rung
to "no signal", never throws into a compose path — hardened at
assembly after W-1 found partial spec doubles could trip the bare
`?.` chain; spec-pinned, 9/9).

**The 24 decision points (inventory §১) — final accounting:**

| Points | Verdict |
|---|---|
| #1–#4 inbox autopilot, suggestDraft, order bot, comment AI | **Already unified pre-MB5** under R3 — verified, untouched |
| #5 copilot | **Unified** — private resolveLanguage now delegates to the owner resolver (dto → aiReplyLanguage → dashboardLocale → acting user → bn) |
| #6 owner chat | **Unified** — verified NO caller passes a language anywhere (DTOs have no language field); absent → filled from the resolver at the service entry and the prompt carries a firm directive (before: a soft "prefers" line over a detected-language default). Explicit override keeps the old behaviour exactly |
| #7 ads narration | **Unified** — binary `aiReplyLanguage === "en"` check replaced by the resolver |
| #8 Answer Store matching | **Left by design** — language-match infrastructure, not a compose decision; consistent with the resolver's detected rung |
| #9 customer-memory producer | **Left by design** — it *produces* the memory rung (observed languagePref), it does not decide |
| #10 voice | **Left by design / scope-out** (D-MB5-5) — `conversationLanguage` is a voice-specific setting; MB4 already fixed its TwiML fallback bug |
| #11 messaging AI draft | **Unified at step-0** — hardcoded bn default → resolver (actor is the user rung) |
| #12 messaging translation tool | **Untouched by design** — an explicit targetLanguage IS the tool's contract |
| #13 social-ai, #14 content-generation, #15 creative-studio, #16 reports | **Defaults unified** — the dto still wins per call (the family design); the absent-dto default now comes from the one resolver instead of four separate `?? "bn"` / ternary copies |
| #17 handover summary (`summarizeConversation`) | **Converted** — hardcoded "in Bengali" → the conversation's language via the CUSTOMER chain (org → detected from latest inbound → memory); the no-LLM data digest renders in the same language |
| #17b handover summary NOTE (`writeHandoverSummaryNote`) | **Converted** (coordinator finishing hunk; a second hardcoded "(Bengali, …)" site W-1 found beyond the inventory's map) — same customer-chain rule with the inputs its site has (org + detected; no conversation row in scope for the memory rung) |
| #18 templateDraft (no-LLM fallback) | **Converted** — full English template set added beside the Bangla set, branch-for-branch, selected by suggestDraft's hoisted `resolveReplyLanguage` result (the LLM and fallback paths now share ONE resolution); "mixed" → Bangla set (recorded choice; the LLM path renders true Banglish) |
| #19 review-insights | **Converted** — hardcoded "in Bengali" → owner chain |
| #20 social coach | **Converted** — LLM prompt + the deterministic `buildCoachSummary` fallback both follow the owner language (bn default keeps existing callers byte-identical); the owner notification title follows the digest language |
| #21 support suggestion | **Converted** — the AI instant-tip prompt follows the owner chain (org rungs; the site receives no acting user) |
| #22 proactive briefing | **Converted** — briefing body AND anomaly title now compose in ONE resolved owner language (was: Bangla body + English "Anomaly Alert — …" title, org language never consulted). The anomaly *body* remains the detector's own `a.message` text (detector-owned data, not briefing copy) |
| Competitor review-miner angles, video-deconstructor | **Left by design** (D-MB5-3) — the deconstructor's bn+en output is a designed bilingual deliverable; the miner's angles are shipped analysis content, not a language decision point |

Owner-chat behaviour note (honest delta): on the no-language path,
dev-template answers and follow-up suggestions now follow the owner
chain rather than the incoming message's detected language — that is
the unification working as intended (the owner assistant answers in
the business's language), and it is spec-covered.

Also observed and left: messaging `planCampaign` writes its draft in
the *goal's own* language — a content decision by design, not a dto
default.

### ML14 — Automation language

- **Order notifications — full per-locale (builds on MB4/ML11, one
  mechanism):** `templates[channel]` may now be a plain string
  (generic override — meaning unchanged; every existing stored config
  behaves byte-identically) or `{ bn?, en? }`, the merchant's own
  per-locale overrides. `templateForLocale` resolution: exact-locale
  variant → generic string → **catalog default in the recipient
  locale** (MB4's send-locale machinery). An object holding only the
  other locale deliberately falls to the recipient-locale catalog
  default — serving the other language's text anyway would recreate
  the mixing problem. `validateConfig` accepts both shapes and
  validates variables per locale entry (+2 catalog keys);
  `mergeConfig` degrades malformed fragments to defaults. Money vars
  (`total`/`due`) now render per recipient locale: **bn → Bengali
  digits** (Intl bn-BD, matching the contracts formatter's pinned
  behaviour — "৳১,২৫০.৫০"); en unchanged. One deliberate spec pin
  changed (bn money in on5), commented in the spec. D-MB4-5 stands:
  merchant text is never machine-translated — ML14 added the
  merchant's OWN variants, not translations.
- **Workflow/journey variant-if-exists:** `MessageTemplate.variants
  Json?` (migration `20261121000000…`; shape `{ bn?: {subject?, body?,
  htmlBody?}, en?: {…} }`) with one shared helper
  (`messaging/template-variants.ts` — strict validation, non-destructive
  apply). Template CRUD validates/returns variants (invalid →
  catalogued 400, new key `messaging.templateVariantsInvalid`). The
  workflow engine's send_email / send_sms / issue_recovery_coupon
  paths resolve the recipient locale through the real
  `resolveCustomerLocale` and apply a variant field only when present
  and non-empty for that locale — otherwise the authored text goes
  verbatim, and templates without variants cost zero extra lookups.
  Journey presets were verified to send through these same engine
  steps, so they inherit the hook with no preset changes.
- **Web editor (CD-9):** the order-notification settings page now
  understands the object shape — it displays the current UI locale's
  variant (never the other locale's text as this locale's), edits
  land on that locale's entry only, and the other variant survives a
  save verbatim (before this fix, an edit would have silently
  flattened the object into a plain string).
- **Audited, no hook (evidence-based):** abandoned-checkout recovery
  uses NO template at all — three fixed inline Bangla preset texts
  (store email, cart email, WhatsApp-link text); with no template
  identity there is nothing for a variant to attach to, and
  workflow-driven recovery is covered by the engine hook.
  `automation.service.ts` renders no MessageTemplate either — its
  hardcoded Bangla greeting is an inline-composed **staff billing**
  email (dunning) with no recipient-language identity; left by design
  rather than inventing a locale for it.

### ML15 — NF5 expansion + coverage

- **Category (name, description):** full NF5 parity with product —
  `assertEntity` branch, org-scoped 404 mirror, list endpoint, AI
  draft endpoint (draft + `source: "ai"`; approval required before
  anything is public — ML-L6 intact). Public read:
  `approvedCategoryTexts` (approved-only, org-scoped) wired into the
  shop payload — category **name** overlays on shop home + PDP.
  Category *description* is served in no public payload (verified),
  so there is nothing to overlay; staff-side management for it is
  built and the overlay is one call away when a payload serves it.
- **BlogPost (title only):** same pattern (`blog_post`, field `title`;
  `content` is refused with a catalogued 400). Public blog DOES serve
  titles — approved overlays wired on both the public list and the
  post detail, in the storefront locale.
- **Panels mounted (CD-9):** the generalised
  `EntityTranslationsPanel` ships as `CategoryTranslationsPanel`
  (mounted in the products-page category manager's edit form) and
  `BlogPostTranslationsPanel` (mounted in the blog editor for
  existing posts). The product panel is byte-identical.
- **Coverage:** `GET /admin/translations/coverage`
  (SuperAdminGuard + SUPER tier, the AdminAiController pattern) —
  `ContentTranslation` groupBy (org × entityType × locale × status)
  with denominators Product ×2, Category ×2, storefront constant 3,
  BlogPost ×1; per-org rows + platform totals. The payload labels its
  locales `localeKind: "content"` (bn/en/**hi**) so content locales
  are never confused with the UI's bn/en (D5). Admin page at
  `/translations` (+ nav item in the growth group) with honest
  loading/error/empty states and no fabricated numbers; one new
  admin dictionary namespace (`translationCoverage`, bn/en parity).

## Gates (settled tree, serial, recorded as each finished)

- **Targeted specs during build:** owner-language 9/9 · ms9-ai 18/18 ·
  on5 27/27 · translations 26/26 · catalog parity · template-variants
  8/8 · workflows-mb5 7/7 · coverage 4/4 · W-1's module set (copilot,
  chat 8/8, chat-stream 20/20, social-ai 19/19, content-generation
  13/13, proactive 10/10, support 9/9 + 9/9 + 5/5, inbox suites,
  sa-b9-reply-quality 10/10, review-insights 10/10, …) green except the
  adjudicated pair below · regressions mx4/ab7 19/19, ms5/mx7 46/46,
  ab6-blog 11/11.
- **API jest, full suite, chunked per directory** (single-process runs
  OOM on this box — MB1 precedent): **638 suites / 7,375 tests —
  7,366 pass, 9 fail.** All 9 are the pre-adjudicated set, each
  identified by solo re-run: ads-intelligence ×2, adx3-nav-counts ×1,
  sa-b18 competitor (actions ×1 + response ×1), social-sn9 ×2,
  cc26-payout-automation ×1, mx11-intelligence ×1 (documented
  24h-boundary flake). **Zero failures in MB5-touched code.**
  (638 vs 637 spec files: jest's `src/social` pattern also matched
  `src/social-proof`, whose passing suite ran twice — verified via
  --listTests diff.)
- **API tsc (build config) + build: PASS** (0 errors, dist emitted).
- **Web vitest: 139 files / 1,140 tests, ALL PASS · web tsc: 0.**
- **Admin vitest: 18/18 PASS · admin tsc: 0.**
- **Next builds: web PASS · admin PASS.**
- **Fresh-PG: 282/282 migrations** applied on empty PostgreSQL 16
  (incl. `20261121000000_mb5_message_template_variants`);
  `MessageTemplate.variants` verified jsonb + nullable in
  information_schema. Scratch DB dropped, cluster restored to down.

### Adjudicated failures (not MB5 regressions)
The seven date/weekday-window suites (ads-intelligence, adx3,
sa-b18 ×2, social-sn9, cc26) fail on ageing windows — findings and
fixtures dated mid-October falling out of recency/slot windows;
ads-intelligence and sn9 were stash-verified identical on the
pre-worker base (`9ce95335`) during the build, sa-b18 was base-proven
in MB4, and none of the failing assertions touches a language path
(ads-intelligence's MB5 diff is the narrate() language source only;
its failures are spend totals). mx11 is the documented
non-deterministic 24h-boundary flake (MB4 adjudication).

## Exceptions — remainders, each listed deliberately

1. **Proactive strings are call-site bilingual, not catalogued.**
   No proactive namespace existed in the API catalog; rather than
   invent a parallel mechanism mid-batch, the briefing composes from
   bn/en string pairs selected by the resolved language. A
   `proactive` catalog namespace (~10 keys) is the tidy follow-up.
2. **Handover note scaffolding stays Bangla.** The AI summary inside
   `writeHandoverSummaryNote` follows the conversation language; the
   note's label and the "summary could not be created — …" fail-note
   boilerplate are staff-note scaffolding text in bn (the same class
   of remainder MB4 listed for staff-facing note text).
3. **Support's predefined keyword suggestions** are static Bangla
   content (a content table, not the AI path — the AI instant-tip
   prompt is unified).
4. **MX7 version snapshots do not carry `variants`** — restoring a
   template version never touches variants (either direction). This
   is recorded in the schema comment; versioning variants is future
   work if merchants ask for it.
5. **The old catalog key** `translations.entityTypeMustBe…String`
   is retained (retired, unreferenced) for parity/history.

## NOT BUILT / partial (explicit)

- **BlogPost content translation — NOT BUILT** (CD-5): title only;
  long-form content drafts are a separate step (AI cost/length).
- **Category description public overlay — NOT WIRED:** no public
  payload serves a category description today (verified); the
  translation management + approved-read helper exist.
- **Abandoned-checkout per-locale sends — NOT BUILT:** the recovery
  texts have no template identity (three fixed inline presets);
  giving them variants needs a template-identity design first.
- **Automation (billing/dunning) email language — NOT BUILT:**
  staff-facing inline emails, no recipient-language concept exists
  at those sites (left by design, evidence in the record).
- **Direct messaging/broadcast template variants — NOT BUILT:**
  broadcasts already personalise by recipient languagePref at
  Tier-2; the variant hook covers workflow/journey sends only
  (D-MB5-2 scope).
- **Proactive catalog namespace — NOT BUILT** (see Exceptions 1).
- **Live proof — NONE:** nothing in MB5 is verified against a
  running deployment; all evidence is unit/integration tests on
  fake persistence plus the fresh-PG migration run. M30-style live
  verification remains owner-gated, as with every prior batch.
