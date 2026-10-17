# FB3 Acceptance — NF5 Multi-language/Currency + NF6 Gamified Promotions + NF7 Membership Tiers & Store Credit + NF8 Review & UGC

**Batch:** New Features Frontier FB3 (NF package approved in full by the owner 2026-10-17)
**Worktree/branch:** `~/workspace/ai-marketing-saas-nf`, `new-frontier` · **Base:** `37590745` (FB2 code-complete, 228 migrations)
**Local commits only — nothing pushed.** Migration claims used: `20261032000000` (NF5) + `20261033000000` (NF6) + `20261034000000` (NF7) + `20261035000000` (NF8).
Per-item detail: `docs/nf5-translations-acceptance.md`, `docs/nf6-gamified-promotions-acceptance.md`, `docs/nf7-membership-credit-acceptance.md`, `docs/nf8-review-ugc-acceptance.md`. This doc is the batch record: the finisher's independent serial gates + the consolidated NOT BUILT list.

## Per-item record (18 FB3 commits, oldest → newest)

| # | Commit | Item |
|---|---|---|
| 1 | `627e9bc9` | NF5: ContentTranslation + DisplayCurrencyRate schema and migration `20261032000000_nf5_translations` |
| 2 | `84fed491` | NF5: translations API — staff CRUD, AI drafts via LlmFactory (draft-only), display currency rates, public storefront overlay |
| 3 | `339d79e2` | NF5: translations specs — draft-never-public, fallback, approved served, org isolation, order-total purity, AI draft-only (19 tests) |
| 4 | `e48edddd` | NF5: web — product translation panel (AI draft/approve), display-currency editor, shop display prices + `?locale=` forwarding |
| 5 | `a32c627a` | NF5: acceptance doc — per-item record, locale choice (hi) rationale, gates, NOT BUILT list |
| 6 | `9e257451` | NF6: PromoCampaign/PromoPlay/PromoGroupBuyJoin schema + migration `20261033000000_nf6_promotions` |
| 7 | `44c37d16` | NF6: gamified promotions API — wheel/quiz/group-buy on popup placement vocab, Fraud Shield phone gate, StoreDiscount exactly-once prizes, specs 21/21 |
| 8 | `6f239c63` | NF6: web — dashboard Promotions page (all 3 mechanics + real stats), lib + 4 vitest, storefront ShopPromotions overlay on popup trigger machinery, nav entry |
| 9 | `bbe8d425` | NF6: acceptance doc — design decisions, gates, NOT BUILT list |
| 10 | `8eb41169` | NF7: TierDefinition/CustomerTier/StoreCreditEntry schema + migration `20261034000000_nf7_tiers_credit`, PriceList tier binding, Store.refundToCreditEnabled |
| 11 | `9c8d29b7` | NF7: membership tiers + store-credit ledger API — derived tiers (sold-status spend), PriceList tier binding resolution, gated refund-to-credit, checkout evaluator step + storefront spend/reversal, shop-account view, specs 16/16 |
| 12 | `bc73f398` | NF7: web — membership lib (+6 vitest), customers page tier manager + customer tier/credit card + grant, sync-page refund-to-credit toggle, order panel credit-refund block (rendered only when gate ON), shop account credit card, checkout store-credit opt-in; pushState exposes the gate |
| 13 | `bafd9b73` | NF7: acceptance doc — design decisions, gates, NOT BUILT list |
| 14 | `f202221a` | NF8: schema + migration `20261035000000_nf8_review_ugc` — OrderReview.media (Json, private-bucket keys) + socialDraftPostId claim, Organization.googleReviewUrl |
| 15 | `555ca0ab` | NF8: API — review media upload via existing RB3 storage machinery + creative guards (private bucket, keys only), Google review offer (rating>=4 + org link, offer-only), staff social-draft action via SocialService.createPost with socialDraftPostId exactly-once claim, Organization.googleReviewUrl via branding settings |
| 16 | `a2be728a` | NF8: specs — nf8-review-ugc.spec.ts 17 tests (upload guards via real guard path, media visibility per EC15, Google offer matrix, social draft exactly-once, org isolation) |
| 17 | `db4c32fb` | NF8: web — public review page real photo/video upload (presign→PUT→complete) + Google offer card on thank-you/already views (plain link, no redirect), settings branding card Google review link field, staff reviews page media (video) render + social-draft action with claim chip |
| 18 | `40b6eb27` | NF8: acceptance doc — design decisions, gates, no-incentive statement, NOT BUILT list |

