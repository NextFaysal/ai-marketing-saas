# TD Batch TB5 — Acceptance (TD11 Slug Tombstone + TD12 লাইভ যাচাই Checklist + Package Summary)

তারিখ: 2026-10-16 · Worktree: `~/workspace/ai-marketing-saas-td`, branch `tenant-domain`, base `f4b8818` (TB1–TB4 complete, tree clean)।
সূত্র পরিকল্পনা: `Tenant-Domain-Plan-2026-10-15.md` §৪ Batch TB5। Local commits only — কোনো push হয়নি।
এই batch দিয়েই **TD প্যাকেজের কোড অংশ শেষ** — বাকি সব লাইভ/মালিক-ধাপ (TD12)।

## Inventory — org hard-delete-এর আসল পথ (পড়ে যাচাই করা)

API জুড়ে `organization.delete` খোঁজে পাওয়া গেছে **ঠিক একটাই** আসল hard-delete পথ:

| পথ | অবস্থা |
|---|---|
| `AdminService.deleteOrgPermanent` (`POST /admin/orgs/:id/delete-permanent`, `@AdminTier("SUPER")`) | **একমাত্র hard delete।** পূর্বশর্ত: org আগে থেকে `DELETED` soft status-এ থাকতে হয় + org-এর হুবহু নাম টাইপ + কারণ বাধ্যতামূলক। বহু-ধাপের defensive delete (শিশু সারি → org-keyed টেবিল → audit/membership/profile → org নিজে), তারপর platform audit-এ certificate। **Tombstone এখানেই বসে।** |
| Tenant-পাশে org delete | **নেই।** `OrganizationsService`-তে কোনো org-delete endpoint নেই — সেখানে মোছা বলতে শুধু সদস্য সরানো (membership সারি মোছে, org নয়)। তাই tenant পথে tombstone বসানোর প্রশ্নই ওঠে না। |
| Soft-delete (`setOrgStatus` / `bulkOrgStatus` → status `DELETED`) | Tombstone **বসে না** — ইচ্ছাকৃতভাবে: org সারিটা থেকেই যায়, slug তখনো ওই org-এরই দখলে (availability-তে "taken")। Tombstone শুধু চূড়ান্ত মোছায়, যেখানে নামটা সত্যিই মুক্ত হয়ে যায়। Spec দিয়ে এই আচরণ প্রমাণিত (নিচে)। |

## TD11 — যা বানানো হলো

### Commit `5af5f9c` — মডেল + migration
- **Migration claim যাচাই:** tree-তে `ls` করে নিশ্চিত — সর্বশেষ migration `20261016100000`, মোট **194**টি ফোল্ডার; `20261018*` সম্পূর্ণ ফাঁকা (প্ল্যানের নোট অনুযায়ী `20261017000000` অন্য লাইনের দখলে — এই tree-তেও ওই prefix-এ কিছু নেই, তবে প্ল্যানের claim-ই মেনে `20261018000000` নেওয়া হয়েছে)। Claim: **`20261018000000_td11_slug_tombstone`**।
- `SlugTombstone` মডেল (`packages/db/prisma/schema.prisma`): `id` (cuid), `slug @unique`, `deletedOrgName?`, `deletedAt` (default now), `expiresAt`, `releasedAt?`, `releasedById?`, `createdAt`; `@@index([expiresAt])`। হাতে লেখা migration repo-র বিদ্যমান ধাঁচে (CreateTable + unique index + index)।

