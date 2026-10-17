# TD Batch TB3 — Acceptance (TD6 API CORS + TD7 Canonical + TD8 ঠিকানা প্রদর্শন)

তারিখ: 2026-10-16 · Worktree: `~/workspace/ai-marketing-saas-td`, branch `tenant-domain`, base `7132942` (TB1+TB2 complete, tree clean)।
সূত্র পরিকল্পনা: `Tenant-Domain-Plan-2026-10-15.md` §৪ Batch TB3। এই batch-এ কোনো migration নেই। Local commits only — কোনো push হয়নি।
(পুনঃপ্রেরিত coordinator — আগের coordinator daemon restart-এ কাজ শুরুর আগেই মারা গিয়েছিল; worktree যাচাই করা হয়েছে: HEAD `7132942`, tree সম্পূর্ণ পরিষ্কার, TB3-এর কিছুই আগে হয়নি।)

## Inventory — এই tree-তে shop SEO/canonical-এর আসল অবস্থা (পড়ে যাচাই করা)

| বিষয় | অবস্থা (প্রমাণ) |
|---|---|
| Shop sitemap | **আছে** — `apps/web/src/app/shop/[orgSlug]/sitemap.ts`: home + সব ACTIVE product (API থেকে paging, pageSize 60, সর্বোচ্চ 200 page), product-এর আসল `updatedAt` lastmod (EC27)। কিন্তু URL তৈরি হয় `sitemapUrlBase()` = `NEXT_PUBLIC_WEB_URL` (না থাকলে path-only) দিয়ে **`/shop/{slug}` পথে** — canonical হোস্টে (subdomain/custom) নয়। |
| Shop robots | **আছে** — `apps/web/src/app/shop/[orgSlug]/robots.txt/route.ts` (EC27): Allow/Disallow `/shop/{slug}` পথ ধরে; Sitemap লাইন `base + /shop/{slug}/sitemap.xml` (base = `NEXT_PUBLIC_WEB_URL`, নইলে অনুরোধের আসল origin)। |
| Shop home metadata | **আছে** — `shop/[orgSlug]/page.tsx`-এর `generateMetadata`: title/description + `alternates.canonical` + OG url — দুটোই `canonicalShopUrl(sitemapUrlBase(), orgSlug)` = web URL-এর `/shop/{slug}` পথ। |
| Product metadata | **আছে** — `shop/[orgSlug]/products/[productSlug]/page.tsx`-এর `generateMetadata`: একই ধাঁচে canonical + OG url, সাথে SEO title/description। |
| JSON-LD | **আছে** — home-এ Organization+WebSite (`buildShopJsonLd`), product-এ Product+Offer (`buildProductJsonLd`, reviews না থাকলে aggregateRating পুরোপুরি বাদ — EC27)। দুটোর URL-ই একই `/shop/{slug}` canonical helper থেকে। |
| Canonical base-এর ডেটা | **আছে** — shop home API payload-এ (`fetchShopHome` → `ShopHome.organization`): `customDomain: string \| null` + `domainVerified: boolean` (EC8 byDomain-এর একই যাচাই অবস্থা)। অর্থাৎ TD7-এর নিয়ম (verified custom → সেটাই base, নইলে subdomain) বাস্তবায়নে নতুন API লাগে না। Product detail payload-এর `organization`-এ এই দুই ফিল্ড **নেই** — product JSON-LD-র canonical base পেতে home payload ব্যবহার করতে হয় (দুটোই React `cache()` করা, একই request-এ দ্বিতীয় ডাক dedupe হয়)। |
| Canonical 301 | **নেই** — middleware (TB2) `/shop/` দিয়ে শুরু হওয়া পথ সবার আগে `NextResponse.next()` দিয়ে ছেড়ে দেয়; platform হোস্টে `/shop/{slug}`-তে সরাসরি এলেও কোনো redirect হয় না। |
| Layout metadata | shop `layout.tsx`-তে আলাদা canonical/OG metadata **নেই** — metadata শুধু home ও product page-এই (ওপরের সারি দ্রষ্টব্য)। Root `app/layout.tsx`-এর metadata সাধারণ, shop-canonical নয় — এই batch-এ ছোঁয়া হবে না। |
| Branded shop 404 | **নেই** (TB2-তেই নথিভুক্ত অমিল — GB1 এই tree-তে নেই)। এই batch-এর বিষয় নয়। |