No finisher fix commits were needed — every gate below passed on the tree as delivered.

## NF5 — what shipped (detail: `docs/nf5-translations-acceptance.md`)

- **Locale choice: hi (Hindi)** added through the new translation layer on top of the existing bn|en base pair. `ContentTranslation.locale` is a free string (mechanism is locale-agnostic); every LLM provider behind the existing `LlmFactory` generates Hindi; shop *chrome* honestly falls back to the bn dictionary for hi — no fake Hindi chrome was invented.
- **Approved-only rule:** the public read path filters `status = "approved"` in the WHERE clause (never post-filters) and is org-scoped; drafts are NEVER served publicly — including straight after AI generation and including a previously-approved row demoted back to draft by a new AI draft or an edit. Missing translation → base-language original (AB6 nameEn rule intact underneath). AI drafts are draft-only via `providerForOrg` (the CC8 LlmFactory path); kill-switch refuses 403; a non-LLM dev-template provider fails honestly in Bengali and writes nothing.
- **Display-only currency:** rates are human-entered with a required source note (base currency rejected); converted prices appear only as labelled `displayPrices` strings on public payloads ("আনুমানিক মূল্য — চেকআউটে দোকানের মূল মুদ্রায় চার্জ করা হবে"). **Checkout, orders and payments never read the rate table** — spec-proven: an order placed with USD display active totals exactly the base amount (50000 + 6000 delivery = 56000 minor).

## NF6 — what shipped (detail: `docs/nf6-gamified-promotions-acceptance.md`)

