# Messaging Advanced MX9 — WhatsApp Commerce & Rich v2 · Acceptance

Status: CODE-COMPLETE in worktree `~/workspace/ai-marketing-saas-mx`,
branch `messaging-advanced`, base `e035aea8` (MB1+MB2+MX7+MX8).
**Local commits only — nothing has been pushed.** No live Meta
proof (M30 still owed); the MX9 migration has NOT run on any real
DB. Migration: `20261019040200_mx9_whatsapp_rich` (after MX7
`20261019040000`, MX8 `20261019040100`).

Commits:
- `e4f8943c` — schema + migration, pure `whatsapp-rich` module,
  carousel submit (InboxService), quality-guard enforcement,
  per-category rates + category-aware estimate, MX9 specs.
- `70995487` — web hub (category filter, kind badges, per-template
  cost, RED/REJECTED warning, carousel card editor, rate inputs,
  guard toggle, preview category wiring).
- (this doc's commit follows)

## Step-0 audit findings

### 1. MS6 WhatsApp machinery (verified in code)
- `WhatsAppTemplate` (schema ~line 5121): `category` (String?,
  "UTILITY | MARKETING | AUTHENTICATION (as in Meta)"),
  `status` (Meta's, as returned), `qualityRating` (String? —
  "quality_score.score as returned (GREEN | YELLOW | RED |
  UNKNOWN)"), `components` (Json, verbatim), `metaTemplateId`,
  `lastSyncedAt`. Null status on legacy rows = never verified.
- Sync (`InboxService.syncWhatsAppTemplates`, client
  `MetaMessagingClient.listMessageTemplates`): requests fields
  `name,language,category,status,quality_score,components,id`
  (URL pinned byte-exact by the MS6 spec) and STORES Meta's real
  category, the quality score (`quality_score.score`, string or
  object form), the components verbatim, status and
  `lastSyncedAt`, upserted by (org, name, language); a complete
  walk marks absent locals `NOT_ON_META`.
- Submit (`InboxService.submitWhatsAppTemplate`): validates
  locally (name rule, category ∈ MARKETING/UTILITY/
  AUTHENTICATION, body examples, header text/image-with-handle,
  ≤10 buttons of type url/quick_reply only) and builds UPPERCASE
  create-format components (HEADER/BODY/BUTTONS); the client
  `createMessageTemplate` passes the payload through unchanged
  to `POST /{waba-id}/message_templates`; the row is stored ONLY
  on Meta success, with Meta's returned status (PENDING default).
- Sends (`MessagingService.createWhatsAppSender` +
  `MetaMessagingClient.sendWhatsAppTemplate`): resolves the
  template row by id; rich params support header media/text and
  url/quick_reply button params ONLY — no carousel/catalog/flow
  component can be expressed in the send payload today.
- **Rejection reason: NOT stored.** The sync's field list does
  not include any rejection-reason field, and there is no column
  for it. The field list is pinned byte-exact by an MS6 spec, so
  MX9 does not change it (see NOT BUILT).

### 2. Rates (verified)
- `MessagingSenderConfig` carried exactly ONE flat WhatsApp rate,
  `whatsappCostPerMessageMinor`, plus SMS/email rates — NO
  per-category rate existed. MX2's cheapest-first and MS4's
  preview estimate both use that flat rate. The web hub showed
  quality (`মান: …`) + last-synced per template already, but no
  per-template cost and no category grouping/filter.

### 3. Per-sub-item verdicts (verify-first)
- **Category organization + honest cost — BUILDABLE.** Category
  and quality are already real synced data; only the
  per-category rate storage and hub organization were missing.
- **Carousel templates — definition/submit BUILDABLE;
  broadcast send NOT buildable on the existing path.** The
  model stores components as free Json (create + sync formats
  both fit verbatim) and the create client passes the payload
  through unchanged, so a `{type:"CAROUSEL", cards:[{components:
  [HEADER(format IMAGE|VIDEO, example header_handle), BODY,
  BUTTONS?]}]}` component in Meta's documented create format
  rides the existing submit path without changing it. Card media
  headers need Resumable Upload example handles — the same
  externally-obtained handle the MS6 image header already
  requires, so no new unproven machinery is introduced. The SEND
  path is the boundary: a carousel send needs a per-card
  component (each card's media + params) in the messages
  payload, which `sendWhatsAppTemplate`'s rich-params shape
  cannot express — recorded NOT BUILT below, and the hub says so
  on carousel rows instead of implying send support.
- **Catalog templates — authoring NOT BUILT; sync/display
  already real.** Nothing in the repo links a WABA to a Meta
  product catalog (no catalog id anywhere in the template model
  or the WhatsApp integration credential), and the catalog
  template create shape cannot be verified from any source in
  this repo — authoring one would mean inventing the linkage.
  Catalog templates created in WhatsApp Manager DO sync back
  through the existing sync (components stored verbatim) and are
  now classified/displayed as Catalog in the hub.
- **WhatsApp Flows — NOT BUILT.** Evidence: zero flow machinery
  anywhere in the repo (no `/flows` client method, no flow
  registry or id storage, no flow-token/action plumbing in the
  send rich-params, whose button sub_types are only
  url/quick_reply). A flow button definition would reference a
  flow this system can neither create, verify, nor parameterize
  at send time. Synced templates that already carry a flow
  button ARE classified/displayed as Flow in the hub (real
  stored components).
- **Quality guard — BUILDABLE on real data.** The sync really
  returns and stores `quality_score.score` and `status`, so the
  guard is built on exactly those fields (option (a) in the
  task): rating null → guard inert, stated in UI copy
  everywhere the guard appears.

## Shipped

### Schema + migration `20261019040200_mx9_whatsapp_rich` (additive only)
- `MessagingSenderConfig.whatsapp{Marketing,Utility,
  Authentication}CostPerMessageMinor` (Int?, org-entered).
- `MessagingSetting.whatsappQualityGuardEnabled` (Boolean,
  default false = pre-MX9 behaviour).

### Pure module `apps/api/src/messaging/whatsapp-rich.ts`
- `templateKindFromComponents` — carousel/catalog/flow/standard
  from stored components, both Meta formats (case-insensitive).
- `resolveWhatsAppRateMinor` — category rate → flat fallback →
  null (no figure). Basis is reported, never hidden.
- `qualityGuardDecision` — blocks ONLY on qualityRating RED or
  status REJECTED while enabled; null rating never blocks.
- `buildCarouselComponent` + `CarouselValidationError` — the
  documented create-format CAROUSEL component; 2–10 cards, media
  header handle required per card, body examples per positional
  param, ≤2 buttons/card, MS6-identical button rules, Bengali
  errors thrown before any Meta call.

### Carousel submit (InboxService)
- `SubmitWhatsAppTemplateDto` + service accept optional
  `carouselCards`; the CAROUSEL component is appended after the
  BODY; a template-level header with cards is refused (cards
  carry the headers); validation errors are Bengali 400s with
  zero Meta calls; Meta rejections remain verbatim and store
  nothing; the stored row's components classify back as
  "carousel" (spec-proven roundtrip).

### Quality guard (MessagingService)
- `MessagingSetting.whatsappQualityGuardEnabled`, read
  defensively (missing row/column/table = OFF), written through
  the strict settings update (real boolean), exposed in the
  settings view.
- Enforcement via `assertWhatsAppTemplateNotQualityBlocked`:
  broadcast CREATE (primary template, both A/B variants,
  cascade-into-WhatsApp template), broadcast EDIT template
  swap, and SEND time (inside `createWhatsAppSender`, so a
  template that turned RED after create stops the send; the
  refusal lands in the engine's build-error path and is
  recorded on the pending entries). Workflow sends untouched.

### Honest per-category cost
- `updateSenderRates` + the safe view carry the three new
  rates (same non-negative-integer discipline, secret-free view
  unchanged in kind).
- Preview cost estimate: when the preview names a WhatsApp
  template (new optional `whatsappTemplateId` on the preview
  DTO, wired from the composer), the template's stored Meta
  category selects the org's category rate, falling back to
  the flat rate; the basis string says which rate was used. No
  rate at all → estimate stays null, exactly as MS4.

### Web (dashboard Messaging page)
- Hub: category filter (ALL / MARKETING / UTILITY /
  AUTHENTICATION / category-unknown) over the SYNCED category;
  kind badges (🎠 Carousel / 🛍️ Catalog / 📝 Flow) from stored
  components; per-template cost line ONLY from org-entered
  rates (category first, flat fallback, basis named) or the
  plain "হার সেট করা নেই" note; quality badge turns red on
  RED, a RED/REJECTED warning line, a "quality unknown — sync"
  note when no rating exists, last-synced time (already shown),
  and an honest carousel-send limitation note on carousel rows.
- Submit form: carousel card editor (2–10 cards; image/video
  header + handle, body + examples, up to 2 buttons per card).
- Sender rates form: the three per-category WhatsApp rate
  inputs alongside the flat rate. Settings form: the
  quality-guard toggle with its inert-without-data rule stated.

### Specs — `apps/api/src/messaging/mx9-whatsapp-rich.spec.ts` (20)
Pure kind/rate/guard/carousel-builder tests; carousel submit at
the mocked global-fetch seam (payload pinned, pre-Meta refusals
make zero fetch calls, Meta rejection stores nothing); guard at
create (RED refused / guard-off allowed / null-rating allowed /
REJECTED refused) and at send build (RED refused, GREEN builds);
settings roundtrip; rates update + safe view; category-aware
estimate (category 800 vs flat 500 vs null).

## Scoped gates actually run (serial)
- MX9 spec: **20/20 pass**. MS6 spec: **pass** (unmodified).
- API jest `src/messaging` + MS6: **24 suites / 400 tests, all
  pass**. API jest `src/inbox` (InboxService touched): **55
  suites / 570 tests, all pass**.
- API tsc (`npx tsc --noEmit`): **clean**. Web tsc: **clean**.
  Web vitest: **83 files / 706 tests, all pass** (703 at MB2 +
  MX7/MX8-era files; no web spec removed).
- Prisma validate: **valid**. Migration folders: **219**
  (216 at MB2 end + MX7 + MX8 + MX9).
- NOT run here (coordinator's batch gates): full API jest,
  fresh-Postgres migration union, Next build.

## NOT BUILT (with reasons)
- **Carousel broadcast SEND** — the send payload cannot express
  per-card components (media + params per card) in
  `sendWhatsAppTemplate`'s rich-params shape; submitting/
  syncing/displaying carousel templates is built, sending them
  is not, and the hub states this on carousel rows. A send
  attempted anyway surfaces Meta's own error verbatim on the
  deliveries — never a fabricated success.
- **Catalog template authoring** — no catalog linkage exists
  anywhere (no catalog id in the template model or the WhatsApp
  credential) and the create shape is unverifiable from repo
  sources; inventing it would violate the honesty rules.
  Sync-back + hub display of real catalog templates works via
  the generic components storage.
- **WhatsApp Flows (definition + send)** — no Flows API client,
  registry, verification or send-time flow-token plumbing
  exists in this repo; a pasted flow reference could not be
  verified or parameterized. Synced flow templates are
  classified/displayed in the hub.
- **Rejection-reason storage/display** — the MS6 sync's field
  list is pinned byte-exact by an existing spec and carries no
  rejection-reason field; there is no stored value to display.
  (Sync still stores Meta's REJECTED status, which the guard
  and hub use.)
- **Payment links** — unchanged owner rule; catalog display
  adds no payment path (and catalog authoring is not built).

## Deviations / notes
- The guard lives on `MessagingSetting` (the MS2/MX3 settings
  home) rather than the sender config — the settings patterns
  (frequency cap, opt-in, quiet hours) all live there, and the
  toggle sits next to them in the UI.
- Template-kind classification is computed from stored
  components wherever it is displayed (pure helper on the API,
  mirrored helper on the web) — no new column, no backfill, and
  nothing is claimed about templates whose components were
  never synced (they classify as standard with no components).