### Commit `dd20afc` — API (tombstone লেখা + cooldown + release)
- **Delete পথে লেখা:** `deleteOrgPermanent`-এ org সারি মোছার **ঠিক পরেই** upsert — slug, deletedOrgName, deletedAt=এখন, expiresAt=এখন+**180 দিন** (`SLUG_TOMBSTONE_COOLDOWN_DAYS`, `common/slug-availability.ts`-এ এক জায়গায়)। এই delete পথটা নকশাগতভাবেই একটা transaction নয় (defensive বহু-ধাপ), তাই tombstone ব্যর্থ হলে মোছা আটকায় না বা ভান করে না — **return-এ `slugTombstoneWritten: true/false` + audit certificate-এর metadata-তেও একই পতাকা**; অপারেটর দেখতে পাবে cooldown বসেনি। Spec-এ ব্যর্থতা-injection দিয়েও এই সৎ আচরণ প্রমাণিত।
- **Availability-তে cooldown:** TB1-এর একটাই সিদ্ধান্ত ফাংশন `slugAvailability` এখন taken যাচাইয়ের পর tombstone দেখে — unreleased + মেয়াদের ভেতরের সারি থাকলে reason **`"cooldown"`** ("reserved" থেকে আলাদা), বার্তা বাংলায় মুক্তির **আসল তারিখসহ**: "এই নামটি সম্প্রতি মুছে ফেলা একটি দোকানের ছিল — … {তারিখ} পর্যন্ত নামটি নেওয়া যাবে না।" ফলে `GET /organizations/slug-available` ও `create()` দুটোতেই একই আচরণ — create cooldown-এ `BadRequestException` (ওই বার্তাসহ; "taken"-এর Conflict থেকে আলাদা)। মেয়াদোত্তীর্ণ/released সারি ইতিহাস হিসেবে থেকে গেলেও **বাধা হয় না** (spec-প্রমাণিত)। টেবিল না থাকা (পুরনো fake/client) = "tombstone নেই" — defensive optional chaining, কোনো ভাঙন নয়।
- **SUPER মুক্তি:** `POST /admin/slug-tombstones/:slug/release` (`@AdminTier("SUPER")`, class-level `SuperAdminGuard`-এর আওতায়) + `GET /admin/slug-tombstones` তালিকা (computed `active` পতাকাসহ)। Service `releaseSlugTombstone`: note `requireReason` দিয়ে **বাধ্যতামূলক** (না দিলে/খালি হলে BadRequest), অজানা slug → 404, আগেই released → BadRequest, মেয়াদ শেষ হয়ে গেলে → BadRequest ("release দরকার নেই"); সফল হলে `releasedAt`/`releasedById` বসে, সারি ইতিহাস হিসেবে থাকে, audit `admin.slug_tombstone_released` (metadata-তে slug + note + expiresAt)।
- **Spec `apps/api/src/admin/td11-slug-tombstone.spec.ts` — 13/13:** delete-এ tombstone তৈরি (180 দিনের span-সহ) + return/audit পতাকা; soft status বদলে tombstone **হয় না**; tombstone-ব্যর্থতায় সৎ false; cooldown reason + তারিখসহ বার্তা (endpoint পথে); create প্রত্যাখ্যান; মেয়াদোত্তীর্ণে অনুমতি; released-এ অনুমতি; note ছাড়া release ব্যর্থ; release-এর পর নাম মুক্ত + audit; অজানা/দ্বিতীয়/মেয়াদোত্তীর্ণ release-এর ত্রুটি; তালিকার active/history পতাকা; route-এ `@AdminTier(SUPER)` metadata; **guard স্তরে অ-SUPER (SUPPORT) → ForbiddenException, SUPER → পাস**।

### Commit `32c1dfb` — Admin UI (সহজ জায়গা পাওয়া গেছে)
- Admin Orgs তালিকা পর্দা (`apps/admin/src/app/orgs/page.tsx`) এমনিতেই org-জীবনচক্রের জায়গা — সেখানে **Slug Cooldown কার্ড** যোগ হয়েছে: তালিকা (slug — `.qosprey.com` ইঙ্গিতসহ, মোছা দোকানের নাম, মোছার তারিখ, cooldown শেষের তারিখ, অবস্থা ব্যাজ), active সারিতে "মুক্ত করুন" বোতাম — note নেওয়া পেজের বিদ্যমান bulk-action ধাঁচেই `window.prompt` দিয়ে (৩ অক্ষরের কম হলে পাঠায় না; সার্ভারের ত্রুটি verbatim দেখায়)। Tombstone না থাকলে/লোড না হলে কার্ড দেখায় না। Endpoint+spec-এর বাইরে এই UI-টুকু বাড়তি — সিদ্ধান্তটা এখানে নথিভুক্ত থাকল।
- Admin tsc পরিষ্কার, `next build` সবুজ (নিচের গেট)।

### Commit `646aede` — TD12 checklist (শুধু নথি)
- `docs/td-live-verification-checklist.md` — **S1–S9**, মোট **৬৮টি আইটেম, সব UNCHECKED** (যাচাই করে দেখা: `[x]` শূন্য)। প্রতি আইটেমে কী প্রমাণ লাগবে লেখা: S1 wildcard রানবুকের ধাপ + ৫ probe; S2 আসল org subdomain-এ দোকান/পণ্য/কার্ট/চেকআউট; S3 reserved প্রত্যাখ্যান (dashboard/fake/orgnail + substring) + API-ফাঁকি যাচাই + **TD11 cooldown ও SUPER মুক্তির লাইভ প্রমাণ** (throwaway org দিয়ে); S4 TD5 redirect (token-সহ accept-invite); S5 আসল স্পেয়ার ডোমেইনে custom domain যাত্রা + www রূপ + **ডোমেইন-বদলে রিসেট প্রমাণ** (TB4-এর বাগের লাইভ পরীক্ষা); S6 CfS টেস্ট-ম্যাট্রিক্স (origin leg, Full Strict-সহ) + SSL সাফল্যের মাপকাঠি; S7 canonical/sitemap/robots + /shop 301; S8 আসল DB-তে existing-slug audit script + রিপোর্ট; S9 screenshot QA (picker, domain settings, address card, cooldown কার্ড, মোবাইল)।

### Commit `7be000b` — Package summary
- `docs/tenant-domain-package-summary.md` — TD1–TD12 আইটেমভিত্তিক সারণি (batch + commit নির্দেশসহ), পুরো প্যাকেজের NOT BUILT তালিকা (১২টি), লাইভ-বাকি তালিকা, D1/D2/D3 সিদ্ধান্তের অবস্থা (D1 অমীমাংসিত — gating বসানো হয়নি; D2 গৃহীত আচরণে; D3 মালিকের কাছে বাকি), migration ও গেট সারাংশ।

