# Smart AI Phase 1 — Batch SA-B7 Acceptance (R1: Inbox Reply v2)

Date: 2026-10-17. Branch `smart-ai`, base `f6db663a` (SA-B6,
Phase 0 closed). Local commits only; nothing pushed.

Commits:
- `ab65716c` — Item 1a: Brain product semantic matches +
  PgVectorStore `own_customer` SQL filter tightening.
- `2c8895e7` — Item 1: inbox surfaces on the Brain (fact-pack
  product lines, capture refs, suggestDraft migration).
- `cb4c1715` — Item 2: order bot Brain question branch.
- `4c61f68c` — Item 3: specs (12 tests).
- (this doc's commit follows)

Plan of record: `Smart-AI-Full-Master-Plan-2026-10-17.md`
Phase 1 item R1 — "Inbox Reply v2: autopilot/draft/order bot
Brain-এ — semantic জ্ঞান + customer memory; guard/escalation
অপরিবর্তিত". Laws L1–L5 govern throughout.

## Step 0 — the reply-path map (brief vs code reality)

Every reply-generation path in the Unified Inbox, what
context it used before this batch, and what SA-B7 did:

| # | Path | Context before SA-B7 | SA-B7 |
|---|---|---|---|
| 1 | Autopilot LLM tier (`composeLlmGroundedReply` + `buildFactPack`) | OrgBrainService (Phase 0): audience-filtered profile/policies, hybrid knowledge, Answer Store, `own_customer` memory + style, deterministic number guard | **Verified, not redone.** The fact pack gains semantic product-knowledge lines (Item 1) — the one Brain surface Phase 0 indexed but never served |
| 2 | Autopilot deterministic tier (`composeGroundedReply`) | Pure templates over live rows (product price/stock, profile delivery/payment lines, policy by type, own order status); no LLM | **Deliberately untouched** — judgement recorded below |
| 3 | `suggestDraft` (CX1 compose-suggest) | Hand-picked JSON: profile {industry, description, brandVoice} + ALL policies (take 10) + keyword-matched product. No knowledge documents at all, no memory, no style, no Answer Store | **MIGRATED** (Item 1) |
| 4 | `ghostComplete` (CX1) | Same hand-picked JSON + a number guard whose allowed-set is computed over partial + thread + that JSON | **Deliberately untouched** — recorded below |
| 5 | `toneRewrite` (CX1) | No business context at all — rewrites the agent's OWN text; number-preservation check is self-contained | Nothing exists to migrate; recorded |
| 6 | `suggestNextAction` (IN7) | Thread + the linked order's live line only; proposes a UI action, not a reply | Not a reply-generation path; out of R1 scope, recorded |
| 7 | Order bot (`handleOrderBot`/`botStep`) | Deterministic state machine over live product rows + settings; a mid-flow question was unanswerable ("বোঝা যায়নি") | **MIGRATED at the parse-failure points** (Item 2) |
| 8 | `testComposeReply` (CX2 Instructions Desk) | Reuses tiers 1+2 with an instructions override; store bypassed by design | Untouched; inherits Item 1 through the shared tiers |
| 9 | Handover summary / translate / conversation summary | Staff-side utilities over the thread itself | Not customer replies; out of scope |
| 10 | AI chat / tools (`ai` module) | `tools knowledge()` already Brain-fed (SA-B1) | Out of scope per brief (Phase 5 copilot) |

**Step-0 findings that shaped the batch:**

1. **The product index had no retrieval consumer.** SA-B2/B4
   index the catalog's qualitative text under sourceType
   `"product"`, but `OrgBrainService.getContext` searched only
   `"knowledge_chunk"` — semantic product knowledge existed on
   disk and reached nobody. R1's "semantic জ্ঞান" for the
   inbox is therefore a Brain wiring task first (Item 1a).
2. **The vector store's SQL audience filter predates
   `own_customer`.** PgVectorStore applied `visibility =
   'public'` only for the literal `"customer"` audience;
   SA-B5's `own_customer` relied on OrgBrainService's
   live-row re-filtering alone. L3 wants the filter in the
   query itself — tightened in Item 1a (customer and internal
   behaviour byte-identical; spec-proven).
3. **The order bot has no knowledge-answer surface at all.**
   It is a pure state machine: at `ask_product` / `ask_more`
   an unmatched message earns "বোঝা যায়নি", at `ask_quantity`
   a non-number earns a re-ask. There were no "hand-picked
   fields" to swap — Item 2 adds the Brain at exactly those
   failure points and nowhere else.
4. **The deterministic tier judgement (path 2):** it composes
   from the same live rows the Brain would serve, with no
   LLM and no semantic surface; routing it through the Brain
   would add a match step where none is needed and risk
   byte-exact template behaviour for zero grounding gain. It
   stays direct — L4 (live wins) in its purest form. SA-B3
   already keeps it out of the Answer Store for the same
   reason.
5. **Ghost-complete judgement (path 4):** its number guard
   admits exactly the numbers present in the agent's partial
   + the thread + ITS hand-picked knowledge JSON. Swapping
   the knowledge source changes the guard's allowed set —
   i.e. changes guard behaviour — so per the batch's stop
   rule the path is left unmigrated and the reason recorded
   here for the Phase-1 close-out (SA-B9) to decide with
   full knowledge.

## Item 1a — Brain product semantic matches (commit ab65716c)

- `OrgBrainService.getContext` now also searches the
  `"product"` source type (same embeddings path, same
  `MIN_VECTOR_SIMILARITY` floor, capped at `matchLimit`, one
  chunk per product). New context field `productMatches:
  BrainProductMatch[]` = { productId, name, content, score,
  via: "vector" }, and sources gain
  `{ type: "product_knowledge", productId }`.
- **Admission is through the LIVE product row** — org-scoped
  re-read, `ACTIVE` only, the surfaced name is the row's
  current name. An archived/renamed/deleted product's stale
  chunk cannot speak for it (L4); another org's product can
  never appear (the search is org-bound in SQL, L1).
- The indexed text carries **no price/stock values** (the
  SA-B2/B4 indexing rule), so a match can never become a
  price source — price/stock keep arriving from live rows
  exactly as before (spec: sentinel price absent).
- Vector-only surface: without a working embeddings path
  `productMatches` is empty and the context is byte-identical
  to pre-SA-B7. Products never had a keyword description
  matcher and none is invented (honest label: semantic
  product knowledge is a hybrid-mode capability).
- The product search runs in its own try/catch AFTER the
  knowledge merge — a product-path failure degrades to "no
  product matches" and cannot disturb the knowledge result.
- **PgVectorStore**: the SQL visibility filter now applies
  to every customer-class audience (`!== "internal"`), which
  adds `own_customer` to the in-SQL filter SA-B2 wrote for
  `"customer"`. Internal searches unchanged.

## Item 1 — inbox surfaces on the Brain (commit 2c8895e7)

**Fact pack (path 1, additive):** `buildFactPack` appends
one fact line per Brain product match —
`পণ্যের তথ্য (<live name>): <chunk, 400 chars>` — after the
knowledge lines, with source `{ type: "product_knowledge",
productId }`. The number guard treats these lines like any
pack fact. `captureAutopilotAnswer` now records
`product_knowledge` sources into the store's `productIds`,
so an answer grounded on product knowledge is live
re-verified (existence / ACTIVE / name / price numbers) at
serve time exactly like a price-intent answer (L4).

**suggestDraft (path 3) migrated, output contract kept**
(one `MessageDraft` row, one `"draft"` usage row, dev-template
fallback, `checkAiAllowed("draft")` first):

1. **Answer Store first.** When the customer's latest
   message has a stored, live-re-verified answer, it becomes
   the suggested draft verbatim — `provider: "answer_store"`
   is the label (the draft row's provider field is its only
   metadata surface), a zero-token `"draft"` usage row with
   provider `"answer_store"` keeps the ledger honest, and the
   LLM is never called. Staff still review and send; nothing
   auto-sends from this path. **Guard note (recorded, per
   brief):** this path has never carried the autopilot number
   guard — human review before send is its control — and
   SA-B7 adds none; a stored answer arrives already
   re-verified against live sources inside `lookup` (SA-B3).
2. **Brain context on a miss.** The hand-picked
   profile/policy reads are gone. The drafter's knowledge
   object keeps its existing keys (`business` from
   `brain.publicProfile`, `policies` — the Brain's list
   sliced to the same 10, `matchedProduct` — still a LIVE
   keyword match, since price/stock are live-row data) and
   gains `knowledge` (hybrid document matches), `productInfo`
   (semantic product matches) and `customerMemory` (this
   customer's memory fact lines — present only under the
   `own_customer` audience, resolved with the fact pack's
   own customer-key rule, practice threads excluded).
   Owner instructions, learned style and reply language join
   the system prompt as behaviour lines with the autopilot
   prompt's exact labels ("never override the business
   knowledge" / "shapes WORDING ONLY").
3. **Dev-template fallback** unchanged: `templateDraft`
   receives the matched product and the Brain's public
   profile (it reads only `industry`); the existing spec's
   grounded-price draft is byte-identical.

## Item 2 — order bot Brain question branch (commit cb4c1715)

- New `botAnswerQuestion`: classifies the customer's text
  with the ingest classifier and makes ONE compose attempt
  through `composeLlmGroundedReply` — the autopilot's own
  fact pack (now with product knowledge + this customer's
  memory), Answer Store, and deterministic number guard,
  with usage recorded under feature `"order_bot"`. On
  success the grounded answer is sent via the bot's normal
  send path with the current step's re-ask line appended.
  The session row is never written by this branch — state
  cannot move.
- **Wired at exactly three points**, each of them a place
  where the pre-SA-B7 bot could only say "not understood":
  `ask_product` (no product matched), `ask_quantity` (not a
  number in range), `ask_more` (no product matched). On any
  failure — no real LLM, no verified pack, `NO_ANSWER`,
  guard rejection, provider error — the caller sends its
  pre-SA-B7 message **verbatim** (spec B2 proves byte
  equality with the dev provider).
- **Untouched by design:** the data steps (`ask_name`,
  `ask_phone`, `ask_address`) and `confirm` — text there is
  order data or a verdict, never a question surface; order
  creation, exactly-once semantics, stock checks,
  `createChatOrder`, cancel/handoff words, session expiry
  and the schedule gate are all byte-identical code paths.
- **Memory is context-only in the bot** (recorded rule):
  the memory reaches the compose as fact-pack context for
  THIS customer's own conversation (their language steers
  the reply language through the compose's existing
  detected-language + memory-fact discipline). It is never
  written into `session.data`: name/phone/address come
  solely from the customer's own answers at their steps,
  and the confirmation summary is built from those alone
  (spec B1 plants memory name/address sentinels and proves
  their absence from session data, the summary and the
  created customer row).

