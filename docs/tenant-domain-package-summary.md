# Tenant Domain প্যাকেজ — TD1–TD12 Package Summary

তারিখ: 2026-10-16 · Worktree: `~/workspace/ai-marketing-saas-td`, branch `tenant-domain`, base `cf3efd5` (GitHub main)।
সূত্র পরিকল্পনা: `~/workspace/goals/ai-marketing-saas-platform-build/files/Tenant-Domain-Plan-2026-10-15.md` (মালিকের অনুমোদন 2026-10-15, পুরো প্যাকেজ)।
ব্যাচ acceptance: `docs/td-tb1-acceptance.md` … `docs/td-tb5-acceptance.md` · লাইভ যাচাই: `docs/td-live-verification-checklist.md` (TD12, সব UNCHECKED)।
**Local commits only — কোনো push হয়নি। লাইভে কিছুই চালু হয়নি; সব লাইভ প্রমাণ TD12-তে বাকি।**

## ঠিকানা-মডেল (প্যাকেজ যা প্রতিষ্ঠা করল)

| ঠিকানা | কী চলে |
|---|---|
| `{slug}.qosprey.com` | ওই Organization-এর পাবলিক দোকান (middleware rewrite → `/shop/{slug}`) |
| যাচাই করা custom domain (+ www রূপ) | একই দোকান, নিজের ডোমেইনে |
| `app.qosprey.com` | **একমাত্র** staff প্যানেল/লগইন — shop হোস্টে প্যানেল পথ 308 redirect হয়ে এখানে আসে |
| `qosprey.com` / `www` / `admin` / `api` / `media` | প্ল্যাটফর্ম — অপরিবর্তিত |

## আইটেমভিত্তিক সারণি (TD1–TD12)

