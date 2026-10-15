# E-Commerce Batch B2 (EC3 + EC4) — Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-package` (base B1 `4fee197`) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Full-System-Plan-2026-10-12.md` §২ (সিদ্ধান্ত ১, ৩, ৪, ৫), §৩ ম্যাট্রিক্স, §৪ EC3/EC4, §৫ গেট।

---

## যা তৈরি হয়েছে

### EC3 — Schema (কমিট `3b20ab6`, মাইগ্রেশন `20261013020000_ec3_catalog`)

- `Product`: `weightGrams/lengthCm/widthCm/heightCm` (Int?), `barcode/seoTitle/seoDescription` (String?), `categoryId` + `categoryRef` relation (SetNull)। Legacy `category` string অপরিবর্তিত — সম্পর্কের নিয়ম: `categoryId` সেট করলে service string-টিকে category-র নামে sync করে; `categoryId` clear করলে string যেমন আছে থাকে (dto-তে `category`-ও এলে সেটাই জেতে)।
- `ProductImage` (productId, url, altText, position) — `Product.imageUrl` হলো position-0 ছবির mirror (service reorder/add/delete-এ sync রাখে), পুরনো কোডের জন্য backward compatible।
- `Category` (org-scoped, slug unique per org, self-parent), `ProductTag` + `ProductTagAssignment`, `StoreTaxonomyMap` (storeId+kind+localId → externalId — remote category/tag/collection id এখানেই থাকে)।
- `StoreListing`: `saleStartsAt/saleEndsAt` (sale schedule — **listing-স্তরে**, কারণ sale চ্যানেলভেদে আলাদা হতে পারে), `saleActive`, `lastPushedAt`।

### EC3 — Adapters ও read-back (কমিট `781d78f`)

- Capability নতুন অপারেশন: `archive_product`, `delete_product_remote`, `push_category`। Woo/Shopify-তে `push_product/push_inventory/push_category/archive_product/delete_product_remote` এখন **true**; Native অপরিবর্তিত (সব false)।
- **Woo** (`woo-catalog.ts`): products POST/PUT, variations `/variations/batch` (unmapped create / mapped update, sku-then-order matching), `/products/batch` helper client-এ (bulk পথ)। Payload: regular/sale price (saleOn নিয়মে), manage_stock + stock, status (published→publish, draft/archived→draft), categories/tags — `StoreTaxonomyMap`-এ miss হলে remote-এ তৈরি করে map save (free-text category string taxonomy হিসেবে push হয় না), images URL `src` দিয়ে (Woo REST media upload করতে পারে না — প্ল্যানের documented পথ), weight **grams → kg string** (নিচে অনুমান দেখুন), dimensions cm string, barcode/SEO `meta_data`-র `ec_*` key-তে (Woo core-এ SEO field নেই — সৎ সীমা)।
- **Shopify** (`shopify-catalog.ts`): `productSet` mutation (2025-10) — status ACTIVE/DRAFT/ARCHIVED, tags, SEO `global/title_tag`+`description_tag` metafield, ছবি `files: [{ originalSource: <url>, contentType: IMAGE }]` (Files API-র URL originalSource পথ — staged upload নয়), variants ("Variant" productOption), saleOn-এই compareAtPrice। Category থাকলে collection ensure (map) + `collectionAddProducts` (userErrors = পুরো push ব্যর্থ, verbatim)। Client-credentials token মেয়াদ গেলে exchange + credential persist (ShopifyService-এর refresh semantics mirror)।
- **Read-back verification (EC3-র নিয়ম):** প্রতিটি product/inventory push-এর পর adapter platform থেকে GET/query করে name/status/price/stock/variant-count (inventory-তে level quantity) মেলায়। মিললে listing `synced` + `lastPushedHash`/`lastPushedAt`/externalId/externalVariantMap আপডেট; না মিললে `failed` + verbatim `readback_mismatch: <field> expected <x> got <y>` listing-এর `lastSyncError`-এ। Platform error-ও verbatim। Conflict অবস্থার listing-এ push হয় না (`listing_conflict_open`)।

### EC3 — Orchestration, Products API, Commerce endpoints (কমিট `856cf0a`)

