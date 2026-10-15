# E-Commerce Batch B5 — Acceptance (EC8)

Batch B5 of the Full E-Commerce System program (plan:
`Ecommerce-Full-System-Plan-2026-10-12.md` §৪ EC8 — Native
Storefront v2, Mode B), built on the B1–B4 foundation (canonical
products, EC7 discount validation, the shared `upsertOrder` order
pipeline, the EC10 unified abandoned view). Worktree
`ai-marketing-saas-ec`, branch `ec-package`. **Local commits only —
nothing pushed** (owner-only push rule). The migration was **NOT
run on any real database** — deploy requires `prisma migrate
deploy` plus `prisma generate`, then a manual Dokploy Redeploy.
Custom-domain routing additionally needs the merchant domain
pointed at the deployment and SSL issued at the Dokploy/Traefik
level (platform work, see Honest limits).

## Commits (in order)

| Hash | Subject |
|---|---|
| `fb0eab9` | EC8: storefront backend — schema, districts, public shop/cart/checkout, staff zones/settings/domain, native abandoned |
| `6356ef0` | EC8 web: native storefront v2 — public shop/cart/checkout, custom-domain middleware, staff settings |
| (this doc) | docs: e-commerce B5 (EC8) acceptance |

## Gates (final verification, committed tree at `6356ef0`)

The B5 coordinator's last verified result on this tree was the full
API jest run; the coordinator ended before the remaining gates and
this doc, so a finisher pass re-ran everything else fresh on the
committed tree. **No fixes were needed — every gate passed as
committed.**

- API jest (full, coordinator run on this tree): **2161/2161 passed
  (235 suites)** — B4 was 2127/235, so +34 tests, zero regressions.