## গেট (সব serially চালানো)

| গেট | ফলাফল |
|---|---|
| TD11 spec (solo) | **13/13 পাস** |
| সংশ্লিষ্ট API suites (`organizations + admin + common + storefront`) | **58 suites, 601/601 পাস** (td11, td1, td9, m40, cors-origins, custom-domain সহ; jest-এর worker-exit সতর্কতা ছাড়া কোনো ব্যর্থতা নেই) |
| Prisma validate | Schema valid (শুধু validate-এর জন্য placeholder `DATABASE_URL`; কোনো DB সংযোগ নয়) |
| Prisma generate | ⚠️ **এই sandbox-এ ব্যর্থ — schema-জনিত নয়:** proxy `binaries.prisma.sh` থেকে engine download আটকে দেয় (403)। Validation পাস করেছে এবং migrate deploy নিচে সম্পূর্ণ চলেছে (CLI-র migration engine উপস্থিত ছিল)। API কোড `slugTombstone`-এ `(prisma as any)` + defensive optional chaining দিয়ে পৌঁছায় বলে tsc/build এই client-এর ওপর নির্ভর করেনি; deploy-এর Docker build-এ generate স্বাভাবিক ধারায় চলবে — তবে এই batch-এ sandbox থেকে generate-এর প্রমাণ দেওয়া গেল না, সৎভাবে নথিভুক্ত থাকল। |
| Fresh-PG পুরো migration sequence | **195/195 প্রয়োগ** — scratch PostgreSQL 16 cluster (`/tmp`-তে initdb, port 55433, গেট শেষে মুছে ফেলা হয়েছে) + `prisma migrate deploy`; আগের 194 + নতুন `20261018000000_td11_slug_tombstone`। `\d "SlugTombstone"`-এ কলাম হুবহু যাচাই (slug অনন্য index-সহ)। |
| API tsc (`--noEmit`) | পরিষ্কার (exit 0) |
| API build | সবুজ (exit 0); compiled dist grep: `admin.service.js`-এ slugTombstone/release ×13, `admin.controller.js`-এ ×5, `slug-availability.js`-এ `cooldown` ×5 |
| Admin tsc + build | দুটোই সবুজ (exit 0) — Orgs পর্দা cooldown কার্ডসহ compile হয়েছে |
| Web (apps/web) | এই batch-এ **ছোঁয়া হয়নি** — brief অনুযায়ী web গেট প্রযোজ্য নয়; ছোঁয়া হয়েছে admin অ্যাপ, তার গেট ওপরে |

## NOT BUILT (এই batch-এ সচেতনভাবে বানানো হয়নি)

- **লাইভ কোনো কিছু** — TD12-র ৬৮ আইটেমের একটাও চালানো হয়নি; wildcard ops, CfS enable, আসল ডোমেইন, আসল DB অডিট — সব TD12/মালিক-ধাপ।
- **Tombstone-এর transaction-গ্যারান্টি** — delete পথের নকশা অনুযায়ী tombstone post-delete best-effort; ব্যর্থতা লুকানো হয় না (return + audit পতাকা), কিন্তু স্বয়ংক্রিয় পুনঃচেষ্টা (retry/sweep) বানানো হয়নি। হারিয়ে যাওয়া tombstone হাতে বানানোর admin পথও নেই — জানা সীমা।
- **মেয়াদোত্তীর্ণ tombstone সারি পরিষ্কারের job** — সারিগুলো ইতিহাস হিসেবে থেকে যায় (availability-তে বাধা নয়); পরিষ্কার করার sweep এই প্যাকেজে নেই।
- **Tenant-পাশে tombstone দৃশ্যমানতা** — tenant শুধু cooldown বার্তাটাই দেখে (picker/create-এ); tombstone তালিকা শুধু admin-এ। নকশাগত সিদ্ধান্ত।
- **TB1–TB4 থেকে বয়ে আসা NOT BUILT** (package summary-তে একত্রিত): Cloudflare API integration, CfS-মুখী UI নির্দেশ হালনাগাদ, branded shop 404, custom-target 301, root robots/sitemap shop হোস্টে, reserved-slug admin UI, ask endpoint-এর ভোক্তা।

## সৎ সীমানা

- এই batch-এর সব প্রমাণ spec/fresh-PG/build স্তরের। লাইভে TD-র **কোনো** ফিচারই এখনো প্রমাণিত নয় — TD12 checklist-ই তার একমাত্র পথ, সব বাক্স ফাঁকা।
- Cooldown-এর ঘড়ি সার্ভারের `Date.now()` — মেয়াদ যাচাই প্রতিটা availability অনুরোধে তাজা হয়, কোনো cron লাগে না।
- Push হয়নি; deploy মালিকের নির্দেশে।