- **CatalogPushService:** push enqueue শুধু `syncMode="full-manage"` স্টোরে; published listing-এ price/stock/edit অটো-enqueue, **নতুন প্রোডাক্টে listing draft-এ তৈরি হয়, push হয় শুধু স্পষ্ট "Publish to store" ক্লিকে** (auto-push নেই); enqueue idempotency = `push_product:<listingId>:<contentHash>` — payload অপরিবর্তিত হলে নতুন row নয়। Conflicted listing সবসময় skip (force দিয়েও নয়)।
- **ProductsService hooks:** create/update/archive/variant লেখাগুলো failure-isolated try/catch-এ CatalogPush ডাকে — store push ব্যর্থ হলেও লোকাল ফ্লো ভাঙে না। Update সবসময় enqueue চেষ্টা করে (hash dedupe-ই no-change ফিল্টার)।
- **Bulk edit:** `POST products/bulk-edit/preview` (কিছু লেখে না; affected + missing + প্রথম ৫০টির before→after) ও `/apply` (আগের update পথ দিয়েই লেখে, per-item verbatim ফলাফল)। Percent math BigInt basis-point, round-half-away-from-zero।
- **Duplicate:** product+variants+images+tags কপি, SKU `-copy/-copy-2…`, status DRAFT, **listings/costs কপি হয় না**।
- **Images/Categories/Tags API:** gallery CRUD + reorder (position-0 mirror), category CRUD (rename-এ Product.category string sync, parent cycle check), tag CRUD।
- **Conflict (সিদ্ধান্ত ৫ সক্রিয়):** `ListingsService.detectInboundConflict` — remote hash বদলেছে AND (pending outbox work আছে OR local hash ≠ lastPushedHash) হলেই SyncConflict (field "product", dedupe open থাকলে)। Hookটি শেয়ার্ড `IntegrationsService.upsertProduct`-এর ভেতরে pre-write, failure-isolated — Woo sync/webhook ও Shopify sync/webhook (একই upsertProduct ব্যবহার করে) চার পথেই কাজ করে; storeId call site গুলো থেকে পাস হয়। `recordInboundProduct` conflict status overwrite করে না।
- **Resolve:** `POST commerce/conflicts/:id/resolve { keep_local | take_remote }` — keep_local: আগে conflict resolved (`local_wins`) + listing pending চিহ্নিত, তারপর push enqueue (নইলে নিজের conflict-pause-এই আটকাত); take_remote: সংরক্ষিত remote snapshot product-এ প্রয়োগ (normal field update; price BigInt), resolution `remote_wins`। দুটোই audit-logged।
- **Listing actions:** publish/unpublish, channel-price (override; published হলেই push enqueue), sale-schedule PATCH + `sale_schedule` Automations job (15 মিনিটের template; boundary-তে saleActive flip + push enqueue), OWNER-only `DELETE commerce/listings/:id/remote` — সরাসরি delete নয়, outbox row (`delete_product_remote`)।
- **Delete শৃঙ্খলা:** লোকাল product delete/archive আগের মতোই শুধু লোকাল; স্টোরে delete শুধু ওই আলাদা OWNER অ্যাকশনে।

### EC4 — Multi-Channel Inventory (কমিট `24dd3fd` + `856cf0a`-এর locations অংশ)

- **StoreLocation:** মডেল (মাইগ্রেশন `20261013030000_ec4_inventory`) + commerce API-তে CRUD (default সেট করলে বাকিগুলো unset) + Shopify থেকে refresh (GraphQL `locations(first:50)`, active শুধু, gid-এর numeric tail = externalLocationId, default না থাকলে প্রথমটি default)।
- **Inventory push:** `InventoryService`-এর প্রতিটি আসল স্টক পরিবর্তন (adjust, order-placed, restore) `@Optional` CatalogPush দিয়ে absolute quantity-সহ `push_inventory` enqueue করে — Shopify-তে inventory-only mutation (full product push নয়), Woo-তে stock field PUT। Shopify-তে default location map না থাকলে push ব্যর্থ হয় verbatim **`shopify_location_not_mapped`** দিয়ে — Sync Center-এ দেখা যায়, silent skip নয়। `recordSyncedStock` (inbound) কখনো push trigger করে না (loop প্রতিরোধ)।
- **BundleItem:** মডেল + Products API-তে CRUD। অর্ডার বসলে S1-এর `applyOrderPlaced`-এর ভেতরেই component decrement (reason `bundle_component`, (orderId, component, variant) idempotent, untracked হলে skip — product↔variant fallback নেই, negative balance সত্যিকারভাবে record হয়), restore-এ placed replay-তে component-ও ঠিক একবার ফেরত। **এক স্তর মাত্র** — component নিজে bundle হলেও তার component কমে না (documented)।
- **stockDiverged signal:** listings list (Sync Center) ও product channels endpoint-এ computed-on-read: `channelStock ≠ Product.stockQuantity` এবং কোনো outbox কাজ pending নেই। UI-তে এটি **"সংকেত, প্রমাণ নয়"** বলে লেবেল করা।

### EC3 Web (কমিট `d23fdde`)

Products page v2: নতুন ফিল্ড (ওজন/মাপ/বারকোড/SEO), category select + tag chips ও quick-add, duplicate, bulk-edit (প্রিভিউ ছাড়া apply অসম্ভব — apply শুধু প্রিভিউ modal থেকে), চ্যানেল ডায়ালগ (syncMode ব্যাখ্যা full-manage না হলে, publish/unpublish, syncStatus + verbatim error, channel price override, sale schedule, stockDiverged সতর্কবাক্য, OWNER-only delete-from-store confirm), গ্যালারি ও বান্ডল ডায়ালগ, ক্যাটাগরি ম্যানেজার। Sync Center: conflict resolve (দুই choice, confirm-সহ), per-store locations সেকশন (Shopify refresh শুধু SHOPIFY স্টোরে)। বিদ্যমান সব প্যানেল (sales report, variants, import, stock adjust) অপরিবর্তিতভাবে কাজ করে।