- API jest (finisher re-run, EC8-related): storefront specs
  (`storefront.spec.ts`, `ec8-storefront.spec.ts`,
  `storefront-di.spec.ts`) **34/34**; together with
  `ec10-abandoned.spec.ts` and the S4 `abandoned-carts.spec.ts`
  (both touched by EC8's native-cart work) **5 suites, 68/68**.
- API tsc: **0 errors**. Web vitest: **157/157 (23 files)** — B4 was
  140, +17 from the new `custom-domain`, `storefront-money` and
  `storefront-sitemap` lib tests. Web tsc: **0 errors**.
- Full build: **green**. Note: `pnpm` is not on PATH in this
  sandbox, so each workspace package's own build script was run
  directly (the equivalent of `pnpm -r build`, same as B3):
  contracts `tsc` exit 0, db `tsc` exit 0, ui `tsc --noEmit` exit 0,
  api `tsc -p tsconfig.build.json` exit 0, web `next build` exit 0 —
  the `/shop/[orgSlug]` routes (home, products, cart, checkout,
  success, sitemap.xml) and the middleware (34.9 kB) are in the
  build output.
- Prisma validate: **valid**. (A first invocation without
  `DATABASE_URL` set fails with P1012 "Environment variable not
  found" — an environment matter, not a schema error; with the
  variable present the schema validates.)

## EC8 — Native Storefront v2

- **Models/migration** `20261013090000_ec8_storefront` (additive,
  new tables only): `StorefrontSetting` (one per org: `shopEnabled`
  default **false**, shopName, announcementText, section toggles
  showFeatured/showCategories/showSearch, metaDescription,
  featuredProductIds, domainVerifyToken, domainVerifiedAt),
  `ShippingZone` (kind, districts Json, chargeMinor BigInt,
  deliveryDays, freeAboveMinor, active, position), `StoreCart`
  (unguessable unique token, email/phone, status open|converted) +
  `StoreCartItem` (product/variant, quantity, includeBump; unique
  per cart+product+variant). The domain itself stays on the
  existing `Organization.customDomain` field.
- **Districts**: `BD_DISTRICTS` — the canonical 64 districts of
  Bangladesh in Bengali, grouped by division, added to
  `@repo/contracts` and shared verbatim by the API (zone matching
  is an exact-name match, `"ঢাকা"` = inside Dhaka) and the web
  district pickers. Zone district lists are validated against it
  on create/update.
- **Public shop API** (`@Controller("public/shop")`):
  `GET :orgSlug` home — shop settings, org branding
  (brandName/logoUrl/primaryColor), BusinessProfile payment facts
  (codAvailable, bKash/Nagad numbers, paymentNote), categories
  built from the EC3 Category rows + products, featured products
  (merchant-chosen ids ∩ ACTIVE in merchant order, fallback newest
  ACTIVE, max 8, only when the section is enabled), search (`q`),
  category filter, pagination (pageSize ≤ 60). Shops that are not
  enabled 404 honestly. `GET :orgSlug/products/:productSlug` —
  gallery images (EC3 ProductImage), variants, effective stock,
  per-product SEO fields, related products by category.
- **Cart**: server-side cart addressed by its token; the web lib
  (`storefront-cart.ts`) keeps the token in localStorage keyed by
  org slug. Create/get/PATCH lines (add, set quantity, remove;
  variant-aware; per-line bump opt-in) and a contact endpoint
  (email/phone — what later makes a cart recoverable). Stock is
  asserted when lines change and again at quote/checkout; prices
  are always recomputed from current product/variant rows — the
  cart stores no price truth.
- **Shipping zones**: kinds `district_list` | `inside_dhaka` |
  `outside_dhaka` | `all`, matched in that precedence (position
  order inside a tier). `freeAboveMinor` is judged on the
  **discounted** subtotal. Staff CRUD plus
  `POST zones/defaults`: creates the inside/outside-Dhaka zones
  from the BusinessProfile delivery charges, days and free-above
  threshold — idempotent per kind, and it **refuses** with a Bengali
  message when the BusinessProfile charges are not set (nothing is
  invented).
- **Checkout v2** (`POST :orgSlug/checkout` + `POST :orgSlug/quote`
  sharing one pricing path, `computeQuote`): multi-item; the bump
  is added into the subtotal before coupon validation (mirroring
  the single-product checkout) but the bump pseudo-line is never
  coupon-eligible; EC7 coupons go through
  `DiscountsService.validateForCheckout` — an invalid coupon is a
  400 with the Bengali reason and **no order is placed**; a
  free-shipping coupon zeroes delivery regardless of zone. No
  matching active zone → honest 400. Orders are created through
  `IntegrationsService.upsertOrder` with source
  `native_storefront`, so S1 stock decrement, the order hub and
  courier booking all apply unchanged; the bump lands as its own
  `[Special Add-On]` line. COD is the default; a manual
  bKash/Nagad choice records the customer's advance claim
  **verbatim in the order note, explicitly marked unverified**,
  the response carries `paymentClaimStatus: "advance_unverified"`
  and the full total is still due. On success the cart flips to
  `converted` (a second checkout on the same token is refused) and
  the coupon is redeemed — a redeem failure is logged and never
  fails a placed order (same discipline as EC7).
- **Custom domain — real verification, honest states**:
  `POST domain/verify-token` issues a random token (issuing a new
  one resets any prior verification) and returns the TXT record to
  publish at `_qosprey-verify.<domain>`; `POST domain/verify` does
  a **real DNS TXT lookup** (`StorefrontDnsResolver`, injectable so
  specs stub it) and stamps `domainVerifiedAt` only when the exact
  token is found — a mismatch reports the records actually found,
  verbatim. `GET public/shop/by-domain/:domain` resolves **only
  verified** domains. `POST domain/check-routing` is a diagnostic:
  it fetches the domain over HTTPS then HTTP and reports
  `routingActive: true` only on a 2xx/3xx response containing this
  shop's marker — otherwise `false` with the reason, never thrown,
  never faked. The staff UI presents the three states separately
  (domain set → TXT-verified → routing actually answering) with an
  explicit note that pointing the domain at the platform and SSL
  setup (Dokploy/Traefik) are platform-level work this app cannot
  do, so a verified domain is never displayed as "live".
- **Domain routing (web)**: `apps/web/src/middleware.ts` looks the
  request host up via by-domain (60s in-memory cache, 3s timeout,
  **fail-open** on any error) and rewrites shop-shaped paths onto
  `/shop/<slug>` using the pure, unit-tested decision lib
  (`custom-domain.ts`): root and the single-segment
  cart/checkout/success surfaces map into the shop; dashboard,
  auth, API, assets and all other platform segments are never
  rewritten; localhost/.local hosts skip lookup entirely.
- **Staff settings UI** (`/dashboard/commerce/storefront`, linked
  from Sync Center): enable toggle, shop name, announcement, meta
  description, the three section toggles, featured-product picker,
  zone CRUD + "create defaults" button, the domain card (TXT
  instructions, verify, routing check) and shop links.
- **Public web pages**: `/shop/[orgSlug]` home, product page,
  cart, checkout (district picker from BD_DISTRICTS, coupon field,
  COD + manual-payment claim), success (order number + amount
  due), and a per-shop `sitemap.xml` route. `generateMetadata` on
  home and product pages emits title/description/OpenGraph from
  the shop meta / product SEO fields with honest fallbacks.
- **Native abandoned carts (feeds the EC10 unified view)**:
  `AbandonedCheckoutsService.listNativeCarts` surfaces OPEN
  storefront carts idle 1h–7d that have an email or phone and at
  least one item, priced from **current** product rows; converted
  carts are excluded by status, so a cart that became an order is
  never "abandoned". The unified `GET commerce/abandoned` list now
  merges three sources (`tracker`, `shopify`, `native`).
  `sendNativeRecovery` follows the EC10 marker discipline with one
  refinement: the AuditLog marker (`commerce.native_cart_recovery_sent`)
  pins the cart's last activity, so new activity after a send makes
  the cart sendable again — but never twice for the same activity.

## Honest limits

- **No live proof anywhere in B5** — no real domain was pointed at
  a deployment, no public DNS TXT record was verified end-to-end,
  and no order was placed through a deployed shop. DNS resolution
  and the routing fetch are stubbed in specs. Live verification
  (owner's real domain + store) is EC12 / the M30 sprint.
- Migration `20261013090000_ec8_storefront` is **not run on any
  real DB**; the storefront endpoints and pages will fail until
  deploy runs it.
- Domain routing needs three things outside this app: DNS A/CNAME
  pointing at the deployment, SSL issuance at Dokploy/Traefik, and
  the web process able to reach the API
  (`API_INTERNAL_URL` / `NEXT_PUBLIC_API_URL`). TXT verification
  alone does not make a domain serve the shop — the UI says so.
- **Deviations from plan §৪ EC8, stated plainly:**
  - A manual bKash/Nagad advance does **not** reuse the existing
    PaymentVerification flow. The claim is recorded verbatim on
    the order as an explicitly unverified note
    (`advance_unverified`, full amount still due); no verification
    record or queue is created for native-checkout advances.
  - The featured section is merchant-picked products (fallback:
    newest). The plan's "best seller from real sales data" section
    was not built.
  - The shop UI is Bengali-only; there is no bn/en language toggle
    (the plan listed bn/en under theme).
- Checkout requires at least one matching active shipping zone —
  a shop enabled without zones answers quote/checkout with an
  honest 400 until zones exist (the defaults button covers the
  common inside/outside-Dhaka case from BusinessProfile values).
- Native checkout currency is fixed to BDT (the BusinessProfile
  default); multi-currency native shops are not supported.
- The shop home loads all ACTIVE products and filters/paginates
  in memory — fine at native-store scale, not a database-level
  search; a very large native catalog would need a query-level
  pass (future work, like IN1's FTS note).
- `by-domain` resolves a verified domain even when the shop is
  disabled; the shop routes then 404 honestly rather than the
  domain silently falling back to another tenant (deliberate,
  documented in code).