## Item 3 — Specs (commit 4c61f68c)

- `ai/sa-b7-brain-products.spec.ts` — **7 tests**: semantic
  product match surfaces with the LIVE name + source entry;
  archived product and another org's product never surface
  (and org B sees only its own); the sentinel live price
  never enters a match; `own_customer` gets matches;
  keyword-only Brain returns an empty surface;
  PgVectorStore SQL carries the public filter for
  `own_customer` and `customer`, not for `internal`.
- `inbox/sa-b7-inbox-v2.spec.ts` — **5 tests**:
  A1 the draft prompt is Brain-assembled (public doc +
  own-memory product present; internal-doc, goals, budget,
  target-customer, USP and other-customer-memory sentinels
  all absent; nothing sent);
  A2 a store hit becomes the draft verbatim with provider
  `"answer_store"`, zero LLM calls (spy), zero-token usage
  row, hit counted;
  A3 the dev-template fallback contract is unchanged;
  B1 the full webhook bot walk — semantic questions at
  `ask_product` and `ask_quantity` answered from the Brain
  with re-ask appended and state unmoved, memory sentinels
  absent from session data / confirmation / customer row,
  order created from typed data only, usage labelled
  `"order_bot"`;
  B2 with no real LLM the fallback message is byte-identical
  to the pre-SA-B7 text.