## যা বানানো হলো

### TD6 — API CORS pattern
- **Commit `db02834`** — নতুন খাঁটি matcher মডিউল `apps/api/src/common/cors-origins.ts`:
  - `isPlatformOrLocalOrigin()` (কোনো I/O ছাড়া): origin না থাকলে অনুমতি (checker স্তরে); apex `https://qosprey.com` ও ঠিক **এক স্তরের বৈধ label** — label-টি TD1 contracts-এর `SLUG_FORMAT_REGEX` মিললেই (app/admin-এর মতো প্ল্যাটফর্ম নাম ও tenant subdomain দুটোই এই এক নিয়মে) — কঠোর anchored যাচাই: hostname ঠিক apex নয়তো `.{apex}` দিয়ে শেষ + মাঝখানে আর কোনো ডট নয়। ফলে `evilqosprey.com`, `notqosprey.com`, `qosprey.com.evil.com`, `a.b.qosprey.com`, `-bad-` বা `dhaka_fashion`-এর মতো label সব ব্যর্থ। http শুধু localhost/127.0.0.1 dev origin-এ; `http://app.qosprey.com` অস্বীকৃত।
  - `createCorsOriginChecker(deps)`: ক্রম — (১) Origin header নেই → allow; (২) ঠিক env origin (`WEB_URL`, `ADMIN_URL`; trailing slash সহনীয়); (৩) platform নিয়ম; (৪) অন্য সব হোস্টে **যাচাই করা custom domain** — async lookup seam: `Organization.customDomain` মিল + `StorefrontSetting.domainVerifiedAt` থাকা (EC8 byDomain-এর হুবহু শর্ত), 60 সেকেন্ড in-memory cache (ঘড়ি injectable); lookup **throw করলে ওই origin-এর জন্য fail-closed**, cache-এ ভুল রায় জমে না (পরের অনুরোধে নিজে সেরে ওঠে); callback কখনো throw করে না — বুট/অনুরোধ ভাঙে না। `credentials: true`-র উত্তরে কখনো `"*"` নয় — allow মানে cors middleware অনুরোধের নিজের origin-টাই echo করে।
  - `prismaVerifiedCustomDomainLookup(prisma)`: structural seam-এ ওপরের শর্ত — fake seam দিয়ে spec-প্রমাণিত (verified → true; verifiedAt নেই → false; setting row-ই নেই → false; org-ই নেই → false)।
  - `main.ts`: `enableCors({ origin: <একক WEB_URL string> })` বদলে checker; Prisma পাওয়ার পথ — Nest app তৈরি হওয়ার পর `app.get(PrismaService)` (post-listen platform-config ধাপে ইতিমধ্যে ব্যবহৃত একই পথ) — **নতুন connection pool নয়**; পেতে ব্যর্থ হলে warn লগ + custom-domain origin fail-closed, বুট অক্ষত।
  - **Spec সারণি** `cors-origins.spec.ts` **19/19**: allowed — no-origin, WEB_URL, apex, app, shop subdomain, verified custom (www রূপসহ, fake lookup-এ তালিকাভুক্ত হোস্ট হিসেবে), localhost http; denied — evilqosprey.com, qosprey.com.evil.com, notqosprey.com, বহু-স্তর, খারাপ label ×২, http platform ×৩, unverified custom, অজানা হোস্ট, junk origin (`null`, অ-URL, ftp); + lookup-error fail-closed, TTL cache আচরণ, pure matcher সারণি, Prisma adapter-এর EC8 শর্ত।

