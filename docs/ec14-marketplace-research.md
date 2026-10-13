# EC14 — Marketplace Research Spike: TikTok Shop, Daraz/Lazada, Meta & Google Feeds

- **Date of research / access date:** 2026-10-13
- **Scope:** Research only. No code was written against any of these channels as part of this spike.
- **Method:** Web search + fetching official documentation / help-centre pages where available. Every factual claim below names its source URL and what that source says. Where only secondary sources exist, that is stated plainly — secondary coverage is **not** treated as official documentation.
- **Product context:** Bangladesh-first ecommerce SaaS. A channel is only worth building if a Bangladeshi tenant can actually use it end-to-end today.

## Executive summary / decisions

| Channel | Verdict | One-line reason |
|---|---|---|
| TikTok Shop API | **NO-BUILD (defer / watchlist)** | A real, gated API exists, but TikTok Shop does not operate as a local seller market in Bangladesh, so a BD tenant has no shop to connect. |
| TikTok Shop feed/file | **NO-BUILD** | No publicly documented scheduled-fetch feed spec exists; bulk upload is a login-gated, category-specific Seller Center spreadsheet template, not a hostable feed. |
| Daraz (via Lazada Open Platform) | **NO-BUILD (defer, partner-verification required)** | The public Lazada Open Platform covers six Southeast-Asian Lazada ventures only — Bangladesh / Daraz is not among them, and no public Daraz Open Platform portal or BD onboarding path was found. |
| Meta (Facebook) Commerce catalog feed | **BUILD — FEED-ONLY** | Fully public spec, no partner approval needed; tenant hosts a file URL and Meta fetches it hourly / daily / weekly. |
| Google Merchant Center feed | **BUILD — FEED-ONLY** | Fully public spec, no partner approval needed; tenant hosts a file URL and Google fetches it on a daily / weekly / monthly schedule. |

"FEED-ONLY" means: generate a spec-compliant file at a stable per-tenant / per-store URL in the SaaS; the tenant pastes that URL once into Commerce Manager / Merchant Center as a scheduled fetch. No OAuth app, no marketplace API credentials, no order pull for these two channels (a catalog feed is one-way, outbound product data only).

---

## 1. TikTok Shop API

### 1.1 Does a public / self-serve API exist?

**Yes — for sellers in markets where TikTok Shop operates.** The TikTok Shop API is documented for application and service integrators, with API domains including Seller, Products, Order, Fulfillment, Logistics and Finance, plus webhooks.

- Source: TikTok Shop Developer Guide (mirrored copy of the Partner Center guide) — https://github.com/lazykern/ecommerce-api-docs/blob/HEAD/data/processed/tiktok/guides/developer-guide/tiktok-shop-developer-guide.md — says the API gives programmatic access for TikTok Shop app/service integrators and lists the Products / Order / other API overviews and webhooks. This is a third-party mirror of TikTok's Partner Center documentation, used here because the Partner Center doc portal itself (partner.tiktokshop.com/docv2) is not openly fetchable without an account.

### 1.2 Onboarding (what a developer must actually do)

Corroborated by multiple independent integrator guides describing the same Partner Center flow:

1. **Register in TikTok Shop Partner Center** at https://partner.tiktokshop.com (a separate US portal exists at partner.us.tiktokshop.com), and register specifically **as an app developer**.
2. **Create an app** under "App & Service", choosing **Custom App** (for a single / own shop) or **Public App** (distributed to other sellers). Creation yields an App Key, App Secret and Service ID.
3. **Configure the app:** set an HTTPS redirect URL, enable the APIs / scopes needed (e.g. shop authorized information, product, order information; scopes such as `seller.product.write` are applied for separately).
4. **Seller authorization (OAuth-style):** the seller opens the authorization URL built from the Service ID (`https://services.tiktokshop.com/open/authorize?service_id=…`, US variant on services.us.tiktokshop.com), logs in, approves the scopes, and the app receives a code at its callback URL to exchange for access/refresh tokens and a `shop_cipher` used on subsequent calls.
5. **App review / publish gate for public apps:** TikTok's developer terms require an app to be submitted for TikTok's review and written approval before it may be published/distributed to end users, and material changes require resubmission.

Sources:

- Apideck's TikTok Shop OAuth-app registration guide — https://developers.apideck.com/connectors/tiktok/docs/application_owner+oauth_credentials — walks through Partner Center sign-up, registering as an app developer, Custom vs Public app creation, and the App Key / App Secret / Service ID and Manage-API steps.
- API2Cart's TikTok Shop connection guide — https://api2cart.com/how-to-connect-tiktok-shop-to-api2cart/ — describes the same Partner Center registration, app creation, scope configuration, and the region-specific authorization URLs / callback-code flow.
- TikTok Shop Developer Terms (EU/UK version, mirrored) — https://github.com/lazykern/ecommerce-api-docs/blob/HEAD/data/processed/tiktok/guides/partner-guide/terms-and-policies/eu-uk-tiktok-shop-developer-terms-of-service.md — states registration with the Partner Center is required for access, and that TikTok may require an app to be submitted for review and approval before distribution, with no publication without written approval.

So this is **not** an ungated self-serve API: it is self-serve *registration* plus a gated *review* for public distribution, plus per-seller authorization. That gating alone would be manageable — the blocker is geography (next section).

### 1.3 Is TikTok Shop available in Bangladesh?