## Gates (run strictly serially; each recorded as it finished)

| Gate | Result |
|---|---|
| New specs (`sa-b7-brain-products` + `sa-b7-inbox-v2`, `--runInBand`) | **2 suites, 12/12 tests pass** |
| Targeted jest: `src/inbox src/ai src/knowledge src/automation --runInBand` | **107 suites, 993/993 tests pass** (same-scope baseline at SA-B6 close: 105 suites / 981 tests; +2 suites / +12 tests, all SA-B7) — guard + escalation suites unchanged and green, incl. `order-bot.spec`, `u3-autopilot.spec`, `cx3-debounce.spec`, `inbox.service.spec`, `nextgen-p3.spec` |
| API tsc (`tsc --noEmit -p tsconfig.json`) | **exit 0** |
| API build (`tsc -p tsconfig.build.json`) | **exit 0** |
| Fresh-PG (throwaway local PG 16.15 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **227/227 migrations applied, 0 unfinished — unchanged** (this batch adds NO migration); `vector` extension verified present |

No pre-existing failure was encountered in scope, so no
base comparison was needed (the known cc26 wallet-sweep
failure lives in `src/connections`, outside this gate's
suite set, and is untouched).

## NOT BUILT (later batches / recorded decisions — named, not implied)

- **Comment Reply v2 + the CX3 debounce fix** — SA-B8, per
  the plan (R2 makes the CX3 fix a stated precondition).
- **Reply-quality unification (R3)** — SA-B9: one
  language/voice/natural-writing rule set across channels,
  and the Phase-1 close-out. The ghost-complete guard
  question recorded in Step 0 (finding 5) is deferred to
  that close-out by the brief's stop rule, not silently
  decided here.
- **Ghost-complete Brain migration** — deliberately not
  done (Step 0, finding 5): its number guard's allowed set
  is derived from the very knowledge JSON a migration would
  replace.
- **Answer Store capture from bot answers** — the bot READS
  the store (inside the shared compose) but its sends do
  not write entries; capture stays an autopilot-send and
  staff-edit behaviour (SA-B3 scope), so the store's
  provenance vocabulary is unchanged.
- **Staff-edit capture for `answer_store` drafts** —
  `sendDraft`'s capture fires for autopilot drafts
  (`provider === "auto-reply"`); a staff edit of a
  store-sourced draft sends normally but does not rewrite
  the entry in this batch (the entry remains governed by
  live re-verification; P9's management surface can disable
  it). Recorded, not hidden.
- **Product coreference in bot questions** — a question
  that never names or describes the product ("এটা কেমন?")
  matches semantically only as well as the embedding does;
  below the Brain's similarity floor the bot honestly falls
  back to its re-ask instead of guessing which product was
  meant.
- **Live verification of any kind** — no migration has run
  on the real database (none is added here), no real LLM /
  embedding / Meta call has been made; the full-app boot
  block from the pre-existing TelegramClient/ThreadsClient
  bug is unchanged and remains owed to this line at
  integration (recorded at SA-B6). M30 still owed.