### TD7 — Canonical ঠিকানা ও SEO
- **Commit `8f71fe5` (lib)** — `apps/web/src/lib/storefront-seo.ts`-এ `canonicalShopBase(org)`: org-এর `customDomain` থাকলে **এবং** `domainVerified` হলেই `https://<domain>` (normalize: scheme/case/path ছাঁটা), নইলে contracts-এর `shopSubdomainHost(slug)` দিয়ে `https://{slug}.qosprey.com`। `canonicalShopUrlAt(base, productSlug?)` root-form URL (home = base + `/`, product = base + `/products/<slug>`)। JSON-LD builder দুটো (shop/product) ঐচ্ছিক `canonicalBase` পায় — দিলে সেটাই, না দিলে পুরনো path-form আচরণ হুবহু (বিদ্যমান tests অপরিবর্তিত পাস)। `storefront-sitemap.ts`-এ `buildCanonicalShopSitemapEntries(base, products)` — lastmod/dedupe-র অভিন্ন core legacy builder-এর সাথে share করা। Tests: seo 8→**12/12**, sitemap 7→**9/9**।
- **Commit `0e9b370` (pages)** — ডেটা সূত্র inventory অনুযায়ী shop home payload-ই (`home.organization.{customDomain, domainVerified}`), নতুন API নয়:
  - Shop home `generateMetadata`: canonical + OG url এখন canonical host-এর root-form; JSON-LD-তেও একই base।
  - Product page `generateMetadata`: একই; component-এর JSON-LD-র জন্য home payload আলাদা করে ডাকা হয়েছে — product payload-এর `organization`-এ domain ফিল্ড নেই (inventory), আর `fetchShopHome` React `cache()` করা বলে একই request-এ খরচ dedupe হয়। Home payload না পেলে subdomain নিয়মই fallback।
  - `sitemap.ts`: entries এখন canonical host-এ (`buildCanonicalShopSitemapEntries`); home payload না পেলে base = `https://{slug}.qosprey.com` (contracts নিয়ম, বানানো মান নয়)।
  - `robots.txt/route.ts`: home payload থাকলে canonical-host রূপ — `Allow: /`, root-পথে Disallow (cart/checkout/account/success), Sitemap লাইন canonical host-এ এই দোকানের sitemap route-এর দিকে (`{base}/shop/{slug}/sitemap.xml` — route-টি সব হোস্টে ওই পথেই সার্ভ হয়)। Payload না পেলে EC27-এর path-form body **হুবহু আগের মতোই** fallback।
- **Commit `25ebd24` (middleware 301)** — `custom-domain.ts`-এ খাঁটি `canonicalShopRedirectUrl(host, pathname, search)` + middleware-এ wiring:
  - শর্ত: host `platform` শ্রেণির + পথ `/shop/<slug>` বা তার নিচে + slug TD1 local check পাস → `https://{slug}.qosprey.com` + slug-বাদে বাকি পথ + query, **301**।
  - Wiring `/shop/` internals-skip-এর **আগে** (নইলে skip-ই সব গিলে ফেলত) — কিন্তু skip-host যাচাইয়ের পরে।
  - **Loop-প্রমাণ spec দিয়ে:** (ক) helper shop হোস্টে (subdomain/custom-candidate/unknown) সবসময় null — middleware-এর নিজের rewrite target কখনো redirect হয় না; (খ) middleware spec-এ 301 অনুসরণ করে হাতে চালানো: target হোস্ট+পথে অনুরোধ rewrite হয়, redirect নয়; (গ) shop হোস্টে সরাসরি `/shop/<slug>` এলে 200/next — redirect নয়; (ঘ) reserved slug (`/shop/app`, `/shop/fake`) ও slug-হীন পথ redirect হয় না। Lib সারণি 18→**21/21**, middleware সারণি 7→**10/10**।
  - **সিদ্ধান্ত (brief-এর অনুমোদিত পথ):** redirect-এর লক্ষ্য v1-এ **সবসময় tenant subdomain** — verified custom domain canonical শুধু metadata/sitemap/JSON-LD-তে। কারণ: middleware-এ custom লক্ষ্য জানতে প্রতি legacy-path অনুরোধে by-domain lookup লাগত (খরচ + ব্যর্থতার নতুন পথ); subdomain সবসময় সঠিক ও lookup-মুক্ত, আর canonical মেটাডেটা ইতিমধ্যে custom domain-কেই প্রধান বলে — দুটো মিলে SEO সংকেত অসংগত নয় (301 গন্তব্য নিজেই canonical মেটা বহন করে)।

