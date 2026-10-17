# Messaging Advanced MB3 (MX7 + MX8 + MX9) — Batch Acceptance

Status: CODE-COMPLETE in worktree `~/workspace/ai-marketing-saas-mx`,
branch `messaging-advanced`, base `a37bae6e` (MB2 head). **Local
commits only — nothing has been pushed.** No live provider proof
anywhere in this batch (M30 still owed); the three MB3 migrations
have NOT been run on any real DB (fresh-Postgres proof only, in the
Gates section below).

Per-item detail: [messaging-mx7-acceptance.md](messaging-mx7-acceptance.md) ·
[messaging-mx8-acceptance.md](messaging-mx8-acceptance.md) ·
[messaging-mx9-acceptance.md](messaging-mx9-acceptance.md)

## Commits

| Item | Commits |
|---|---|
| MX7 | `9ad04cf8` block engine + festival packs + pure specs · `4a6f55e3` schema/migration `20261019040000_mx7_email_builder` + service + Org Settings branding · `62e3f296` web builder/library/packs/version UI · `b5d47daa` acceptance |
| MX8 | `2e56a99c` pure personalization module + specs · `83775a08` schema/migration `20261019040100_mx8_personalization` · `013f224e` service integration + specs · `e035aea8` acceptance |
| MX9 | `e4f8943c` schema/migration `20261019040200_mx9_whatsapp_rich` + pure module + carousel submit + quality guard + specs · `70995487` web hub · `426ce972` acceptance |
| MB3 | this doc |

## Step 0 — audit findings (before each item was built)

**Composer/templates (MX7 foundation).** The pre-existing
`composer-blocks.ts` is NOT a block engine — 61 lines of
product/coupon snippet formatters (its own header says so); MX7
built a real block model in a new `email-blocks.ts`, reusing its
price/escape helpers. `MessageTemplate` had no versioning and no
structured content; sends copy template content onto the Broadcast
row at creation and render the stored copies — MX7 preserves this
exactly, which is why sent history can never change when a template
or the brand kit is later edited.

**Brand home.** M59 branding already lives on the **Organization
row** (`brandName`/`logoUrl`/`primaryColor`, Settings BrandingCard,
`PATCH /organizations/:id/branding`) — that is the central place, so
MX7 extended it there (font as an allowlist key + secondary color)
instead of creating a second brand store. `BusinessProfile` carries
only `brandVoice`.

**Coupon store verdict (MX7 corrected, MX8 decided).** MS5's
free-text coupon was text-only because messaging had no coupon
store — but the org's real coupon store exists: **`StoreDiscount`**
(org-scoped, `@@unique([org, code])`) is the messaging coupon
source. The platform `Coupon`/`CouponRedemption` models are
global-code, plan-scoped, admin-created and redeemed only in the
SaaS plan checkout (`PaymentsService`) — no org, no product
checkout — and were NOT used. Single-use IS enforced on the real
StoreDiscount path: `validateDiscount` refuses at
`usedCount >= usageLimit` and at the per-customer stamped-order cap;
`DiscountsService.redeem()` increments `usedCount` at placement.

**Loyalty / gift-card reads (MX8).** Messaging imports no commerce
service (ports are for behaviour); table reads via Prisma are its
established pattern (MS3/MS5/MX7). Loyalty reads mirror
`LoyaltyService.checkoutSnapshot` (ledger-maintained
`loyaltyBalanceCache`; disabled/merged ⇒ empty). Gift cards are
bearer instruments — no per-customer API exists; MX8 sums active,
unexpired cards addressed to the recipient or self-bought
unaddressed. No ledger writes anywhere in MX8.