**No. As of the sources checked on 2026-10-13, TikTok Shop is not a local seller market in Bangladesh, and no official BD launch date was found.**

- DPL's TikTok Shop country list (which states it was checked against TikTok Seller Center / seller-policy documentation on 2026-08-13) — https://dpl.company/countries-with-access-to-tiktok-shop-seller-center/ — lists Bangladesh explicitly as: *"Not listed [as a current local market] — Not listed among the local TikTok Shop markets verified for this update."* The same table marks Pakistan, India, UAE, Canada and others as not listed. It also warns that shoppers in some unsupported countries can buy from cross-border sellers based in a supported country, but **cannot register a local shop themselves** — cross-border buying is not seller availability.
- PhotonPay's 2026 market list — https://www.photonpay.com/hk/blog/article/tiktok-shop-available-countries — enumerates the active markets (Indonesia, Thailand, Vietnam, Malaysia, Philippines, Singapore, UK, US, South Korea, Japan, Saudi Arabia, UAE, Brazil, Mexico, Australia, Germany, France, Italy, Spain, and others, "more than 20 countries") — **Bangladesh does not appear in it**.
- A 2026 creator-market summary — https://projectcasting.com/blog/casting-calls-acting-auditions/how-to-become-a-tiktok-shop-creator-in-2026-requirements-commissions-earnings — likewise lists active markets (US, UK, Ireland, Germany, France, Spain, Italy, Indonesia, Malaysia, Thailand, Vietnam, Philippines, Singapore, Brazil) with Canada/Argentina as in-expansion; Bangladesh is absent.

Caveat stated honestly: the first two are secondary compilations, not a TikTok press release. But they agree with each other, no source found announces a Bangladesh launch, and the burden of proof for a build decision is a *verifiable BD seller onboarding path* — none exists in the sources found. TikTok (the app) being popular in Bangladesh is a different fact from TikTok **Shop** seller registration being open there.

### 1.4 Recommendation — TikTok Shop: **NO-BUILD**

- Do **not** build product sync or order pull for TikTok Shop in EC14 / B9.
- Reason: (a) no BD seller market ⇒ the SaaS's core tenants cannot create a shop, authorize an app, or receive an order; any integration would be dead code for them; (b) even for a tenant in a supported market, the path requires our own Partner Center registration, a public-app review by TikTok, and per-seller OAuth — an investment that only pays off once a real tenant with a supported-market shop exists.
- Revisit trigger (write this on the watchlist, do not build speculatively): TikTok officially announces TikTok Shop seller registration in Bangladesh, **or** a paying tenant presents an existing shop in a supported market (e.g. MY/US/UK) and asks for the connection. On revisit, start with a Custom App (single-shop, lighter review) before a Public App.

---

## 2. Daraz / Lazada Open Platform

### 2.1 Structure that matters: Daraz ≠ a Lazada venture

Daraz is the Alibaba-group marketplace for South Asia — Pakistan, Bangladesh, Sri Lanka, Nepal and Myanmar — while Lazada is the Alibaba-group marketplace for Southeast Asia. They share Alibaba ownership and much platform technology, but they are **separate ventures with separate seller centres and separate country lists**.