### TD8 — ঠিকানার প্রদর্শন
- **Commit `245efd5`**:
  - **Storefront settings** (`dashboard/commerce/storefront/page.tsx`)-এ নতুন **"আপনার দোকানের ঠিকানা"** কার্ড (Live-shop-link কার্ডের ঠিক পরে): subdomain — contracts `shopSubdomainHost(state.organization.slug)` থেকে `https://…` আকারে, **কপি + খুলুন** বোতাম; custom domain — `state.domain.customDomain` + যাচাই অবস্থা আসল `domain.verifiedAt` থেকে (না থাকলে "সেট করা নেই" সৎ বার্তা); TD7 নিয়মে যেটি প্রধান ঠিকানা তাতে **"প্রধান (canonical) ঠিকানা"** ব্যাজ; নিচে নোট — দুই ঠিকানায় একই দোকান, আর **প্যানেলে লগইন শুধু app.qosprey.com-এ**। পূর্ণ domain-সেটিংস flow (TD9) এই কার্ডে আনা হয়নি — যাচাইয়ের কাজ নিচের বিদ্যমান "কাস্টম ডোমেইন" ধাপেই থাকে, কার্ড সেদিকেই নির্দেশ করে।
  - **Dashboard হোম** (`dashboard/page.tsx`): কোনো shop লিংক ছিল না — hero-র quick actions-এ org payload-এ slug থাকলে **"🛍️ দোকান দেখুন"** লিংক যোগ (নতুন ট্যাবে `https://{slug}.qosprey.com`); হোমের বাকি গঠন অপরিবর্তিত। `OrgLite`-এ `slug` ফিল্ড যোগ (GET /organizations/:id payload-এ আগে থেকেই আছে)।
  - **ShopHeader carry-over (TB2 NOT BUILT থেকে):** nav-এ **"⚙️ দোকান পরিচালনা করুন"** লিংক → `https://app.qosprey.com` (apex contracts ধ্রুবক থেকে; ছোট পর্দায় লুকানো, md+ তে দৃশ্যমান — header-এর ভিড় না বাড়িয়ে)। লেখা shop i18n দিয়ে (`common.manageShop` bn "দোকান পরিচালনা করুন" / en "Manage shop" — দুই অভিধানেই যোগ, i18n parity spec পাস)।

## গেট (সব serially চালানো)

| গেট | ফলাফল |
|---|---|
| API cors spec (solo) | **19/19 পাস** |
| API সংশ্লিষ্ট suites (`common` + `storefront` + `organizations`) | **34 suites, 305/305 পাস** |
| API tsc (`--noEmit`) | পরিষ্কার (exit 0) |
| API build (`tsc -p tsconfig.build.json`) | সবুজ (exit 0); compiled `dist/main.js`-এ `createCorsOriginChecker` wiring grep-প্রমাণিত |
| Web lib/middleware spec (solo রান) | seo 12/12 · sitemap 9/9 · custom-domain 21/21 · middleware 10/10 · shop-i18n+shop-slug 6/6 |
| Web vitest পুরো | **57 ফাইল, 479/479 পাস** (TB2-এর 467 থেকে +12: seo +4, sitemap +2, custom-domain +3, middleware +3) |
| Web tsc (`tsc --noEmit`) | পরিষ্কার (exit 0) |
| Web build (`next build`) | সবুজ (exit 0), `ƒ Middleware` 50.6 kB সহ |
| Compiled middleware প্রমাণ | build bundle `.next/server/src/middleware.js`-এ grep: TD7 শাখা হুবহু — `…(c,b,a.nextUrl.search);if(d)return S.redirect(d,301);if(b.startsWith("/…` (canonical helper ডাক + 301 redirect + তারপরেই /shop skip — wiring-এর ক্রমসহ); পাশাপাশি TD5-এর `,308)` ×১ ও `shop-subdomain` ×২ অক্ষত। ফাংশনের নাম production bundle-এ minify হয়ে যায় (TB2-র মতোই) — string literal ও redirect ডাকই প্রমাণ |

## NOT BUILT (সচেতনভাবে বানানো হয়নি)