## গেট (সব সবুজ — coordinator নিজে চালিয়ে)

| গেট | ফলাফল |
|---|---|
| Prisma validate | ✅ valid |
| API jest (full) | ✅ **229 suites, 2041/2041** (B1: 222/1961 → +80 tests: woo-catalog 5, shopify-catalog 4, catalog-push 15, ec3-catalog 22, ec3-commerce 13, conflicts 9, ec4-bundle 11, ec-di assertion হালনাগাদ) |
| API tsc | ✅ 0 errors |
| Web vitest | ✅ 20 files, **140/140** |
| Web tsc | ✅ 0 errors |
| Production build (`pnpm build`, সব প্যাকেজ + next build) | ✅ green |

DI: আসল Nest graph-এ ProductsService-এ CatalogPushService injection এবং CommerceService-এর ৪-আর্গ constructor resolution ec-di + আলাদা যাচাইয়ে প্রমাণিত (M65 শিক্ষা)।

## মাইগ্রেশন ও deploy নোট

- `20261013020000_ec3_catalog`, `20261013030000_ec4_inventory` — **কোনো আসল DB-তে চালানো হয়নি**; deploy-এ `prisma migrate deploy` লাগবে, নইলে ProductImage/Category/StoreLocation/BundleItem-নির্ভর endpoint 500 দেবে।
- Sale schedule কাজ করতে per-org Automations-এ `sale_schedule_sweep` টেমপ্লেট থেকে job চালু করতে হবে; sync_outbox job-ও আগের মতো প্রয়োজন (push আসলে তবেই প্রসেস হয়)।

## সৎ সীমা ও বিচ্যুতি

- **কোনো live Woo/Shopify স্টোরে প্রমাণ হয়নি** — সবকিছু fixture/stub-fetch/spec-প্রমাণিত। Live verification EC12/M30-তে মালিকের আসল স্টোর দিয়ে হবে।
- **Woo weight unit অনুমান:** Woo-র weight field স্টোরের সেটিং unit-এ থাকে; আমরা ধরে নিয়েছি unit = **kg** এবং grams/1000 পাঠাই। স্টোরের unit lb/g হলে মান ভুল যাবে — live যাচাইয়ে ধরা পড়লে store-ভিত্তিক unit সেটিং যোগ করতে হবে। Dimensions cm ধরে পাঠানো হয়।
- **Shopify ছবি:** staged upload নয় — `productSet`-এর `files.originalSource`-এ public URL দিলে Shopify নিজে fetch করে। Private/অ্যাক্সেস-অযোগ্য URL হলে Shopify verbatim error দেবে, push ব্যর্থ হিসেবে listing-এ থাকবে।
- **Shopify variant SKU অবস্থান:** variant input-এর top level-এ `sku` রাখা হয়েছে; live 2025-10-এ `ProductVariantSetInput.sku` কাজ না করলে `inventoryItem.sku`-তে সরাতে হতে পারে — M30/EC12 live যাচাইয়ের তালিকায়।
- **Shopify token refresh নিয়মে সামান্য পার্থক্য:** adapter-এ `tokenExpiresAt` না থাকলেও client-credentials integration-এ একবার exchange চেষ্টা হয়; ShopifyService null expiry-কে non-expiring ধরে। আচরণ দুই জায়গাতেই সফল পথে একই token ব্যবহার করে; পার্থক্য শুধু অপ্রয়োজনীয় exchange call-এ হতে পারে।
- **Woo `/products/batch`:** client helper + variations batch বাস্তবে ব্যবহৃত; multi-product batch push করা হয়নি — bulk edit per-product outbox row তৈরি করে (প্রতিটি read-back যাচাইসহ)। বড় bulk-এ এটি ধীর হতে পারে; EC12 scale কাজে batch-row অপ্টিমাইজেশন তোলা যাবে।
- **Conflict granularity:** entity-স্তরে (field "product", পুরো snapshot local/remote Value-তে থাকে) — field-level আলাদা conflict row হয়নি; UI দুই snapshot পাশাপাশি দেখায়।
- **Oversell:** stockDiverged শুধু সংকেত; absolute-set push race কমায় কিন্তু শূন্য-race কোনো প্ল্যাটফর্মই দেয় না (প্ল্যান §২ সিদ্ধান্ত ৫ অনুযায়ী UI-তে লেখা আছে)।
- `ProductTagAssignment`-এ timestamps নেই (join table হিসেবে ইচ্ছাকৃত)।
