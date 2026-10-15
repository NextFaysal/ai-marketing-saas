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

_(বাস্তবায়নের সাথে সাথে পূরণ হবে — TD6 / TD7 / TD8 আলাদা অংশে, commit hash-সহ।)_

## গেট (সব serially চালানো)

_(চালানোর সাথে সাথে ফলাফল লেখা হবে।)_

## NOT BUILT (সচেতনভাবে বানানো হয়নি)

_(শেষে চূড়ান্ত তালিকা।)_
