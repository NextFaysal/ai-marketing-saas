# Social Posts Update — Batch 3 Acceptance (SU5 + SU6)

**Status:** Delivered (local commits on `su-package`, on top of Batch 2
`e020a82`; NOTHING pushed). Plan: `docs/social-posts-update-plan.md`,
Batch 3. Evidence ceiling, stated plainly up front: **no live platform
publish, click or order was exercised for this batch** — SU5's hooks
and SU6's redirect/association are proven at the service boundary
with fakes; a real tracked FB click → order association is an
SU0/SU12 live-verification item.

## Migration

One hand-written additive migration:
`20261013420000_su5_su6_commerce_links` — new tables
`SocialAutoDraftConfig` (org unique; 4 toggles default FALSE;
`maxDraftsPerDay` default 3; `socialAccountId` FK → SocialAccount,
SetNull) and `SocialLinkClick` (`userAgent` VarChar(300); indexes
`(socialPostId, clickedAt)` and `(organizationId)`); `SocialPost`
gains `linkToken` (unique, nullable), `autoDraftKind`,
`autoDraftRef`; `Organization` gains `socialLinkWindowDays`
(default 7). Before writing it, this worktree (last
`20261013410000_su3_su4`) and the adv worktree (last
`20261013310000_cc11_health_checks`) were checked: nobody had taken
420000. Fresh-Postgres sequence: **148/148 applied, 0 rolled back,
196 public tables** (details under Gates).

## SU5 — Commerce-Connected Auto Drafts

**The one inviolable rule holds: the engine creates DRAFTS only.**
Nothing in this batch can schedule or publish; a draft becomes a
post only through the existing human approval/schedule path.

- **Config.** `SocialAutoDraftConfig` per org (all four toggles
  default FALSE; no row at all reads as all-off). `GET/PATCH
  social/auto-draft-settings` (PATCH OWNER/ADMIN only, audited
  `social.auto_draft_settings_updated`); PATCH validates the cap
  (1–20) and that a pinned account belongs to the org and is
  connected, else a Bengali 400. GET returns defaults without
  creating a row.
- **Engine.** `SocialCommerceDraftService.maybeCreateDraft` —
  checks, in order: config toggle for the kind → target account
  (the config's pinned account, else the org's first connected
  `meta_page`) → per-ref duplicate → the Dhaka-day cap (today's
  `autoDraftKind != null` posts vs `maxDraftsPerDay`). Every refusal
  returns `{ created:false, reason }` (disabled / no_account /
  daily_cap / duplicate / no_product) — reasons live in the return
  value, never in a fake audit row. **The engine never throws.**
  Captions are grounded templates built only from real rows: the
  product's actual name and price (`formatMinor`), a promotion's
  actual name plus its percent ONLY from its real config (flash
  `percentOff`, bogo `getDiscountPercent`, tiered max tier) — an
  unknown shape yields a name-only caption, never an invented
  discount. When the product has an `imageUrl`, the real PP3
  importer is tried through the `importImage` seam; a failure
  produces a text-only draft with `mediaAttached:false` in the
  result, not a fake note on the post. Drafts carry
  `autoDraftKind` / `autoDraftRef` and `createdById: "system"`, and
  each creation writes one audit row
  (`social.auto_draft_created`).
- **Hooks — the wiring decision, recorded honestly.** The brief's
  first instinct was direct `@Optional` service injection into the
  producer services, but that creates a Nest module cycle
  (AiModule → ProductsModule → SocialModule → AiModule). The hooks
  therefore ride the codebase's own failure-isolated mechanism —
  the `@Global` `EventsService` bus (the same pattern
  `ReviewsService` already consumes): producers emit AFTER their
  operation succeeds, the engine subscribes in its constructor,
  and the bus itself guarantees a failing consumer can never break
  the producer. All four hooks are real and spec-proven:
  - **New product** — `ProductsService.create` emits
    `social_draft.product_created` after the create + audit.
  - **Back-in-stock** — `InventoryService.adjust` emits only on a
    **product-level** transition from ≤ 0 to positive (variant
    adjusts, order-placement decrements and store-sync corrections
    are NOT hooked in v1 — see Limits).
  - **Sale** — `PromotionsService` emits
    `social_draft.promotion_activated` on create-with-active,
    on update flipping inactive → active, and on `setActive(true)`.
  - **Review milestone** — `ReviewsService` emits
    `social_draft.review_received` from BOTH rating-receive paths
    (chat capture and public submit). The engine counts the org's
    received own reviews (rating + receivedAt set) plus visible
    external reviews: hitting a multiple of 50 (50/100/150…) makes
    a milestone draft (`autoDraftRef = milestone:<total>`, taking
    priority); otherwise a 5-star review makes a draft quoting the
    review text (≤ 120 chars) with the product resolved
    review → order → first item → product. Emits use a defensive
    `this.events?.emit?.()` shape because an existing CX12b spec
    builds `ReviewsService` with an `on`-only fake bus — the real
    bus always has `emit`.
- **Web.** Inside the Social Posts settings area: a "🤖 Commerce
  Auto-Draft" panel (four toggles, cap 1–20, target-account select
  over connected Meta Page accounts, copy stating verbatim that
  these only create drafts) and an auto-draft badge on post cards
  (list, calendar detail and queue) naming the originating event.

