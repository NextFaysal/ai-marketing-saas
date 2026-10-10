# Milestone 19 (Phase H) — Implementation Brief: Verified Meta API Facts & Repo Gaps

Prepared 2026-10-10 alongside the owner's "Phase H শুরু করো" approval,
so the build starts from checked API behaviour and checked repo state
instead of re-deriving both. Scope source: docs/advertising-review.md §3
(H1–H6). Everything below is either read from this repo's schema or
summarised from Meta's official developer documentation (links at the
end); nothing is quoted at length and no size/count is estimated.

## Repo facts that shape the design (read from prisma/schema.prisma)

- `Product`: has `imageUrl?`, `slug?`, `sku?` (unique per org),
  `priceMinor` (BigInt), `compareAtMinor?`, `currency` (default BDT),
  `stockQuantity?`, `category?`, `source` (manual|csv|woocommerce|
  shopify). **No brand field, no public product URL.**
- `Store`: has `url`, `currency`, `platform` — the only trustworthy
  base for a product link.
- `Customer`: `email?`, `phone?`, `firstName?`, `lastName?` all
  nullable; `mergedIntoId` marks merged-away shells (M17).

## H3 — Custom audiences (highest-risk item; read first)

- Create: `POST /act_{id}/customaudiences`, then upload with
  `POST /{audience_id}/users` using a `payload` of
  `{schema: [...], data: [[...], ...]}`. Schema keys include `EMAIL`,
  `PHONE`, `FN`, `LN`, `EXTERN_ID`. All PII must be SHA-256 hashed
  after normalisation; `EXTERN_ID` itself is not hashed.
- **Batch limit: 10,000 users per request.** Larger lists need
  multiple requests tied together with session info so completion
  can be tracked. Design the sync as chunked + resumable from the
  start; a single-shot upload will silently cap real customer lists.
- Phone normalisation must reuse the M18 CAPI helper (BD numbers to
  country-code digits, no `+`); hashing a `01…` local number produces
  an audience that matches almost nobody, with no error from Meta.
- Rows with neither email nor phone must be skipped and the skip
  count reported (Customer fields are nullable). Customers with
  `mergedIntoId` set must be excluded — they are hidden shells, and
  uploading them double-counts the survivor.
- Expect a Custom-Audience **Terms acceptance** error path on the
  first customer-list audience for an account whose owner has not
  accepted Meta's terms in Ads Manager. Surface Meta's own error
  (project rule: never fake success); add a UI hint pointing at the
  Ads Manager acceptance step.
- Audience size/status: read back Meta's own fields
  (`approximate_count_*`, `delivery_status`, `operation_status`);
  never compute or estimate locally.

## H4 — Lookalikes & targeting

- Create: same `customaudiences` endpoint with `subtype=LOOKALIKE`,
  `origin_audience_id`, and `lookalike_spec` such as
  `{"type":"similarity","country":"BD"}`; ranged lookalikes use
  `starting_ratio` + `ratio` (e.g. 0.01–0.03 segment).
- A lookalike source needs roughly **100+ matched people per target
  country** to be usable — with small BD customer lists this is the
  common failure; record Meta's status honestly instead of marking
  the lookalike ready.
- Targeting passthrough for ad sets: `custom_audiences: [{id}]`,
  `excluded_custom_audiences: [{id}]`, `interests`/`behaviors` as
  `{id, name}` objects — validate ids exist before publish, keep the
  existing 4-field targeting working unchanged.

## H5 — Catalog sync (repo gap is the design driver)

- Endpoint: `POST /{catalog_id}/items_batch` with
  `item_type=PRODUCT_ITEM` and `requests: [{method: "UPDATE",
  retailer_id, data: {...}}]`. Required per item: title,
  description, availability (`in stock`/`out of stock`), condition,
  price as integer minor units **plus a separate `currency` field**,
  `link`, and `image_link`. (Note: `items_batch` field names differ
  from the legacy `/batch` endpoint — e.g. `item_group_id`, and
  sale windows go in one `sale_price_effective_date` string.)
- Our products: `retailer_id` = `sku` when present else product id;
  price maps directly from `priceMinor` + `currency` (no float
  conversion — this is why the integer-minor convention pays off);
  `compareAtMinor` maps to a sale price only when lower than price.
- **Skip-with-reason rules (never invent data):** no `imageUrl` →
  skip, Meta rejects/silently drops items without a scrapeable
  public image; no trustworthy link → skip. A link can be built as
  `Store.url + /product/{slug}` **only** for store-sourced products
  with a slug (WooCommerce/Shopify permalink shape); manual/CSV
  products have no public page, so they stay skipped until the org
  sets a product-base-URL. Record per-item status + skip reason,
  mirroring the CSV-import honesty pattern from M2.
- No brand field exists; omit `brand` rather than inventing one
  (or add an org-level default-brand setting in BusinessProfile —
  owner's choice, do not hardcode Qosprey or anything else).
- Variants: group with `item_group_id` = parent product's
  retailer_id; only variant leaves carry it.

## H1/H2 — Media & formats

- Images: `POST /act_{id}/adimages` (multipart file) returns a
  per-image `hash`; creatives then reference `image_hash` instead
  of a URL. Store hash + dimensions on the library asset.
- Videos: `POST /act_{id}/advideos` returns a video id, but the
  video is **not immediately usable** — Meta processes it
  asynchronously. Store a processing status on the asset, poll it,
  and let the builder select a video only once Meta reports it
  ready; surface "processing" honestly in the library UI.
- Carousel: one creative `link_data` with 2–10 `child_attachments`
  (each: link + picture or image_hash + name/description). Cards
  built from products inherit the same skip rules as H5 for
  missing images/links.

## H6 — Duplicate & templates

No API risk. Duplicate = structure-only deep copy into a fresh
draft (no external ids, no publish logs copied); the 3 BD
blueprints from the review (COD sales, CTWA engagement, lead form)
are static prefills — keep them clearly labelled as starting
points, with budgets left blank rather than pre-filled with
invented "typical" numbers.

## Sources (Meta developer documentation, summarised)

- Customer-file custom audiences & users upload (schema, hashing,
  EXTERN_ID, 10k/request session batching):
  https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/custom-audiences
  and the CustomAudience/users reference:
  https://developers.facebook.com/docs/marketing-api/reference/custom-audience/users/
- Lookalike creation (`lookalike_spec`, ratios):
  https://developers.facebook.com/docs/marketing-api/audiences/guides/value-based-lookalike-audiences/
- Catalog items_batch field mapping vs legacy batch endpoint:
  https://developers.facebook.com/docs/marketing-api/reference/product-catalog/items_batch/
  (migration notes on the same docs site)