- **Popup vocabulary extension, no second engine:** `PromoCampaign` carries StorePopup's exact placement vocabulary field-for-field (trigger/delay/scroll/frequency/showOn/window); the web `ShopPromotions` overlay reuses ShopPopup's trigger + frequency-cookie pattern and the ED9 overlay queue (id `"promo"`, default priority — never stacks over the shop popup).
- **StoreDiscount exactly-once prizes:** prizes are REAL `StoreDiscount` rows (the EC7 coupon engine's table), issued with the established issuer shape (`usageLimit: 1`, `perCustomerLimit: 1`, `origin: "gamified_promo"`, sourceRef `nf6:play:<id>` / `nf6:groupbuy:<joinId>`); exactly-once = sourceRef pre-check before every create + the play/join stamp; a failed issuance heals on replay, never fabricates a code. Server-side outcome only (crypto roll over weights; a client-claimed segment is never read; weights/prize values never leave the server). One play per phone via the Fraud Shield's own phone normalisation + BlockedPhone refusal before any write.
- **Join record, NOT a stock reservation:** `PromoGroupBuyJoin` is the honest identified record — `StockReservation` (anonymous, silently-expiring checkout holds) was deliberately rejected; no stock is held, **no payment is taken at any point** (the no-prepayment rule is stated verbatim in the public payload, the overlay, and the dashboard).
- **No expiry send in v1:** an unmet group buy flips joins to `expired` lazily on read and stays staff-visible with phone numbers for manual contact. **No SMS/WhatsApp/email send exists for group-buy expiry in v1 and none is claimed** — there is no honest existing per-joiner send path to ride.

## NF7 — what shipped (detail: `docs/nf7-membership-credit-acceptance.md`)

- **Derived tiers:** lifetime spend = Σ `totalMinor` over the canonical sold statuses only (`completed | delivered`); cancelled/pending/processing/returned/refunded/failed never count, practice orders excluded. `CustomerTier` is a derived cache of a pure function of the orders table, recomputed by the order-event reconciler (same bus + direct IntegrationsService hook as loyalty), by tier-definition CRUD, and by staff recompute endpoints — always rebuildable.
- **PriceList tier binding:** the EXISTING `PriceList`/`PriceListItem` machinery minimally extended (`groupId` nullable + unique `tierId` FK — a list is bound to a group XOR a tier, no fork). Resolution stays the one existing door `priceMapForCustomer`: **a group list wins first** (a negotiated price is more specific), the tier list applies when there is no group list.
- **Ledger sole truth:** `StoreCreditEntry` is the only truth — balance is ALWAYS Σ `deltaMinor` for (org, customer); there is deliberately **no balance column anywhere**; entries are never edited/deleted; exactly-once rides the `(organizationId, sourceRef)` unique.
- **Refund-to-credit, default OFF gate:** `Store.refundToCreditEnabled` DEFAULT FALSE beside EC5's refund-push flag, OWNER-only toggle. While OFF the API throws 403 and writes nothing, `pushState` reports the gate false, and the order panel does not render the option at all. `refundKey` is required — a retry replays the first entry and `refundedMinor` moves exactly once.
- **Native-checkout-only credit spend:** the evaluator stays pure (snapshot in, step 3d after gift card / before tax); spend is wired into the native SHOP checkout only (post-placement, re-verified customer, re-clamped, exactly once per order) with cancellation-before-delivery reversal — POS / single-product / landing checkouts do not offer credit in v1 and their totals are unchanged.

## NF8 — what shipped (detail: `docs/nf8-review-ugc-acceptance.md`)

- **Private-bucket review media via existing storage guards:** the RB3 pattern every media surface uses (presign quarantine PUT → direct PUT → complete verifies HEAD size + magic-byte sniff → copy to final key → registry row, surface `"review"`), with the CREATIVE upload guards imported verbatim (image ≤10 MB, video ≤50 MB, same type list) enforced at presign AND complete. Only private-bucket KEYS are stored on the review row, never URLs; max 4 items; uploads only before submission.
- **EC15 moderation unchanged:** received + `isVisible` = public, exactly as shipped. Public payloads mint a 15-minute signed GET per media item ONLY for rows the public path already shows; a hidden or not-yet-received review's media URL is never minted (spec-proven — `signedGetUrl` is never even called for those keys). Staff moderation exposes hidden reviews' media so staff can moderate what they approve.
- **Google offer matrix + no-incentive statement:** the offer exists ONLY when (the customer's own already-submitted rating is 4–5) AND (the org configured `Organization.googleReviewUrl`, edited in the existing Settings → Branding card). It is a plain external link — **no auto-redirect anywhere, never offered before submission, never below 4★, never when unconfigured**. **No incentive is attached to any rating by NF8:** nothing in NF8 gives, promises, or conditions any coupon, discount, credit or reward on a rating value or on posting a Google review, and the offer copy says so.
- **socialDraftPostId exactly-once:** the staff social-draft action calls the Social engine's single creation path `SocialService.createPost` (born `status: "draft"`; NF8 never publishes); `OrderReview.socialDraftPostId` is the claim — a repeat action returns the claimed post as `reused: true` WITHOUT calling the engine again (spec-proven by call count); a deleted claimed post is the documented recovery (fresh draft, claim overwritten). The draft carries the review text + the MS5 product link only — review media is NOT attached (private-bucket StoredFiles are not MediaAsset rows; attaching would fork the media model or expose private objects).

## Gates (finisher, run STRICTLY SERIALLY, recorded as they finished)

| Gate | Result |
|---|---|
| NF5 targeted jest — `translations.spec.ts` (independent re-run) | **19/19 PASS** |
| NF6 targeted jest — `gamified-promotions.spec.ts` (independent re-run) | **21/21 PASS** |
| NF7 targeted jest — `membership.spec.ts` (independent re-run) | **16/16 PASS** |
| NF8 targeted jest — `nf8-review-ugc.spec.ts` (independent re-run) | **17/17 PASS** (combined run of all four suites: 4 suites **73/73 PASS**) |
| API tsc `--noEmit` | **PASS** |
| API build (`tsc -p tsconfig.build.json`) | **PASS** (`dist/main.js` produced) |
| Web tsc `--noEmit` | **PASS** |
| Web full vitest | **116 files / 962 tests PASS** (FB2 baseline 947; +5 translations +4 promotions +6 membership = 962) |
| Web build (`next build`) | **PASS** — new route `/dashboard/promotions` present in the output; the NF5 product translation panel ships inside the existing `/dashboard/products` page, the NF7 shop-account credit card inside the existing `/shop/[orgSlug]/account` page, and the NF8 changes inside the existing `/review/[token]` page (all three host routes present in the build output) |
| Fresh-PG (throwaway local PG16 + pgvector, empty DB, `prisma migrate deploy`) | **232/232 migrations applied, 0 unfinished** (228 base + `20261032000000` + `20261033000000` + `20261034000000` + `20261035000000`); `prisma migrate status` = up to date; new tables verified present: ContentTranslation, DisplayCurrencyRate, PromoCampaign, PromoPlay, PromoGroupBuyJoin, TierDefinition, CustomerTier, StoreCreditEntry; new columns verified: `OrderReview.media` (jsonb), `OrderReview.socialDraftPostId` (text), `Organization.googleReviewUrl` (text) — plus NF7's `PriceList.tierId`, nullable `PriceList.groupId`, `Store.refundToCreditEnabled` |
| **Boot smoke** (API dist booted against the fresh-PG DB) | **PASS** — API boots (this is the proof that NF8's `OrdersModule` imports of `SocialModule` + `StorageModule` create no DI cycle), `GET /health` → `{status:"ok"}`; RouterExplorer mapped ALL new NF5–NF8 routes: translations staff (`GET/POST products/:productId/translations`, `POST …/translations/ai-draft`, `GET storefront-string-translations` + ai-draft, `POST translations`, `PATCH translations/:id`) + display-currency (`GET/POST display-currency-rates`, `DELETE display-currency-rates/:currency`) — the public overlay rides the existing `public/shop/:orgSlug` routes, no new public route; promotions staff (`GET/POST promotions/campaigns`, `GET/PATCH campaigns/:id`, `POST campaigns/:id/active`, `GET campaigns/:id/plays`, `GET campaigns/:id/joins`) + public (`GET public/promotions/:orgSlug/active`, `POST …/spin/:campaignId/play`, `POST …/quiz/:campaignId/complete`, `GET/POST …/group-buy/:campaignId[/join]`); membership/tiers/credit (`GET/POST membership/tiers`, `PATCH/DELETE membership/tiers/:tierId`, `POST membership/recompute`, `GET customers/:customerId/membership` + recompute, `GET customers/:customerId/store-credit` + `POST …/store-credit/grant`, tier price-list `GET commerce/tiers/:tierId/price-list` + items POST/DELETE, `PATCH commerce/stores/:storeId/refund-to-credit`, `POST orders/:orderId/refund-to-credit`, `GET public/shop/:orgSlug/account/store-credit`); review UGC (`POST public/review/:token/media/presign`, `POST public/review/:token/media/complete`, `POST organizations/:organizationId/product-reviews/store/:id/social-draft`). Live probe: `GET /public/promotions/unknown-shop-xyz/active` → **404 `{"message":"দোকানটি পাওয়া যায়নি"}`** — the designed Bengali 404 (the `public/shop/<unknown>?locale=hi` overlay path returns the same) |
| Full API jest suite | Not run as a single gate (brief gates = the four targeted suites + typecheck/build/web/fresh-PG/boot, as in FB1/FB2). The FB1 known social-suite flake did not appear in any gate run here; no gate was marked green from an unrecorded run. |

**Migration-collision watch (carried from FB2, still true):** the Campaign Advanced (CA) line circled the `20261030000000+` range in its plan from a different base in its own worktree. This line now owns folders `20261030000000_nf3_voice_conversation`, `20261031000000_nf4_service_bookings`, `20261032000000_nf5_translations`, `20261033000000_nf6_promotions`, `20261034000000_nf7_tiers_credit`, `20261035000000_nf8_review_ugc`; at union time check the CA line's actual folder names against these — same timestamp with a different name deploys lexicographically, an identical name would collide.

## OWNER DECISION — pre-existing REVIEW10 display on the public review page (flagged by NF8, untouched by NF8)

The public review page carries a **CX12b-era hardcoded `REVIEW10` "reward" display + a "পুরস্কার জিতুন" submit label**, shown **irrespective of the rating value** and spec-pinned by the CX12b suite. It predates NF8, is not connected to NF8's Google offer in any way, and **NF8 added NO incentive** — the block was left byte-identical, deliberately, rather than silently rewritten inside NF8. **The owner decides whether to remove/rework it** (note: as it stands, a reward display attached to review submission sits uneasily next to NF8's no-incentive Google-offer design; that judgement and any change are the owner's call, outside FB3's scope).

## NOT BUILT (consolidated, merged from the four per-item lists)

**Live proof — everything:** no FB3 migration has run on a real database, no real LLM translation draft has been generated, no file has been uploaded to real R2 storage from the review page, no checkout has spent real credit or resolved a real tier price, no draft has been created against a real connected social account, nothing is deployed. **Nothing in FB3 is live-proven** (M30-style verification owed, incl. the production CORS/bucket setup the direct-PUT review upload needs).

**NF5:**
- Shop chrome (buttons/menus) in Hindi — the shop-i18n dictionary stays bn/en; hi translates merchant *content* only.
- Variant-level translations and variant display prices; translations/display prices on other public surfaces (brand page, recommendations, cart, checkout, single-product checkout, landings) — shop home + PDP only in v1 (cart/checkout always base text + base currency, the honesty-safe default).
- No translation memory/glossary, no bulk translate-all, no browser-language auto-detection.
- Converted amounts assume 100 minor units per major unit on both sides; zero-decimal currencies (e.g. JPY) are not special-cased (display figure only — checkout is never affected).

**NF6:**
- No customer notification send for group-buy expiry (status record + staff-visible joiner list only — see NF6 above).
- No group-buy checkout auto-application (joiners use their issued coupon code at checkout like any coupon) and no stock hold for group buy (deliberate).
- Dashboard campaign EDIT is API-only in v1 (page covers create, activate/deactivate, stats, plays/joins detail); dashboard quiz form authors one question with categoryId targets only (multi-question / tag / category-name authoring is API-level).
- Wheel presentation is a labelled segment list + result, not an animated canvas wheel; one campaign presented at a time on the storefront (no rotation/stacking).

**NF7:**
- Store-credit spend is wired into the native SHOP checkout only — POS, single-product checkout and landing checkouts do NOT offer credit in v1 (their totals are byte-identical to pre-NF7).
- No credit expiry, no credit transfer between customers, no cash-out of credit.
- Refund-to-credit does not push a platform refund (it is a local refund record whose destination is the ledger; the EC5 store refund push remains governed by its own separate gate and is not triggered).
- Returns (RMA) `store_credit_note` resolution is unchanged (record-only); tier price-list authoring is by product id (no product-picker UI for tier lists); no tier-change notifications, no tier expiry/demotion grace periods.

**NF8:**
- Review VIDEO items ride the public payload but the PDP component does not render video in v1 (video is viewable in staff moderation; photos render through the existing path).
- No media removal/replacement by the customer after a completed upload, and no staff media-delete action (moderation remains EC15 hide/show of the whole review).
- The social draft carries no review media (see NF8 above) and no per-action account picker in the UI (the button uses the API's default resolution — org's first connected account).
- Chat-captured reviews (CX12b chat path) cannot receive media — media attaches only through the token review page's upload flow.
- The pre-existing `REVIEW10` display was left byte-identical — see the OWNER DECISION section above.

## Owner decisions / actions still owed

1. **REVIEW10 owner decision** (above): remove/rework the CX12b-era reward display + "পুরস্কার জিতুন" label on the public review page, or keep it — NF8 did not touch it.
2. **Push instruction** for this line (union release with the other lines; check the CA migration folders first — see the watch note above) + **manual Dokploy Redeploy**.
3. **Per-org Google review link config** (`Organization.googleReviewUrl` in Settings → Branding), if the Google offer is wanted — unconfigured orgs simply never show the offer.
4. **Refund-to-credit stays OFF** per store unless the owner turns it on (`Store.refundToCreditEnabled`, default false) — it is a deliberate per-store opt-in.
5. **Translation approvals are staff work per org** — AI drafts are never public until a staff member approves them; display-currency rates are likewise entered per org with a source note.
6. **All live proof still owed:** a real LLM translation draft through an org's configured provider, a real R2 review-media upload (incl. production CORS/bucket setup), real orders exercising tier pricing + credit spend/reversal + a gated refund-to-credit, and a social draft created against a real connected account.