## SU6 — Link Tracking & Revenue Association

- **Audit first (the finding the design rests on).** `Order` has
  NO utm columns and no touchpoint FK. The real join that exists:
  `TrackingSession.utmCampaign` → `Touchpoint.campaign` →
  `AttributionCredit` (per model) → `Order`. The association below
  uses exactly that path — with the `LAST_TOUCH` model only (the
  Attribution report's default), so an order can never be counted
  four times across models.
- **Token + redirect.** `SocialPost.linkToken` is minted at
  schedule time (`SocialService.schedulePost`, failure-isolated)
  and lazily at publish. Public route `GET /public/social/r/:token`
  records a `SocialLinkClick` (UA truncated to 300) and 302-redirects
  to the post's real `linkUrl` with UTM appended
  (`utm_source=<platform>`, `utm_medium=social`,
  `utm_campaign=<post id>`; existing utm params are never
  duplicated or overwritten — the MS pattern). **Bot rule, as
  shipped:** a UA matching bot/crawler/spider/preview fetchers
  (incl. `facebookexternalhit`, WhatsApp/Telegram/Slack/Discord
  preview fetchers) still redirects but is NOT counted — a link
  preview is not a human click; an empty UA IS counted (dropping
  UA-less clicks would undercount real humans, the opposite error).
- **Publish wiring.** For `meta_page` posts with a `linkUrl`, the
  publisher receives the tracked URL (`${API_PUBLIC_URL}/public/
  social/r/:token`). **`API_PUBLIC_URL` unset ⇒ the raw `linkUrl`
  goes out, exactly as before SU6** — spec-proven fallback, no
  broken links. IG/TikTok/YouTube take no clickable link parameter,
  so tracking honestly does not apply there and the UI says so.
- **Stats.** `GET social/posts/:id/link-stats` returns clicks,
  last click, and — via the audit join above — the orders whose
  LAST_TOUCH touchpoint campaign equals the post id AND whose
  order time falls within `socialLinkWindowDays` (org setting,
  default 7) after at least one recorded click, excluding
  cancelled/refunded/failed orders (the attribution module's own
  `REVENUE_EXCLUDED_STATUSES`). The response carries the literal
  label `associationNote: "association, attribution নয়"` (the MS7
  language), and the web card repeats it. No credits ⇒
  `ordersAssociated: 0`, revenue `"0"` — a real zero (nothing
  tracked matched), never an estimate.
- **Token secrecy.** The raw `linkToken` is deliberately NOT in the
  post serializer (the SP1 credential-scan spec caught exactly
  this); the API exposes only `hasTrackedLink: boolean`, which is
  all the UI gates on (coordinator fix `f231801`).

## Gates (coordinator-run on the final tree, 2026-10-13)

- **API jest FULL** (`NODE_OPTIONS=--max-old-space-size=4096`,
  `--runInBand`): **315 suites / 3115 tests, ALL PASS** — no flake
  this run (the known cx3-debounce flake did not appear). New SU
  specs: `social-su5.spec.ts` (26) + `social-su6.spec.ts` (17) =
  **43 tests**; base was 313/3072, now 315/3115 — the arithmetic
  matches exactly.
- **Web vitest FULL:** **290/290** (274 base + 16 new
  `social-posts-su5` helper tests).
- **tsc:** API 0, web 0, admin 0. **Prisma:** validate 🚀 valid
  + generate run.
- **Monorepo build:** 7/7 packages Done (`/dashboard/social-posts`
  28.7 kB in the web build).
- **Fresh-Postgres migration sequence:** throwaway PostgreSQL 16
  cluster, `prisma migrate deploy` from this tree — **148/148
  applied (147 through Batch 2 + 1 new), 0 unfinished/rolled back,
  196 public tables** (verified in `_prisma_migrations`).

## Honest limits

- Auto-draft captions carry `linkUrl: null`: there is no honest
  absolute product URL at engine time (slug paths are relative and
  the post validator requires http(s)); the name + real price are
  in the caption, and link attachment stays a human edit in the
  composer. Not disguised anywhere.
- Back-in-stock fires only from the manual `InventoryService.
  adjust` choke point. Stock returning via product edit, store sync
  or order cancellation does not draft in v1 — recorded here, not
  silently claimed.
- The review count behind milestones mixes received own reviews
  and visible external reviews (EC15's unified definition); a
  milestone can therefore also be crossed by a store sync pulling
  external reviews — but external sync does not emit, so such a
  crossing is only noticed at the next own-review event. The cap
  and per-total ref make any late firing singular, never a burst.
- Order association only counts orders that actually flowed
  through the tracker + attribution reconcile (credits must
  exist). Untracked orders are absent — the number understates by
  design rather than inventing a match. It is, as labelled
  everywhere, association, not attribution.
- No live proof: no real FB click, no real order, no real Meta
  publish with a tracked link (SU0/SU12). No screenshot QA of the
  new panel/badge (no live app in the sandbox).
- The migration has never run against the production DB — it
  arrives with the next owner-authorized push + Dokploy Redeploy,
  together with the other tracks' pending migrations.