**WhatsApp machinery (MX9 foundation).** MS6 already syncs and
stores real Meta data: `WhatsAppTemplate.category`,
`qualityRating` (Meta's `quality_score.score`), `status`,
`components` (verbatim Json), `lastSyncedAt` — the sync field list
is pinned byte-exact by an MS6 spec. **Rejection reason is NOT
stored** (no field requested, no column) and could not be added
without breaking that pin. Only ONE flat
`whatsappCostPerMessageMinor` rate existed — per-category rates
were genuinely missing. Carousel verdict: definition/submit is
buildable (components are free Json and `createMessageTemplate`
passes the payload through unchanged; card media headers reuse the
MS6 Resumable-Upload handle precedent) but **broadcast send is
not** — `sendWhatsAppTemplate` rich params (header/body/buttons)
cannot express per-card components. Catalog authoring has no
catalog linkage anywhere in the repo (no catalog id in the template
model or the WhatsApp credential), and Flows have zero machinery
(no `/flows` client, registry, or send-time flow-token plumbing).

## MX7 — Drag-drop Email Builder & Content Library

- Real block model (text/image/button/product/coupon/divider) with
  strict validation and deterministic render into the SAME
  `body`/`htmlBody` format the existing send path renders; drag +
  ↑/↓ reorder in the composer; server-rendered preview with
  empty-slot warnings. A pre-MX7 template is spec-proven
  byte-identical through create and broadcast-from-template; the
  full messaging suite (incl. the MS5/MS7 workflow pins,
  unmodified) passes.
- Product/coupon slots resolve ONLY from real `Product` /
  `StoreDiscount` rows; unfilled, missing or inactive slots render
  empty with a reported reason — never sample data (spec-asserted,
  including that festival packs contain no ৳/%/code strings).
- Content library: `MessagingContentBlock` per org + CRUD API + UI.
- Brand kit applied at template save and re-rendered at broadcast
  creation (use time): a later kit change leaves existing
  broadcasts and templates byte-unchanged while a new broadcast
  picks up the new kit (spec-proven); a product deleted after save
  renders empty at broadcast creation (no stale price).
- Versioning: `MessageTemplate.version` + `MessageTemplateVersion`
  snapshots (create = v1, content edit bumps, no-op edit doesn't,
  restore = new version); **`Broadcast.templateVersion` is stamped,
  so sends DO record the version used** (via the broadcast row).
- Festival pack: Eid / Puja / Pohela Boishakh / winter sale
  designs — slot-only, installed via the normal createTemplate.

## MX8 — Per-recipient Dynamic Personalization

- Unique per-recipient coupon at send time on BOTH engines
  (recipient-table + legacy snapshot): real `StoreDiscount` rows
  with `usageLimit: 1` + `perCustomerLimit: 1`,
  `origin: "messaging_unique"`,
  `sourceRef: "<broadcastId>:<dedupeKey>"` — mirroring the
  abandoned-recovery and AB1 referral issuance precedents. Rendered
  via `{{uniqueCouponCode}}` (+ the auto-appended MS5 coupon line
  when unreferenced). Issuance failure is recorded per recipient
  (`couponError`), the variable renders empty — never a fake or
  silently shared code.
- **Resume idempotency, spec-proven two ways:** issued state is
  persisted on the recipient record BEFORE the provider call and
  reused verbatim (partial-send + resume and retry-failed tests:
  same code, zero new coupon rows), plus `sourceRef` claim
  recovery for the crash window between coupon create and state
  persist.
- Recommendation block: deterministic rule — most recent
  purchased category → in-stock ACTIVE catalog products, excluding
  already-purchased; identified-visitor browsing as second signal
  (Visitor matched by the recipient's own email/phone, the MX5
  rule); no signal ⇒ org fallback text or nothing. Rendered at
  send time (MX7 blocks render at template time — the wrong layer
  for per-recipient content; rationale in the MX8 doc).
- Loyalty/gift-card balance variables filled at prepare time, so
  they ride all broadcast paths; workflow sends are structurally
  untouched (they never pass through the broadcast engines).
- Segment blocks via the real MS3 evaluator with
  resolver-identical facts (saved audience or inline definition; a
  deleted saved audience matches nobody); non-members' renders are
  byte-identical.
- Create-time strict validation; personalization + WhatsApp and
  personalization + cascade are honest 400 refusals at create,
  never half-applied.

## MX9 — WhatsApp Commerce & Rich v2

- Per-category WhatsApp rates on `MessagingSenderConfig`
  (marketing/utility/authentication, additive migration); rate
  resolution is category → flat → null, and the chosen basis is
  named wherever a figure is shown. Missing rate → no figure, with
  a plain "rate not set" note. No price is ever derived from Meta.
- Template hub: category filter over the synced Meta categories,
  template-kind badges (🎠 carousel / 🛍️ catalog / 📝 flow) classified
  from the stored components, per-template cost from org-entered
  rates only, quality rating + last-synced shown with a
  RED/REJECTED warning and the carousel-send limitation note.
- Carousel: card editor (2–10 cards, media handle required, ≤2
  buttons/card, Bengali pre-Meta validation) and submit through the
  existing MS6 `createMessageTemplate` path — stored only on Meta
  success; roundtrip classification spec-proven. Sync-back + hub
  display of real catalog/flow templates works via the generic
  components storage.
- Quality guard (`MessagingSetting.whatsappQualityGuardEnabled`,
  default false): activates ONLY on real synced quality data —
  RED/REJECTED blocks new sends at broadcast create (primary/A/B/
  cascade), at edit template-swap, and at send-time sender build
  (refusal lands in the engine's build-error path). Null rating ⇒
  guard inert, stated in the UI. Workflow sends untouched.

## Gates (coordinator-run, serial — recorded as each finished)

- **API jest (full): 493 suites / 5,543 tests — 5,542 passed,
  1 failed.** The single failure is
  `connections/cc26-payout-automation.spec.ts` (1 test) — the known
  pre-existing payout-sweep failure, adjudicated on the untouched
  base during the GC-stack release and reproduced identically in
  MB1 (483/5,430) and MB2 (489/5,498) with the same single failure.
  MB3 touches no connections code. Run method: every suite executed
  exactly once (493 spec files on disk = 493 suites run), grouped
  by top-level `src/` directory, serially (`--runInBand`), jest
  cache on the workspace disk,
  `NODE_OPTIONS=--max-old-space-size=4096`. Messaging group:
  23 suites / 378 tests, all pass. Delta vs MB2 is exactly the MB3
  items' new/extended suites (MX7 19 tests, MX8 25, MX9 20 across
  the messaging + organizations + inbox groups). The cx3-debounce
  flake appeared only inside MX8's scoped workflows+inbox run and
  passed 18/18 on its solo rerun; it did not appear in this full
  run. Its root cause remains open (pre-existing, not MB3's).
- **API tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Web vitest: 83 files / 706 tests, all pass** (MB2: 82/703 —
  the delta is MX7's web specs).
- **Web tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Next build (apps/web): green** — `✓ Compiled successfully`,
  static pages 93/93, `/dashboard/messaging` at 45.6 kB (MB2:
  40.3 kB — the growth is the MX7 builder/library sections and the
  MX9 hub additions; MX8 is API-only by design, see NOT BUILT).
- **Prisma validate: valid.** Migration folders on this tree:
  **219** (216 after MB2 + MX7 + MX8 + MX9).
- **Fresh-Postgres migrate deploy: 219/219 migrations applied
  cleanly** (`All migrations have been successfully applied.`) on a
  newly created empty database (`mxfresh_mb3`); 321 public tables
  afterwards (319 at MB2 + `MessageTemplateVersion` +
  `MessagingContentBlock`); verified in the fresh DB:
  `Broadcast.templateVersion` + `Broadcast.personalizationConfig`
  present, `BroadcastRecipient.personalization` present,
  `MessagingSenderConfig.whatsapp{Marketing,Utility,Authentication}CostPerMessageMinor`
  present, `MessagingSetting.whatsappQualityGuardEnabled` present,
  `Organization.brandFont` + `brandSecondaryColor` present.

**Batch gate verdict: GREEN** — the only failing test in the
entire suite is the pre-existing, base-adjudicated cc26
payout-sweep failure, which predates MB1 and is untouched by MB3.

## NOT BUILT / honest limits (batch-wide)

- **Carousel broadcast send** — the send path's rich params cannot
  express per-card components (MX9 audit evidence). Carousel
  templates can be authored, submitted, synced and displayed;
  they cannot yet be broadcast.
- **Catalog template authoring** — no catalog linkage exists in the
  repo; the create shape is unverifiable from repo sources.
  Sync-back + display of real catalog templates works.
- **WhatsApp Flows** — zero flow machinery in the codebase (no
  `/flows` client, registry, or send-time flow-token plumbing).
  Synced flow templates are classified and displayed only.
- **Template rejection-reason storage** — Meta's reason is not in
  the sync's field list, and that list is pinned byte-exact by an
  MS6 spec; the pin was not touched.
- **Per-delivery version column** — template version lives on the
  Broadcast row; deliveries reach it via `broadcastId`.
- **MX8 web UI** — personalization is API-configured only; its
  natural home is the owner's queued post-MX Messaging design
  task. The new balance/coupon variables are also **not listed in
  the composer variable catalogue** — `ms5-composer.spec.ts` pins
  `TEMPLATE_VARIABLES` exactly and the pin was not edited; the
  variables fill and render (spec-proven) and are documented in
  the MX8 doc/API.
- **Personalization on cascade/WhatsApp broadcasts** — refused
  honestly at create (400) rather than half-applied.
- **StoreDiscount `redeem()` increment race** — a pre-existing,
  system-wide non-atomic increment (not introduced by MX8);
  issuance itself is race-safe via the unique code + sourceRef
  claim. External Woo/Shopify redemption of messaging-issued codes
  is not claimed (no store-sync push on issuance).
- **Gift-card phone matching** has a documented third-format miss
  risk (numbers stored in a format other than the two normalized
  forms can miss); email matching is exact.
- MX7 restore copies snapshot bytes exactly (no re-render); the
  block builder lives in template scope, not inside the broadcast
  form; blocks are email-only (400 on SMS, with reason). The
  `updateBranding` new-field validation mirrors the spec-covered
  primaryColor pattern but has no dedicated Organizations spec for
  its 400s (read side is spec-covered).
- MX8 per-recipient send-time reads are unbatched (correctness
  first; no throughput claim is made).
- No screenshot QA of the new web sections; no live proof anywhere
  (M30 owed); the 3 MB3 migrations have run only on the fresh
  scratch DB, never a real one.