- Source: The Nation (2023, Daraz announcement) — https://www.nation.com.pk/28-Jul-2023/daraz-to-empower-south-asian-users-shopping-experience-with-microsoft-azure-openai-service — describes Daraz as South Asia's platform in Pakistan, Bangladesh, Sri Lanka, Nepal and Myanmar.
- Source: Daraz Bangladesh's own site footer (daraz.com.bd) — lists "SHOP WORLDWIDE WITH LAZADA: Singapore, Malaysia, Philippines, Indonesia, Vietnam, Thailand" as *other* destinations, i.e. Lazada's six ventures do not include Bangladesh. (Footer captured in search index of https://pages.daraz.com.bd — the Daraz BD homepage.)

### 2.2 Does a public seller API exist, and for whom?

**For Lazada's six Southeast-Asian ventures: yes.** The Lazada Open Platform at https://open.lazada.com provides documented REST APIs (product, order, seller, finance, logistics, etc.) with:

- **App registration:** register on open.lazada.com, create an app, receive an App Key / App Secret.
- **Seller authorization:** redirect the seller to `https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true&redirect_uri=<app callback>&client_id=<app key>`; the seller logs in and approves; the platform returns a code to the callback (documented as expiring in ~30 minutes); exchange it at `/auth/token/create` for an access token + refresh token; refresh before expiry.
- **Signing:** calls carry common parameters (`app_key`, `timestamp`, `sign_method=sha256`, `access_token`) and an HMAC-SHA256 signature.
- **Regional gateways:** calls go to a per-venture regional endpoint (`https://api.lazada.<region>/rest/…`); the regions appearing across the documentation and SDKs are `my`, `sg`, `th`, `ph`, `vn`, `id` (Malaysia, Singapore, Thailand, Philippines, Vietnam, Indonesia).
- **App lifecycle:** apps exist in a testing state before going online; a third-party integration guide notes refresh tokens for testing-status apps are valid ~30 days vs ~180 days for online-status apps — i.e. moving an app to production is an approval/status step, not just a toggle the developer controls unilaterally.

Sources:

- Lazada Open Platform documentation (referenced/linked as the canonical doc set, incl. the seller-authorization introduction at open.lazada.com/doc) via the open-source Lazop SDK readme — https://github.com/hoerilahyar/laravel-lazop — reproduces the documented authorization URL, code-to-token flow (`/auth/token/create`) and the 30-minute code expiry from the official doc.
- Laraditz Lazada package (implements the official Open Platform API surface) — https://github.com/laraditz/lazada/blob/HEAD/README.md — lists the auth/seller/order/finance methods and states parameters follow the Lazada Open Platform documentation at open.lazada.com exactly.
- A Lazada region reference in a maintained skill file — https://github.com/qhkm/zeptoclaw-skills/blob/HEAD/lazada/SKILL.md — states setup as "Register at open.lazada.com → Create App", App Key/Secret, OAuth access token, and region endpoints limited to `my, sg, th, ph, vn, id`.
- Lazada Seller Center app listing (Google Play, Lazada) — https://play.google.com/store/apps/details?id=com.sc.lazada&hl=en — states the Seller Center is open to sellers across "Indonesia, Malaysia, Philippines, Singapore, Thailand, Vietnam, and Cross border" — again, no Bangladesh.
- API2Cart's Lazada connection guide — https://api2cart.com/how-to-connect-lazada-to-api2cart/ — documents the same authorize-URL / callback / token-create flow and the testing-vs-online refresh-token validity difference.

**For Daraz Bangladesh: no public path was found.** Specifically, on 2026-10-13:

- No Daraz Open Platform portal (an equivalent of open.lazada.com for Daraz) appears in search results; searches for a Daraz developer portal / `api.daraz.com.bd` / `open.daraz.com` return no official Daraz developer documentation — only Daraz's consumer/seller-centre pages and unrelated documents.
- The public Lazada Open Platform region list does not include a Bangladesh (`bd`) venture or gateway.
- One third-party engineering document claims a Daraz Bangladesh gateway (`https://api.daraz.com.bd/rest`) mirroring the Lazada signing protocol and legacy Seller Center method names (GitHub: https://github.com/mithunahamedrx-source/java-erp/blob/HEAD/docs/DARAZ_PROVIDER_CONTRACT.md). **This is not official Daraz documentation**, and that same document concedes the Lazada-hosted reference's endpoint table lists Lazada regions only and does not list Bangladesh. It is evidence that a Lazada-*style* API may exist behind a Daraz partnership/whitelist — it is **not** evidence of a public, self-serve BD onboarding path, and it must not be coded against as if it were a published spec.

Honest bottom line: a Daraz BD API integration, if possible at all today, appears to require a **direct commercial/ISV arrangement with Daraz Bangladesh** (business development contact, approval, possibly whitelisted app credentials) rather than public self-serve registration. That could not be verified from public sources in this spike — which is itself the finding.

### 2.3 Recommendation — Daraz: **NO-BUILD** (in B9)

- Do **not** build Daraz product sync / order pull in EC14 / B9. There is no verified public spec or onboarding path for a Daraz BD seller to authorize a third-party app.
- Do **not** code against the Lazada Open Platform and label it "Daraz" — a Lazada MY/SG/etc. seller authorization cannot authorize a daraz.com.bd shop, and claiming Daraz support from a Lazada integration would be a false capability claim.
- Revisit trigger: (a) the owner / a tenant opens a Daraz BD business-development conversation and Daraz confirms in writing that third-party API access exists for BD sellers, with its onboarding steps; **or** (b) Daraz publishes an official public developer portal covering Bangladesh. At that point re-run this spike against the official doc before any code. A manual Seller Center CSV/export workflow for Daraz sellers is a separate product question and is **not** an API integration — do not conflate the two.

---

## 3. Meta (Facebook) Commerce Catalog — data feed

**Recommendation: BUILD — FEED-ONLY.** Generate one feed file per tenant/store at a stable HTTPS URL; the tenant adds it once in Commerce Manager → Catalog → Data Sources as a scheduled feed. No Meta app review is needed for a data feed (this is distinct from the Marketing API / catalog API, which is out of scope here).

Sources for this whole section:

- Meta for Developers, *Catalog Reference* (updated 2026-10-05) — https://developers.facebook.com/documentation/ads-commerce/catalog/reference
- Meta Business Help, *Product Data Specifications for Catalogs in Commerce Manager* — https://www.facebook.com/business/help/120325381656392?locale=en_US
- Meta Business Help, *Upload Products to Your Catalog With a Data Feed in Commerce Manager* — https://www.facebook.com/business/help/125074381480892?locale=en_US
- Meta Business Help, *Edit Product Availability and Prices Using a Data Feed* — https://www.facebook.com/business/help/1033769603329681?locale=en_US

### 3.1 Formats & scheduled-fetch mechanism

- **Supported formats:** CSV, TSV, XML (RSS / ATOM), Excel (XLSX), Google Sheets. (Developer reference lists CSV, TSV, RSS XML, ATOM XML, Google Sheets; the Commerce Manager spec page adds XLSX.)
- **Recommended build target for the SaaS: XML (RSS 2.0) or CSV.** XML structure per the developer reference: an RSS 2.0 document declaring `xmlns:g="http://base.google.com/ns/1.0"`; the `g:` prefix is required for attributes in the Google Merchant Center namespace, while other Meta attributes (e.g. `additional_image_link`, `color`) are written **without** the prefix. Meta's own XML example mixes both conventions in one `<item>`.
- **Scheduled fetch:** host the file on your server / hosting site / Google Sheets and give Commerce Manager the URL; Meta fetches it at the scheduled times. The merchant chooses an **hourly, daily or weekly** upload schedule in Commerce Manager. URL must begin `http://`, `https://`, `ftp://` or `sftp://` and link directly to the file (FTP/SFTP credentials can be supplied for protected URLs).
- **Limits (Commerce Manager spec page):** 100 MB for a one-time upload; **4 GB for a scheduled feed** (compress files > 1 GB to ZIP/GZIP); up to ~1 million items per feed recommended (split larger catalogs); 5 MB (5,242,880 characters) max per line/row.
- **Update semantics:** a full feed replaces/updates the items it contains; supplementary (update) feeds can patch a subset (e.g. only `price` + `availability`). To *remove* a sale price via an update feed, send `sale_price` as `0` or empty — merely deleting the column does not clear it.

### 3.2 Required fields — the exact rule

Meta's developer reference states the hard rule in one place, paraphrased here:

> If any of `id`, `title`, `description`, `availability`, `condition`, `price`, `link`, `image_link` are missing or malformed, the product may not upload at all. In addition, at least one of `brand`, `gtin`, or `mpn` is required.

The same reference's field table additionally marks these as **Required** (required for a strong / complete catalog experience, even though their absence does not by itself block ingestion in every case): `brand`, `google_product_category` **or** `fb_product_category` (one of the pair), and `additional_image_link`. **Implementation instruction: emit all of them.** Treat the 8 hard fields + `brand` (+ `gtin`/`mpn` when genuinely known) + a product category + `additional_image_link` as the SaaS's required set — do not ship a minimal 8-field feed.

Conditional-required fields (required *for every product they apply to*): `item_group_id`, `color`, `size`, `age_group`, `material`, `pattern`, `gender`, `additional_variant_attribute` (variant/apparel data), and `sale_price` + `sale_price_effective_date` (for products on sale — see §3.3).

### 3.3 `sale_price` / `sale_price_effective_date` semantics (Meta)

- `sale_price`: the discounted price, formatted exactly like `price` (number + space + ISO 4217 code, e.g. `7.99 USD`); it **must be less than** `price`, otherwise it is not shown. Send it *in addition to* the full `price`, never instead of it.
- `sale_price_effective_date`: an ISO-8601 interval `start/end`, format `YYYY-MM-DDThh:mm±hh:mm/YYYY-MM-DDThh:mm±hh:mm` (example from Meta: `2020-04-30T09:30-08:00/2020-05-30T23:59-08:00`). It controls when the sale price is shown. **If omitted, an item with a `sale_price` stays on sale until the sale price is removed** — so always emit the interval when the sale has real start/end dates, and remove/zero the `sale_price` after the sale ends.

### 3.4 Meta feed field spec (implement directly)

All field names / supported values in US English. Prices: decimal point `.`, no currency symbol, format `<amount> <ISO 4217>` — for this SaaS, e.g. `1250.00 BDT`.

| # | Feed field | Required? | Format / allowed values | Implementation note (SaaS source) |
|---|---|---|---|---|
| 1 | `id` | **Required (hard)** | string, max 100 chars, unique per catalog; duplicate IDs are all ignored | Product/variant SKU if present, else stable product ID. Must exactly match the Meta Pixel `content_id` for Advantage+ catalog ads. One row per variant. |
| 2 | `title` | **Required (hard)** | string, max 200 chars (Meta recommends ≤ 65 to avoid truncation) | Product name (+ variant distinguisher). No ALL-CAPS / promo text. |
| 3 | `description` | **Required (hard)** | plain text, max 9,999 chars; no HTML, no links, not all-caps; must differ from title | Strip HTML from the store description; fall back to a generated plain-text summary, never to the title verbatim. |
| 4 | `availability` | **Required (hard)** | `in stock` \| `out of stock` (note: **spaces**, US English) | Map stock > 0 → `in stock`, else `out of stock`. Out-of-stock items show as "sold out" in Shops and do not serve in ads. |
| 5 | `condition` | **Required (hard)** | `new` \| `refurbished` \| `used` | Default `new` for this SaaS's merchants unless the product is explicitly marked otherwise. |
| 6 | `price` | **Required (hard)** | `<number> <ISO 4217>`, e.g. `1250.00 BDT` | The regular (non-sale) price. Must match the landing-page price. |
| 7 | `link` | **Required (hard)** | absolute `http(s)://` URL on the merchant's own domain (not a facebook.com URL) | Canonical public product URL (native storefront or connected store). |
| 8 | `image_link` | **Required (hard)** | JPG/PNG, ≥ 500×500 px, ≤ 8 MB, absolute URL | Primary image. If the image changes, its URL must change or Meta will not detect the change. |
| 9 | `brand` | **Required** (and satisfies the identifier rule) | string, max 100 chars | Product brand; fall back to the store/business name for unbranded goods. |
| 10 | `gtin` | Recommended (one of brand/gtin/mpn mandatory) | UPC 12 / EAN-JAN 13 / ISBN-13 / ITF-14 digits, no dashes/spaces | Emit **only if genuinely known and correct** — never invent. |
| 11 | `mpn` | Recommended (one of brand/gtin/mpn mandatory) | string, max 100 chars | Emit only if genuinely known; use when there is no GTIN. |
| 12 | `google_product_category` **or** `fb_product_category` | **Required** (one of the pair) | Google taxonomy path or ID, e.g. `Apparel & Accessories > Clothing > Shirts & Tops` or `212`; or the equivalent Facebook taxonomy path/ID | Emit `google_product_category` (shared taxonomy with §4). |
| 13 | `additional_image_link` | **Required** per Meta's field table | up to 50 image URLs, comma/semicolon/space/pipe-separated, whole list quoted in CSV; same image rules as `image_link` | Gallery images after the primary. If a product has no extra image, repeat-handling must be decided at build time (emit the field with remaining gallery images only; an empty value risks an ingestion warning). |
| 14 | `item_group_id` | Conditionally required | string, max 100 chars; identical for all variants of one product | Parent product ID for variant rows; omit for single-variant products. |
| 15 | `color` / `size` / `gender` / `age_group` / `material` / `pattern` | Conditionally required (apparel/variants) | `gender`: `female`\|`male`\|`unisex`; `age_group`: `adult`\|`all ages`\|`teen`\|`kids`\|`toddler`\|`infant`\|`newborn`; size as word/number, e.g. `Medium`, `US 12` | Emit from variant attributes whenever they exist. |
| 16 | `sale_price` | Conditionally required (on-sale items) | same format as `price`; must be < `price` | The active discounted price; see §3.3. |
| 17 | `sale_price_effective_date` | Conditionally required (with `sale_price`) | ISO-8601 interval, §3.3 | Always pair with `sale_price` when sale dates exist. |
| 18 | `product_type` | Recommended | merchant's own category path | Store category breadcrumb. |
| 19 | `status` | Optional | `active` (default) \| `archived` | Use `archived` to retire an item without deleting the row. |
| 20 | `rich_text_description` | Recommended | HTML subset, max 9,999 chars | Optional enhancement; `description` remains mandatory as fallback. |
| 21 | `custom_label_0` … `custom_label_4` / `internal_label` | Optional | free text, max 100 chars per custom label | For product-set filtering (e.g. campaign groupings). |

**XML note for the serializer:** emit `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">` with one `<item>` per variant; prefix the Google-namespace fields with `g:` (per Meta's example: `g:id`, `g:title`, `g:description`, `g:link`, `g:image_link`, `g:brand`, `g:condition`, `g:availability`, `g:price`, `g:sale_price`, `g:item_group_id`, `g:gtin`, `g:google_product_category`) and leave Meta-native fields unprefixed (`additional_image_link`, `color`, `sale_price_effective_date` handling per Meta's examples). Validate the generated file against Meta's published example before shipping — mixed prefixing is the most likely first-build bug.

---

## 4. Google Merchant Center — product data feed

**Recommendation: BUILD — FEED-ONLY.** Generate one feed file per tenant/store at a stable HTTPS URL; the tenant adds it once in Merchant Center as a primary data source with **Scheduled fetch**. No Google approval of the SaaS as a platform is needed for a file feed (the separate Content API for Shopping is out of scope here).

Sources for this whole section:

- Google Merchant Center Help, *Product data specification* — https://support.google.com/merchants/answer/7052112
- Google Merchant Center Help, *RSS 2.0 specification* — https://support.google.com/merchants/answer/14987622
- Google Merchant Center Help, *Create a tab-delimited product data source* — https://support.google.com/merchants/answer/14989239
- Google for Developers, *Content API for Shopping — datafeeds resource (DatafeedFetchSchedule)* — https://developers.google.com/shopping-content/reference/rest/v2.1/datafeeds

### 4.1 Formats & scheduled-fetch mechanism

- **File formats:** (a) **XML** — RSS 2.0 (or Atom) extended with the Google namespace; filename must end in `.xml`; (b) **tab-delimited text** — `.txt` / `.tsv`, first line is the header of attribute names separated by tabs, one product per line, no trailing tabs, no tabs/line-breaks inside values; (c) Google Sheets. Plain Excel files are **not** an accepted file-feed format.
- **RSS 2.0 XML structure:** root `<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">` → `<channel>` (with the store's `title`, `link`, `description`) → one `<item>` per product/variant. `title`, `link`, `description` are RSS elements but are **required** for product data; all other attributes use the `g:` prefix (an attribute without the prefix is ignored). Include **all** products in every file — removing a product from the file removes it from Merchant Center.
- **Scheduled fetch:** in Merchant Center the merchant creates the data source with the fetch option, providing the file URL, optional username/password, fetch frequency, fetch time and time zone; Google fetches via **HTTP, HTTPS, FTP or SFTP**. Via the Content API's `datafeeds` resource the schedule model confirms the shape: **daily** needs `hour`; **weekly** needs `weekday` + `hour`; **monthly** needs `dayOfMonth` + `hour`; plus `fetchUrl` and `timeZone`. The registered filename must match the actual file's name.

### 4.2 Required attributes — the exact rule

From the product data specification (paraphrased per attribute; see the spec table in §4.4 for the implementable version):

- **Always required:** `id`, `title`, `description`, `link`, `image_link`, `availability`, `price`.
- **`condition`:** required **if the product is used or refurbished**; optional for new products (the implicit default is new). Emit it for every product anyway — explicit is safer and matches Meta's requirement, so one canonical value serves both feeds.
- **`brand`:** required **for all new products except movies, books and musical recordings** (otherwise optional). Max 70 chars. Use the manufacturer's brand; only use your own brand if you manufacture / private-label the product; leave empty rather than sending "N/A" / "Generic" for truly unbranded goods.
- **`gtin`:** classified by Google as "it depends — strongly recommended if available". Submit only a **valid** GS1 GTIN (correct check digit; UPC/GTIN-12, EAN/GTIN-13, JAN 8/13, ISBN-13, ITF-14/GTIN-14). A wrong GTIN gets the product **disapproved**; a product that has a GTIN but is submitted without one may get limited visibility. Never guess or fabricate a GTIN.
- **`mpn`:** required **only if the product does not have a manufacturer-assigned GTIN**; optional otherwise. Only submit a manufacturer-assigned MPN you are sure of; a wrong MPN also causes disapproval.
- **`identifier_exists`:** if a product genuinely has no brand/GTIN/MPN combination available (e.g. custom/handmade goods), submit `identifier_exists = no` (and still provide whichever identifiers do exist). Default when omitted is `yes`, which invites missing-identifier errors — so for unbranded local products this field is a practical must.
- **Conditionally required:** `item_group_id` for variants (required for free listings for all variants; required for ads for variant products in BR/FR/DE/JP/UK/US), apparel attributes (`color`, `size`, `gender`, `age_group`) for apparel in specified target countries / free listings, `availability_date` when `availability = preorder`, and shipping/tax settings (configured in Merchant Center account settings or via `shipping` / `tax` attributes, depending on target country).

Bangladesh note: price/tax — Google's rule is that for the US and Canada the `price` excludes tax, and **for all other countries the price must include VAT/GST**. BD consumer prices are normally displayed tax-inclusive, so emit the final shelf price in BDT.

### 4.3 `sale_price` / `sale_price_effective_date` semantics (Google)

- `sale_price` (optional): submit **in addition to** `price`, where `price` stays at the regular non-sale price. Format is identical to `price` (numeric + ISO 4217). It must match the sale price shown on the landing page and at checkout. Do not use it for loyalty/member-only prices where the loyalty-program attribute applies.
- `sale_price_effective_date` (optional, used together with `sale_price`): ISO-8601 interval, max 51 characters, `YYYY-MM-DDThh:mm[+hhmm]` or `…Z`, start and end separated by `/` (example in the spec: `2016-02-24T11:07+0100 / 2016-02-29T23:07+0100`). Start must precede end. **If omitted, the sale price always applies** — the same semantics as Meta.

### 4.4 Google feed field spec (implement directly)

XML form shown (`g:` prefix); the tab-delimited form uses the same attribute names (without prefix) as the header row. Prices: `<amount> <ISO 4217>`, decimal point `.`, e.g. `1250.00 BDT`.

| # | Attribute | Required? | Format / allowed values | Implementation note (SaaS source) |
|---|---|---|---|---|
| 1 | `id` | **Required** | string, max 50 chars, valid Unicode; keep stable across updates & countries/languages | SKU if present, else stable product/variant ID. **Note the 50-char cap — stricter than Meta's 100.** |
| 2 | `title` | **Required** | plain text, max 150 chars; no promo text, no ALL-CAPS | Product name + variant distinguisher; match the landing-page title. |
| 3 | `description` | **Required** | plain text, max 5,000 chars; product facts only, no links/promo/store info | Stripped plain-text description. |
| 4 | `link` | **Required** | absolute `http(s)://` URL on the verified domain, RFC-compliant encoding, no interstitial | Canonical public product URL — the same URL as Meta's `link`. |
| 5 | `image_link` | **Required** | absolute URL; JPEG/WebP/PNG/non-animated GIF/BMP/TIFF; crawlable (robots.txt must allow Googlebot / Googlebot-image); no watermarks/promo text/placeholders. Google has announced ≥ 500×500 px enforcement beginning 2027-01-31 | Primary product image. |
| 6 | `availability` | **Required** | `in_stock` \| `out_of_stock` \| `preorder` \| `backorder` (note: **underscores** — differs from Meta's spaced values) | Serializer must map the canonical stock state per channel; do not reuse Meta's strings here. If `preorder`, also emit `availability_date`. |
| 7 | `price` | **Required** | numeric + ISO 4217, e.g. `1250.00 BDT`; must not be 0 (narrow exceptions only); must match landing page & checkout | Regular price, tax-inclusive outside US/CA (see §4.2). |
| 8 | `condition` | Required if used/refurbished; optional for new | `new` \| `refurbished` \| `used` | Emit for every product (default `new`). |
| 9 | `brand` | **Required for new products** (except movies/books/music recordings) | string, max 70 chars | Manufacturer brand; own brand only if manufacturer/private-label; empty (never "N/A") if truly unbranded. |
| 10 | `gtin` | It depends — strongly recommended if one exists | valid GS1 GTIN only (see §4.2); max 14 digits per value, no dashes/spaces | Emit only when genuinely known & valid. Wrong value ⇒ disapproval. |
| 11 | `mpn` | **Required if no GTIN exists**; else optional | manufacturer-assigned, max 70 alphanumeric chars | Emit only when genuinely known. |
| 12 | `identifier_exists` | Optional (practically required for no-UPI products) | `yes` (default) \| `no` | Set `no` for custom/handmade products lacking brand+GTIN+MPN; still send any identifier that does exist. |
| 13 | `sale_price` | Optional | same format as `price`; send alongside (not instead of) `price` | Active discounted price; must match landing page/checkout. |
| 14 | `sale_price_effective_date` | Optional (pair with `sale_price`) | ISO-8601 interval, max 51 chars, §4.3 | If omitted, the sale price always applies. |
| 15 | `additional_image_link` | Optional | up to 10 additional image URLs (repeat the element in XML) | Gallery images; same image rules as `image_link`. |
| 16 | `item_group_id` | Conditionally required (variants) | string, max 50 chars; same for all variants in the group; parent SKU recommended | Parent product ID. |
| 17 | `color` / `size` / `gender` / `age_group` | Conditionally required (apparel / variants, country-dependent; required for free listings for Apparel & Accessories) | `gender`: `male`\|`female`\|`unisex`; `age_group`: `newborn`\|`infant`\|`toddler`\|`kids`\|`adult`; color as words, never hex/numbers | Emit from variant attributes whenever they exist. |
| 18 | `google_product_category` | Optional (recommended) | taxonomy ID or full path, one value only | Same taxonomy value as Meta field #12 — one mapping serves both feeds. |
| 19 | `product_type` | Optional | merchant's own category path, max 750 chars | Store category breadcrumb. |
| 20 | `shipping` | Optional (account settings may cover it) | sub-attributes country : region : service : price in XML as nested `g:shipping` elements | Emit only if per-product shipping must override account-level settings. |

**XML skeleton (from Google's own RSS 2.0 example, structure only):**

```xml
<?xml version="1.0"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title><!-- store name --></title>
    <link><!-- store home URL --></link>
    <description><!-- feed description --></description>
    <item>
      <g:id>SKU-001</g:id>
      <g:title>…</g:title>
      <g:description>…</g:description>
      <g:link>https://…/products/…</g:link>
      <g:image_link>https://…/image.jpg</g:image_link>
      <g:condition>new</g:condition>
      <g:availability>in_stock</g:availability>
      <g:price>1250.00 BDT</g:price>
      <g:brand>…</g:brand>
      <!-- g:gtin / g:mpn only when genuinely known;
           g:sale_price + g:sale_price_effective_date only while on sale -->
    </item>
  </channel>
</rss>
```

### 4.5 One build, two serializers (shared implementation note)

Meta and Google consume substantially the same canonical product data. Build **one** canonical per-variant export model (id, title, description, link, images, price, sale price + window, stock state, condition, brand, gtin, mpn, category, variant attributes) and **two** thin serializers, handling exactly these divergences:

1. `availability` vocabulary: Meta `in stock` / `out of stock` (spaces) vs Google `in_stock` / `out_of_stock` / `preorder` / `backorder` (underscores).
2. `id` length: cap at **50 chars** to satisfy Google (Meta allows 100).
3. `title`/`description` caps: Google 150 / 5,000 vs Meta 200 / 9,999 — generate to Google's tighter caps for shared fields.
4. Identifier fallback: Meta needs at least one of brand/gtin/mpn (brand fallback to store name is acceptable there); Google needs the brand/gtin/mpn logic in §4.2 plus `identifier_exists=no` for genuinely unbranded goods — the Google serializer must **not** blindly copy Meta's store-name brand fallback for manufacturer-branded products, and must never invent GTIN/MPN in either feed.
5. File/format: Meta — CSV or RSS-XML, hourly-capable schedule; Google — RSS-XML or tab-delimited text, daily is the practical cadence. Serving the RSS-XML form to both is viable, subject to the Meta prefixing note in §3.4.

Neither feed pulls orders, inventory reservations, or payments back into the SaaS. Order-sync claims for Meta/Google must never be made from this feature — it is outbound catalog distribution only.

---

## 5. TikTok Shop product feed / file spec (non-API)

**Finding: no publicly documented, hostable product feed spec exists for TikTok Shop.**

- What exists publicly is the **API** (§1) and, inside Seller Center, a **bulk-upload spreadsheet**: sellers download a category-specific batch-upload template from Seller Center (login required), fill it in, and upload it manually. A captured copy of such a template (dated 2023-04-15, hosted on a document-sharing site: https://www.scribd.com/document/643527469/Tiktoksellercenter-batchupload-20230415-template) shows the pattern: columns are category-dependent, with mandatory fields such as category (name + system ID copied from Seller Center), product name (< 255 chars), product description, parcel weight, and optional parcel dimensions / delivery options / variation fields (variation name, variation image, etc.), with brand optional and resolved against system brand IDs.
- That is **not** an implementable public spec for the SaaS: the template is (a) obtained per-account, per-category from inside Seller Center, (b) not published as a stable developer document with a feed URL / scheduled-fetch mechanism, and (c) useless for BD tenants while TikTok Shop has no BD seller market (§1.3). No TikTok documentation found describes a "host a file at a URL and TikTok fetches it on a schedule" product feed comparable to Meta's or Google's.

**Recommendation: NO-BUILD** for any TikTok feed/file export in EC14. Do not generate a speculative "TikTok CSV" — without a published spec and a BD seller market, there is nothing verifiable to generate against.

---

## 6. Consolidated recommendations for B9 scoping

| Item | Decision | Next action |
|---|---|---|
| Meta catalog feed (EC14 feed target 1) | **BUILD (feed-only)** | Implement per §3.4; per-store feed URL; tenant instructions: Commerce Manager → Data Sources → scheduled feed (hourly/daily). |
| Google Merchant feed (EC14 feed target 2) | **BUILD (feed-only)** | Implement per §4.4, sharing the canonical model with Meta (§4.5); tenant instructions: Merchant Center → data source → Scheduled fetch (daily). |
| TikTok Shop API sync (products/orders) | **NO-BUILD** | Watchlist only; revisit on official BD launch or a supported-market tenant (§1.4). Marketplace order-sync is explicitly out of scope. |
| Daraz / Lazada API sync (products/orders) | **NO-BUILD** | Do not build; revisit only with written Daraz BD confirmation of third-party API access (§2.3). Marketplace order-sync is explicitly out of scope. |
| TikTok Shop file/feed export | **NO-BUILD** | No public spec exists (§5). |

### Open questions / risks to carry forward

1. **Meta `additional_image_link` "Required" marking** (§3.2) vs the hard-fail list that omits it — resolve at build time by testing a single-image product against a real Commerce Manager catalog during M30-style live verification; until then, emit the field whenever any gallery image exists.
2. **Unbranded / handmade BD products** are common for this SaaS's sellers: the Google `identifier_exists=no` path and Meta's brand-fallback must both be exercised in tests with a product that has no brand, GTIN or MPN — and neither feed may invent identifiers to pass validation.
3. **Currency/tax presentation:** both feeds take `BDT` prices that must match the landing page exactly; if the native storefront shows tax-inclusive prices, feed prices must be those same tax-inclusive values (Google §4.2).
4. **Daraz/TikTok re-check cadence:** both no-builds rest on market/portal availability as of 2026-10-13. Re-verify before any future marketplace batch — do not treat this document as permanently current.

---

## Sources index (all accessed 2026-10-13)

**TikTok Shop**

- Developer Guide mirror: https://github.com/lazykern/ecommerce-api-docs/blob/HEAD/data/processed/tiktok/guides/developer-guide/tiktok-shop-developer-guide.md
- Developer Terms (EU/UK) mirror: https://github.com/lazykern/ecommerce-api-docs/blob/HEAD/data/processed/tiktok/guides/partner-guide/terms-and-policies/eu-uk-tiktok-shop-developer-terms-of-service.md
- Apideck, TikTok Shop OAuth app registration: https://developers.apideck.com/connectors/tiktok/docs/application_owner+oauth_credentials
- API2Cart, How to connect TikTok Shop: https://api2cart.com/how-to-connect-tiktok-shop-to-api2cart/
- DPL, TikTok Shop Available Countries 2026: https://dpl.company/countries-with-access-to-tiktok-shop-seller-center/
- PhotonPay, TikTok Shop Countries (2026): https://www.photonpay.com/hk/blog/article/tiktok-shop-available-countries
- Project Casting, TikTok Shop Creator markets 2026: https://projectcasting.com/blog/casting-calls-acting-auditions/how-to-become-a-tiktok-shop-creator-in-2026-requirements-commissions-earnings
- TikTok Seller Center batch-upload template (captured copy, 2023-04-15): https://www.scribd.com/document/643527469/Tiktoksellercenter-batchupload-20230415-template

**Daraz / Lazada**

- Lazada Open Platform: https://open.lazada.com (portal; documentation referenced by the SDKs below)
- Lazop SDK (reproduces official authorization flow): https://github.com/hoerilahyar/laravel-lazop
- Laraditz Lazada package (official API surface): https://github.com/laraditz/lazada/blob/HEAD/README.md
- Lazada region/App Key reference: https://github.com/qhkm/zeptoclaw-skills/blob/HEAD/lazada/SKILL.md
- API2Cart, How to connect Lazada: https://api2cart.com/how-to-connect-lazada-to-api2cart/
- Lazada Seller Center app (venture list): https://play.google.com/store/apps/details?id=com.sc.lazada&hl=en
- The Nation, Daraz South Asia markets: https://www.nation.com.pk/28-Jul-2023/daraz-to-empower-south-asian-users-shopping-experience-with-microsoft-azure-openai-service
- Third-party (non-official) Daraz API contract notes — cited as unverified only: https://github.com/mithunahamedrx-source/java-erp/blob/HEAD/docs/DARAZ_PROVIDER_CONTRACT.md

**Meta**

- Catalog Reference, Meta for Developers: https://developers.facebook.com/documentation/ads-commerce/catalog/reference
- Product Data Specifications for Catalogs in Commerce Manager: https://www.facebook.com/business/help/120325381656392?locale=en_US
- Upload Products to Your Catalog With a Data Feed: https://www.facebook.com/business/help/125074381480892?locale=en_US
- Edit Product Availability and Prices Using a Data Feed: https://www.facebook.com/business/help/1033769603329681?locale=en_US

**Google**

- Product data specification, Merchant Center Help: https://support.google.com/merchants/answer/7052112
- RSS 2.0 specification, Merchant Center Help: https://support.google.com/merchants/answer/14987622
- Create a tab-delimited product data source, Merchant Center Help: https://support.google.com/merchants/answer/14989239
- Content API for Shopping — datafeeds / DatafeedFetchSchedule: https://developers.google.com/shopping-content/reference/rest/v2.1/datafeeds
