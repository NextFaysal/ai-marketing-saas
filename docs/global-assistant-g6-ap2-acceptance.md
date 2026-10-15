# G6 (Entity Context) + AP2 (Input & Knowledge) — Acceptance

Owner: "Bake golo start koro to" (2026-10-12 23:15 +06) — start
the remaining named items from the v2 report: **G6** and **AP2**.
Built as five sequential local commits. Owner-decision items from
the original plan (specialist personas, autonomy level 2,
per-tenant white-label depth, assistant API) were NOT started —
they remain the owner's to open.

## Commits (local only, not pushed)

1. **G6 `bd864bd`** — entity context + @-mention picker.
2. **G6b `283e737`** — select-to-ask bubble.
3. **AP2a/c `c364681`** — chat attachments (documents + images).
4. **AP2b `6c86116`** — voice input.
5. **AP2d `a3b9bef`** — "AI যা জানে" org-memory card.
6. A small fix commit for `ai.dto.ts` imports (see Gates).

## G6 — Entity context, security-first (as the v2 plan demanded)

- The client sends only `{type, id}` (`EntityContextDto`,
  `@IsIn` order/customer/product/campaign). Facts are loaded
  **server-side, org-scoped** in `ChatService.buildEntityContext`
  with deliberately small field sets (order number/status/total/
  payment/date; customer name/phone/order-count; product
  name/SKU/price/stock/status; campaign name/objective/statuses) —
  no addresses, no internal notes. A foreign or unknown id yields
  **no block and no error** (spec-proven), and the entity is never
  stored on the message (spec-proven: the stored content is exactly
  what the user typed; the composed prompt carries the block).
- Audit finding that shaped the UX: the dashboard has **no
  /[id] detail routes at all**, so URL-derived entity context
  would never trigger. The @-mention picker is therefore the
  attachment mechanism on both surfaces.
- `MentionsService` + `GET ai/mentions?q=` — one org-scoped search
  across orders (number), customers (name/phone/email), products
  (name/SKU) and campaign plans (name), 4 per type, minimal
  label/sub only (facts never ride through search). Shared
  `MentionPicker` in the panel and the AI page: "@" + ≥1 char
  opens it (same capture-phase keyboard contract as the prompt
  picker — Enter picks, never sends), picking inserts a visible
  "@label" token and pins a structured ref chip (removable); the
  ref rides with the next send only.
- **Select-to-ask:** selecting 10–500 chars of dashboard text
  (whitespace-normalized, unit-tested) offers a floating "✦ AI-কে
  জিজ্ঞেস করুন" bubble; clicking opens the panel with the quote
  prefilled as ordinary user-visible composer text. Selections in
  inputs/textareas/the panel never trigger it.

## AP2a/c — Chat attachments with honest citations

- `POST ai/chat/attachments` (multipart, 10MB cap):
  documents (txt/md/pdf/docx) go through the **existing CX9
  knowledge extractor** verbatim (same magic-byte discipline and
  honest Bengali rejections); CSV decodes as strict UTF-8 text;
  images (jpg/png/webp) go through **VisionService** with a new
  `vision_chat` daily-limit feature — the stored text is the
  vision model's description, labelled as an AI description.
  Vision unavailable (no provider / dev mode) → the attach fails
  with the verbatim reason; nothing is fabricated (spec-proven).
- Text is capped at 12,000 chars (truncation flagged) and **stored
  on the user message** (`AIMessage.attachmentName/Kind/Text`,
  migration `20261012230000_ai_message_attachment` — additive
  nullable columns, NOT run on any real DB yet). Composition adds
  the attachment as user-provided DATA with an explicit
  cite-the-file-name instruction (spec-proven). Both bubbles render
  an attachment chip whose expander shows exactly the text the
  assistant was given — citations stay truthful after reload.

## AP2b — Voice input

- Browser speech-recognition dictation (bn-BD ⇄ en-US toggle) in
  both composers via `useVoiceInput`: interim/final results fold
  into the composer as **editable text — never auto-sent**. The
  mic renders only where the browser actually supports the API
  (Chrome family); elsewhere it is simply absent, no fake fallback.
  Result folding is unit-tested.

## AP2d — Org memory, visible (no silent learning)

- The AI page gains an **"AI যা জানে"** card fed by the existing
  Business Brain completeness endpoint and business profile:
  percent complete, real counts (products/FAQ/documents/policies),
  every section's done/missing state with the server's own
  Bengali hints verbatim, custom-instructions presence and reply
  language — plus edit links to Knowledge, AI Instructions and
  Settings. Editing lives in those existing surfaces; the
  assistant learns nothing silently, exactly per the plan.

## Gates

- API `jest src/ai/`: **127/127** (16 suites — +mentions 3,
  +attachments 7, +entity/attachment stream specs). API tsc clean
  in `src/ai/` — the gate caught a real bug pre-commit: the new
  DTOs used `@IsIn`/`@ValidateNested`/`@Type` without imports
  (ts-jest transpiles without type-checking, so specs passed while
  the Nest runtime would have failed); fixed and committed.
- Web vitest: **124/124** (16 files — +mentions 4, +selection 3,
  +voice 3). Web tsc clean. Prisma schema valid.
- `next build` green (compiled; AG temporary-restore procedure,
  `git status` verified **identical** afterwards — AG tree and IN
  worktree untouched).

## Honest limits

- No live visual QA (no running app in the sandbox).
- Migrations `20261012220000` (GV3) and `20261012230000` (AP2)
  have not run on any real database — deploy must run migrations,
  or the prompts/attachment columns will 500/misbehave.
- Attachments are processed per message (the file itself is not
  retained — only its extracted text/description, capped); image
  questions depend on a real LLM provider being configured.
- Voice dictation quality is the browser's (Chrome BN recognition
  varies); server-side STT remains the inbox pipeline's domain.
- NOT pushed (owner push gate unchanged).