- **পূর্ণ domain সেটিংস flow (TD9)** — ডোমেইন বসানো/TXT ধাপ/routing নির্দেশ এক জায়গায় আনা এই batch-এ নয়; TD8 কার্ড শুধু ঠিকানা **দেখায়**, বিদ্যমান EC8 ধাপগুলোর দিকেই পাঠায়।
- **Custom-domain-লক্ষ্য 301** — ওপরে TD7 সিদ্ধান্ত দ্রষ্টব্য: redirect সবসময় subdomain-এ; custom domain canonical শুধু metadata/sitemap/JSON-LD-তে।
- **Root-স্তরের robots/sitemap shop হোস্টে** — EC8 middleware `/robots.txt` ও `/sitemap.xml`-কে file-exception হিসেবে rewrite করে না (TB2 থেকে অপরিবর্তিত); তাই shop হোস্টের root-এ robots সার্ভ হয় না — per-shop robots route তার `/shop/{slug}/robots.txt` পথেই থাকে, যার বিষয়বস্তু এখন canonical-মুখী। Root rewrite বদলানো এই batch-এর scope-এর বাইরে।
- **Sitemap/robots-এর বাইরে অন্য shop পেজের metadata** — cart/checkout/account/success পেজে আগে থেকেই কোনো canonical/OG metadata ছিল না (inventory); transactional পেজে SEO metadata বসানো হয়নি (index করার পেজও নয় — robots-এ Disallow-ই আছে)।
- **API CORS-এ www↔apex custom-domain রূপের স্বয়ংক্রিয় মিল** — lookup EC8 byDomain-এর মতোই **হুবহু host মিল**; `www.dhaka-fashion.com` আলাদা verified হোস্ট হিসেবে তালিকায় থাকলেই শুধু চলবে (spec-এ fake lookup-এ দুই রূপ আলাদা করে দেখানো হয়েছে)। www-মিলনের নিয়ম TD9-এর বিষয়।
- **ADMIN_URL env-এর Dokploy/রানবুক হালনাগাদ** — checker `ADMIN_URL` থাকলে পড়ে, না থাকলে admin origin এমনিতেই `*.qosprey.com` নিয়মে ঢাকা; env বসানো মালিকের deploy ধাপ, এই batch-এ কোনো env ফাইল ছোঁয়া হয়নি।
- **লাইভ যাচাই (TD12)** — wildcard DNS/SSL/Dokploy এখনো মালিকের রানবুক ধাপে বাকি (TB2); ফলে subdomain ঠিকানা, 301 ও CORS-এর কোনোটারই লাইভ দাবি এই acceptance-এ নেই — সব প্রমাণ spec/build স্তরের।
- **TB4–TB5-এর বাকি সব:** TD9, TD10 (custom-domain SSL spike), TD11 (slug tombstone), TD12।

## সৎ সীমানা

- CORS-এর platform নিয়মে label যাচাই **format-only** (reserved যাচাই নয়) — সচেতন সিদ্ধান্ত: `admin`/`api`-এর মতো প্ল্যাটফর্মের নিজের সার্ভিস origin-গুলোও বৈধ CORS origin, আর reserved নামে দোকান হতেই পারে না (TD1), তাই কোনো দোকান এই নিয়মে অতিরিক্ত সুবিধা পায় না। কোনো origin-এর উত্তরে `*` কখনো যায় না।
- Canonical base-এর verified শর্তের ডেটা shop home API payload থেকেই আসে — API যা বলে তাই; web নিজে DNS/DB যাচাই করে না। Payload-এ `domainVerified` EC8-এর `domainVerifiedAt` থেকেই তৈরি (API স্তরে যাচাই করা শর্ত)।
- 301 স্থায়ী redirect — ব্রাউজার/সার্চ ইঞ্জিন ক্যাশ করে; ভবিষ্যতে canonical নীতি বদলালে পুরনো 301-এর প্রভাব থেকে যাবে — v1-এর সিদ্ধান্ত হিসেবে সচেতনভাবে নেওয়া (subdomain নীতি TD প্ল্যানে স্থির)।
- Push হয়নি; deploy মালিকের নির্দেশে।