| আইটেম | যা হলো | Batch | Commit | অবস্থা |
|---|---|---|---|---|
| **TD1** Reserved slug ব্যবস্থা | Contracts-এ কেন্দ্রীয় নিয়ম: strict format + ৩ শ্রেণির reserved তালিকা (system / misleading / future) + `admin/support/official` শব্দাংশ-নিয়ম + SUPER-যোগ করা `reservedSlugsExtra` settings; সার্ভারে `OrganizationsService.create`-এ একটাই `slugAvailability` সিদ্ধান্ত প্রয়োগ; বিদ্যমান-slug অডিট script (read-only) | TB1 | `3f9fddd`, `faed25f`, `14969ad` | ✅ বানানো (লাইভ DB অডিট TD12 S8-তে বাকি) |
| **TD2** Subdomain বাছাই UI | `GET /organizations/slug-available` (create-এর হুবহু একই ফাংশন) + onboarding picker: প্রস্তাবিত slug, `.qosprey.com` suffix, debounce লাইভ যাচাই, available না হলে submit বন্ধ; ধাপ-২ ব্যানারে ঠিকানা + "বদলানো যাবে না" সতর্কতা | TB1 | `faed25f`, `f9b8e17` | ✅ বানানো |
| **TD3** Wildcard DNS/SSL/routing | **শুধু রানবুক** (`docs/td-tb2-wildcard-runbook.md`): Cloudflare wildcard A (proxied), edge Universal এক-স্তর + Full (Strict) যাচাই, origin wildcard (Origin CA / ACME DNS-01), Dokploy wildcard domain বা Traefik HostRegexp বিকল্প, ৫ probe, rollback | TB2 | `7bdfe9b` | 📄 নথি — **কোনো ধাপ চালানো হয়নি (মালিকের প্যানেল ধাপ)** |
| **TD4** Host শ্রেণিবিভাগ | `classifyHost`: platform \| shop-subdomain \| shop-custom-candidate \| unknown — contracts নিয়ম পুনঃব্যবহার; subdomain শাখা DB lookup ছাড়াই নির্ধারিত; বহু-স্তর = unknown (v1 সিদ্ধান্ত); middleware পুনর্গঠন (EC8 verified-custom lookup অক্ষত, fail-open, 60s cache) | TB2 | `a8ae1ff`, `d105deb` | ✅ বানানো (spec 18/18 + 7/7) |
| **TD5** Surface পৃথকীকরণ | Shop হোস্টে (subdomain + VERIFIED custom) প্যানেল পথ (dashboard/login/register/onboarding/accept-invite + subpath) rewrite-এর আগে **308** → `https://app.qosprey.com` + পথ + query অক্ষত; unverified হোস্টে কিছুই নয় | TB2 | `a8ae1ff`, `d105deb` | ✅ বানানো |
| **TD6** API CORS pattern | `common/cors-origins.ts`: no-origin allow, ঠিক `WEB_URL`/`ADMIN_URL`, apex + ঠিক এক স্তরের বৈধ label (কঠোর anchored — evilqosprey / qosprey.com.evil.com / বহু-স্তর / খারাপ label সব অস্বীকৃত), http শুধু localhost, verified custom domain (EC8 শর্ত, 60s cache, fail-closed); কখনো `"*"` নয়; `main.ts` app-এর নিজের PrismaService ধার করে | TB3 | `db02834` | ✅ বানানো (spec 19/19) |
| **TD7** Canonical ও SEO | `canonicalShopBase` (verified custom, নইলে subdomain) → home/product metadata, JSON-LD, sitemap, robots সব canonical হোস্টে; platform হোস্টে `/shop/{slug}` → subdomain-এ **301** (loop-প্রমাণ spec-সহ)। সিদ্ধান্ত: 301-এর লক্ষ্য v1-এ সবসময় subdomain | TB3 | `8f71fe5`, `0e9b370`, `25ebd24` | ✅ বানানো |
| **TD8** ঠিকানা প্রদর্শন | Storefront settings-এ "আপনার দোকানের ঠিকানা" কার্ড (subdomain কপি/খুলুন, custom domain + আসল যাচাই অবস্থা, canonical ব্যাজ, প্যানেল-নোট); dashboard হোমে "দোকান দেখুন" quick action; ShopHeader-এ "দোকান পরিচালনা করুন" → app.qosprey.com (TB2 carry-over) | TB3 | `245efd5` | ✅ বানানো |
| **TD9** Custom domain এক জায়গায় | একটাই লেখার পথ `StorefrontService.setCustomDomain` + `POST …/storefront/domain/set` (OWNER/ADMIN); **আসল বাগ সংশোধন:** ডোমেইন বদলালে/সরালে যাচাই টোকেন+verifiedAt রিসেট — দুই লেখার পথেই (set + branding); প্ল্যাটফর্ম ডোমেইন প্রত্যাখ্যান; www↔apex মিল একটাই shared নিয়মে (byDomain + CORS দুটোতেই); web-এ একটাই "নিজের ডোমেইন" ৫-ধাপ বিভাগ, branding কার্ড থেকে field অপসারণ | TB4 | `6fd43a5`, `5de757c`, `7bc3e0d`, `d4b9554`, `ac117d5`, `1b6d2ed`, `908fbae` | ✅ বানানো (API spec 39 + td9 সারণি) |
| **TD10** Custom-domain SSL | **Spike + রায়:** Traefik-এ on-demand/ask TLS নেই (প্ল্যানের ধারণা ভুল ছিল); রায় = **Cloudflare for SaaS** (প্রথম 100 hostname অন্তর্ভুক্ত, তারপর ~$0.10/নাম/মাস) — শর্ত: origin-leg লাইভ টেস্টে Full (Strict) চলা। অ্যাপ-পার্শ্ব: `GET /public/shop/domain-allowed` ask/probe endpoint (বর্তমান পথে কোনো ভোক্তা নেই — তৈরি seam); UI-তে সৎ SSL অবস্থা সারি; রানবুক `docs/td-tb4-ssl-runbook.md` | TB4 | `737d713`, `80e1f95`, `b9a7dc4` | 🟡 **আংশিক** — রায় + seam + রানবুক বানানো; **লাইভ SSL প্রমাণ ও Cloudflare API integration বানানো হয়নি** (মালিকের enable+token ধাপের পরের follow-up) |
| **TD11** Slug tombstone | `SlugTombstone` মডেল + migration `20261018000000`; একমাত্র hard-delete পথে (`AdminService.deleteOrgPermanent`) org মোছার ঠিক পরেই 180 দিনের tombstone (ব্যর্থতা return+audit-এ সৎভাবে রিপোর্ট হয়); soft-delete status পথে tombstone **নয়**; `slugAvailability`-তে আলাদা **cooldown** reason (মুক্তির তারিখসহ বাংলা বার্তা) — endpoint ও create একই আচরণ; SUPER release endpoint `POST /admin/slug-tombstones/:slug/release` (note বাধ্যতামূলক, audit) + তালিকা endpoint + admin Orgs পর্দায় কার্ড | TB5 | `5af5f9c`, `dd20afc`, `32c1dfb` | ✅ বানানো (spec 13/13; লাইভ প্রমাণ TD12 S3-তে) |
| **TD12** লাইভ যাচাই | `docs/td-live-verification-checklist.md` — S1–S9 session, ৬৮টি আইটেম, প্রতি আইটেমে প্রয়োজনীয় প্রমাণ লেখা | TB5 | `646aede` | 📄 নথি — **সব UNCHECKED** |

