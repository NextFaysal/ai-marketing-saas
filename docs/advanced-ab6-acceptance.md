# AB6 Acceptance — Discovery & Content (AX11–AX14)

**Batch:** AB6 of the E-Commerce Advanced Program (`Ecommerce-Advanced-Plan-2026-10-15.md`).
**Worktree:** `~/workspace/ai-marketing-saas-gc`, branch `completion`. **6 local commits, NO push.**
**Migration:** `20261017060000_ab6_discovery_content` — **NOT run on any real DB** (deploy-time step, owner's environment).

| Commit | Content |
|---|---|
| `ab4eead` | Schema + migration: Product.nameEn/descriptionEn/searchVector (TSVECTOR + GIN), BlogPost, SearchSynonym, SearchQueryLog, FTS backfill |
| `4feb004` | AX11 search-vector maintenance hooks (product create/update/variants, category/brand rename, imports, store sync) + AX13 En fields through DTO, CSV/XLSX import, CSV export |
| `e505981` | AX11 FTS shop search + synonym CRUD/analytics/reindex endpoints, AX12 blog API, AX13 locale display threading (cart/quote/order snapshots), AX14 cart recommendations endpoint |
| `b76978a` | Web shop: blog pages + shared PageBlocks renderer, blog menu link + sitemap entries, CrossSellRail on cart/checkout, recently-viewed v2, i18n |
| `ec8144f` | Web dashboard: blog editor + search analytics/synonym UI (shared BlocksEditor), product-form English section |

## AX11 — Smart search (PostgreSQL FTS) ✅

**Honest naming:** this is PostgreSQL full-text search + a merchant synonym map. No semantic/AI claim exists anywhere in UI copy or docs ("স্মার্ট সার্চ = পূর্ণ-টেক্সট অনুসন্ধান (FTS)").

**Design.** `Product.searchVector` is an `Unsupported("tsvector")` column (in the Prisma schema so migrate stays clean; never written through the Prisma client) with a GIN index (`@@index([searchVector], type: Gin)` — `prisma validate` clean, zero AB6 migrate-diff drift). The vector is built by ONE canonical SQL expression (`apps/api/src/products/search-vector.ts`, textually mirroring the migration backfill):

- **Weight A:** `name` + `nameEn`, and `sku` + all variant SKUs (`string_agg` subquery)
- **Weight B:** structured Category name (id subquery) + legacy `category` string + Brand name (id subquery)
- **Weight C:** `description` + `descriptionEn`
- Config **`'simple'`** throughout: honest Bengali + English token matching, **no stemming** (Bengali morphology is not stemmed by any stock PG dictionary; 'simple' makes no such claim).

**Maintenance.** Failure-isolated hooks (a vector failure only logs a warning; the product write always stands) at: `ProductsService` create / update / variant create+update+delete / category rename / brand rename (the last two re-vector that category's/brand's products with one scoped UPDATE statement), the CSV/XLSX import pipeline's product creates, and the Woo/Shopify sync upsert. Archive is deliberately not hooked (queries filter `status='ACTIVE'`). Products written by any path that somehow misses a hook are repaired by the staff **reindex** action or their next update. A staff endpoint `POST organizations/:orgId/storefront/search/reindex` rebuilds the whole org's vectors in one statement and returns the affected count (audited).

**Query path.** `GET /public/shop/:orgSlug?q=…` (shopHome) now tries FTS first: `plainto_tsquery('simple', …)` + `ts_rank` ordering, ACTIVE + org-scoped + `searchVector IS NOT NULL`, `LIMIT 500`; the returned id order becomes the listing order (explicit shopper-chosen sorts still override it downstream, as before). **Fallback:** when FTS is unavailable (no `$queryRaw` — the legacy spec harnesses) or returns zero rows, the OLD substring `matchesSearch` scan runs unchanged — recall is never worse than before AB6. **Synonym rule (exact):** normalize = trim + lowercase + collapse whitespace. If the whole normalized query equals a `SearchSynonym.term`, its expansions are added; else every whitespace token equal to a term contributes that term's expansions. Phrases (original first, deduped, capped at 11) are combined as `(plainto_tsquery(…)::text || ' | ' || …)::tsquery` — phrases are bound parameters only, never interpolated into SQL text (spec-asserted). The substring fallback does NOT use synonyms (it is the legacy path). **Analytics:** every shopHome search writes a `SearchQueryLog` row (normalized term ≤200 chars, resultsCount = the search-stage result count before category/brand filters, `viaFallback` internal flag) fire-and-forget with an internal catch — a logging failure can never break a search (spec-pinned). `viaFallback` is never exposed on the public payload. Staff surface (dashboard storefront → search page): `GET search/analytics` (last 30 days, 5,000-row bound, top-20 terms + top-20 zero-result terms), synonym CRUD (org-scoped, normalized, ≤10 expansions × ≤100 chars, clash = Bengali 400, audited), reindex button.

**Backfill boundary:** the migration backfill covers **all** product-local + related fields for **every** existing product (category/brand names via id subqueries, variant SKUs via aggregation) — proven live: products inserted into a 178-migration DB gained correct vectors from the AB6 migration itself (see Gates). No "reindex needed after deploy" caveat applies to pre-existing catalog; only products created later through a hypothetical unhooked path would wait for reindex/next-update.

## AX12 — Shop blog ✅

`BlogPost` (org-scoped, slug unique per org) with the **GC1 ShopPage block vocabulary** — `validateShopPageBlocks` is reused verbatim; structured blocks only, no raw HTML anywhere. Staff CRUD mirrors the pages editor's discipline (slug explicit-or-derived via `slugifyShopPageTitle` + `SHOP_PAGE_SLUG_PATTERN`, clash = 400, blocks re-validated on update, audited `storefront.blog_*`), status `draft|published` with `publishedAt` stamped on the draft→published transition (unpublishing keeps the stamp as the last-publish record — commented in code). Tags normalized server-side (trim, dedupe, ≤10 × ≤40 chars). Public: `GET /public/shop/:orgSlug/blog` (published only, newest first) + `/:postSlug` (draft = 404), rendered at `/shop/:orgSlug/blog[/:postSlug]` through a **shared `PageBlocks` renderer** extracted from the content-page component (the `p/[pageSlug]` page now uses it too — behaviour unchanged, its tests green) and the shop theme tokens; post pages emit their own metadata (seo fields ?? title/excerpt, OpenGraph likewise). The shop header gains a blog link exactly when the org has ≥1 published post (`home.pages.blog`, failure-isolated). The sitemap includes the blog index + every published post with real lastmod. Dashboard editor mirrors the pages editor with its block editor extracted into a shared `BlocksEditor` used by both (no duplication). Both new public routes were **deliberately added to the GB9 frozen route inventory** with an AB6 comment (the drift-guard spec passes).

## AX13 — Multi-language product content ✅

`Product.nameEn` / `descriptionEn` (nullable). **Convention (in the form help text):** the primary name/description are the shop's main language; the En fields are the English alternates. **Locale rule (one pure helper, `products/product-display.ts`):** shop locale `en` → `nameEn` when non-blank else primary; description likewise (`descriptionEn` else primary, may stay null). Threaded through: `serializeProduct` (home listing, PDP, related, brand page, flash-sale payloads, recommendations), cart line `productName`, the quote serializer, and **order item snapshots** — shop checkout placement items (incl. the EC29 gift line), the single-product checkout payload + placement, and the landing payload + placement all snapshot the locale-resolved displayed name (express checkout delegates to shop checkout, so it inherits it). Product create/update DTOs accept the fields (verified against the real `forbidNonWhitelisted` ValidationPipe by spec); update normalizes a cleared field (`""`) to null; `toPublicProduct` spreads them automatically. CSV export gains `name_en`/`description_en` columns right after `description` (the GB2 frozen-header spec was updated deliberately; round-trip assertions unchanged); CSV **and** XLSX import accept them (`parseProductsXlsx` funnels through the shared `parseProductRecords`), and files without the columns import exactly as before (spec-pinned). The FTS vector includes both En fields. Dashboard product list/search are untouched (primary names), per the brief.

## AX14 — Cart cross-sell + recently viewed ✅

`GET /public/shop/:orgSlug/recommendations?context=cart&productIds=a,b,c` (context accepted; only `cart` exists in v1) aggregates co-purchase over **all** seed products via a new pure ranker `rankBoughtTogetherForSeeds` in `ec27-discovery.ts` — the same sold-order definition, 180-day window, gift-line exclusion, per-order dedupe and ≥2 co-occurrence threshold as the PDP engine (whose loader was extracted into a shared `soldOrderItems`; PDP behaviour byte-identical, ec27 specs green). Seeds themselves, archived and **out-of-stock** products are excluded; ≤8 results in the exact PDP card payload shape. The cart and checkout pages render an "আপনার জন্য আরও" rail of ProductCards (add-to-cart rides the card's existing QuickView → normal server cart path; no new cart semantics). PDP recommendations are unchanged. **Recently viewed** was upgraded from EC27's stored-card strip to the briefed design: localStorage now stores **ids only** under a versioned key (`shop-recently-viewed:v2:<slug>`, cap 8; legacy v1 cards are migrated to ids once), and the strip resolves them live through the shop listing's new `?ids=` mode (requested order preserved, ACTIVE only) — prices/stock are always current, vanished products drop out, and a failed fetch renders nothing rather than stale prices. No server-side view tracking exists (the code comments state it: a client convenience, not analytics).

## Gates (coordinator-run, exit-code checked)

| Gate | Result |
|---|---|
| API jest (chunked by module, `--runInBand`) | **388 suites / 4,311 tests** — baseline 386/4,272 + 39 new (28 AX11/AX14 + 11 AX12/AX13). One inbox test failed inside a grouped chunk; the inbox group re-run standalone passed **561/561** (inbox is untouched by AB6; consistent with the known cx3 flake — reported, not hidden). |
| API tsc | exit 0 |
| Web vitest | **469/469, 60 files** (baseline 462 → +7: recently-viewed v2, sitemap blog) |
| Web tsc | exit 0 |
| `pnpm -r build` | exit 0 — 7/7 projects incl. both Next builds |
| `prisma validate` | exit 0 |
| Fresh-DB (PostgreSQL 16, throwaway cluster) | **179/179 migrations clean** (two independent fresh DBs); 272 public tables; zero AB6 migrate-diff drift |
| FTS proof on real PG | Three levels: (1) early design smoke (BN/EN/SKU/OR-expansion/ranking); (2) **migration backfill proven** — products inserted at the 178 state gained vectors from the AB6 migration itself; (3) **runtime smoke 12/12 PASS** — a script driving the *actual shipped functions* (`refreshOrgSearchVectors`, `refreshProductSearchVector`, `expandSynonymQueries`, `buildTsQuerySql`) through a real PrismaClient: BN name hit, EN nameEn hit, synonym expansion, name-beats-description ranking, archived exclusion, variant-SKU + brand matching, null-vector repair, and BlogPost/SearchSynonym/SearchQueryLog client round-trips |

## Deploy notes

- Run migration `20261017060000_ab6_discovery_content` (additive only). Existing products are backfilled by the migration itself; no post-deploy reindex is required (the staff reindex remains as the drift-repair path).
- No new per-org jobs. No new public routes beyond the three deliberately inventoried ones (`GET …/recommendations`, `GET …/blog`, `GET …/blog/:postSlug`).

## Honest limits

- **Nothing is live-proven:** no production deploy, no real merchant catalog searched, no live blog published (standing M30-style verification owed). All proof is spec + fresh-DB + local-build level, as labelled above.
- `'simple'` FTS config means **no stemming and no typo tolerance**: "শাড়ি" will not match "শাড়ী" spelling variants or inflected forms unless the merchant adds a synonym — the synonym map is the deliberate, merchant-controlled answer to that, and the zero-result analytics exist so merchants can see what to add.
- The FTS service-level specs run against a fake `$queryRaw` (mini-matcher); the real PostgreSQL behaviour is proven by the fresh-DB smokes above, not by jest.
- Search analytics are bounded (30-day window, 5,000 rows per read, in-memory aggregation — the EC23/ON7 pattern), and `resultsCount` is the search-stage count before category/brand filters.
- Order-snapshot locale threading covers the shop checkout, single-product checkout and landing checkout (the three native placement paths); externally-synced orders (Woo/Shopify) keep the names the external store sends, as before.
- Blog has no RSS feed, no comments, and no scheduled publishing in v1 (not in the AX12 brief); the editor's list envelope follows the ShopPage conventions.