## পুরো প্যাকেজের NOT BUILT তালিকা

কোড/নথিতে সচেতনভাবে বানানো হয়নি — কোনোটাই ভুলে যাওয়া নয়:

1. **Wildcard-এর কোনো লাইভ ধাপ** — DNS রেকর্ড, সার্টিফিকেট ইস্যু, Dokploy/Traefik routing: সব TD3 রানবুকের মালিক-ধাপ; `{slug}.qosprey.com` এখনো লাইভে resolve হয় না।
2. **Cloudflare API integration** — verified হলে স্বয়ংক্রিয় custom hostname create/status/delete। পূর্বশর্ত মালিকের CfS enable + zone-সীমিত API token (verify-before-save ধাঁচে মালিক বসাবেন; অ্যাপে সেই settings-এর জায়গা এখন নেই)।
3. **TD9 UI-এর CfS-মুখী নির্দেশনা হালনাগাদ** — CfS টেস্ট পাসের আগে বদলালে চালু manual পথের নির্দেশ ভাঙত; রানবুক ধাপ ৪-এ করণীয় তালিকা আছে।
4. **লাইভ SSL প্রমাণ (TD10-এর সাফল্যের মাপকাঠি)** — নতুন verified ডোমেইন হাত ছাড়া HTTPS-এ চলা TD12 S6 ছাড়া দাবি করা হবে না।
5. **Branded shop 404** — প্ল্যানে GB1-এর বলে ধরা ছিল, কিন্তু এই tree-তে GB1 storefront completion নেই; অস্তিত্বহীন দোকানে Next-এর ডিফল্ট 404-ই পড়ে (TB2-তে নথিভুক্ত প্ল্যান-বনাম-কোড অমিল)।
6. **Custom-target 301** — TD7 সিদ্ধান্তে /shop থেকে redirect সবসময় subdomain-এ; custom domain canonical শুধু metadata/sitemap/JSON-LD-তে।
7. **Shop হোস্টের root-এ robots/sitemap সার্ভ** — EC8 middleware-এর file-exception অপরিবর্তিত; per-shop robots/sitemap তাদের `/shop/{slug}/…` পথেই থাকে (বিষয়বস্তু canonical-মুখী)।
8. **Reserved-slug admin UI** — `reservedSlugsExtra` **পড়া** পর্যন্ত বানানো (TB1); SUPER-এর জন্য নাম যোগ/তালিকা দেখার UI বানানো হয়নি।
9. **Ask endpoint-এর ভোক্তা** — `GET /public/shop/domain-allowed` কোনো লাইভ পথে ব্যবহৃত হয় না (TD10 অংশে সৎ অবস্থান)।
10. **Branding পথে www-variant conflict যাচাই** — সেখানে conflict আগের exact-match-ই (নথিভুক্ত সচেতন অসাম্য; UI থেকে ওই পথ অব্যবহৃত, একমাত্র লেখার জায়গা storefront বিভাগ)।
11. **Slug rename** — D2: v1-এ অপরিবর্তনীয় (নিচে সিদ্ধান্তের অবস্থা)।
12. **`app.{custom-domain}` প্যানেল, এক org-এ একাধিক দোকান, sub-subdomain, tenant ইমেইল** — প্ল্যান §৫-এর সীমানা অনুযায়ী প্যাকেজের বাইরে।

## লাইভ-বাকি তালিকা (TD12)

- [ ] S1 wildcard রানবুকের ধাপ + ৫ probe
- [ ] S2 আসল org subdomain-এ দোকান/পণ্য/কার্ট/চেকআউট
- [ ] S3 reserved প্রত্যাখ্যান + TD11 cooldown ও SUPER মুক্তির লাইভ প্রমাণ
- [ ] S4 TD5 redirect (token-সহ accept-invite)
- [ ] S5 আসল স্পেয়ার ডোমেইন দিয়ে custom domain যাত্রা + www + রিসেট প্রমাণ
- [ ] S6 Cloudflare for SaaS টেস্ট-ম্যাট্রিক্স (origin leg, Full Strict) + SSL সাফল্যের মাপকাঠি
- [ ] S7 canonical/sitemap/robots + /shop 301
- [ ] S8 আসল DB-তে existing-slug audit script + রিপোর্ট
- [ ] S9 screenshot QA (picker, domain settings, address card, cooldown কার্ড, মোবাইল)

মোট ৬৮টি আইটেম — বিস্তারিত `docs/td-live-verification-checklist.md`-তে।

## মালিক-সিদ্ধান্তের অবস্থা (প্ল্যান §৬)

| সিদ্ধান্ত | অবস্থা |
|---|---|
| **D1** Custom domain কোন প্ল্যানে gating হবে | **অমীমাংসিত** — প্ল্যানের নির্দেশ মেনে কোনো gating বসানো হয়নি (সবার জন্য খোলা)। সিদ্ধান্ত এলে plan/flag যাচাই এক জায়গায় বসবে (setCustomDomain পথে)। |
| **D2** Slug অপরিবর্তনীয় (v1) | **গৃহীত আচরণে** — rename-এর কোনো পথ বানানো হয়নি; UI-তে অপরিবর্তনীয়তার সতর্কতাই আছে। |
| **D3** লাইভ টেস্টের আসল স্পেয়ার ডোমেইন | **মালিকের কাছে বাকি** — এটি ছাড়া TD12-র S5/S6 চলবে না; বাকি session চলতে পারে। |

## Migration ও গেট সারাংশ

- **Migration: পুরো প্যাকেজে ঠিক ১টি** — `20261018000000_td11_slug_tombstone` (claim যাচাই: `20261017000000` অন্য লাইনের দখলে বলে এই tree-তে ফাঁকা `20261018xxxxxx`-ই নেওয়া হয়েছে)। TB5-এ fresh-PG পুরো sequence যাচাই: **195/195 প্রয়োগ** (আগের 194 + নতুন 1), SlugTombstone টেবিল হুবহু।
- Batch গেট (বিস্তারিত নিজ নিজ acceptance-এ): TB1 — contracts 15/15, org suites 78/78, web 449/449, API পূর্ণ suite chunk পদ্ধতিতে হিসাব মেলানো (2টি pre-existing ব্যর্থতা নথিভুক্ত); TB2 — web 467/467 + compiled-middleware grep প্রমাণ; TB3 — API 34 suites 305/305, web 479/479; TB4 — API 37 suites 372/372, web 479/479; TB5 — TD11 spec 13/13, সংশ্লিষ্ট API suites 58 suites 601/601, fresh-PG 195/195, api tsc+build, admin tsc+build।
- **Push হয়নি** — মালিকের আলাদা নির্দেশ ছাড়া হবে না; push-এর আগে যথারীতি ls-remote + fetch।
