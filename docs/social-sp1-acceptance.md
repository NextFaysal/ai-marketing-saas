# SP1 — Social Foundation: Acceptance

Social Media Post Scheduler প্যাকেজের প্রথম ধাপ (plan: `docs/social-posts-package-plan.md`)। এই ধাপে শুধু **API + DB ভিত্তি** — কোনো UI নেই, কোনো publishing নেই (সেটা SP5/SP6)। যা তৈরি হলো: `SocialAccount` / `SocialPost` / `MediaAsset` মডেল + migration, Meta Page discover→picker connect (posting permission-এর জন্য আলাদা connection), tenant media registry + opt-in public link, draft post CRUD, এবং নতুন `social` permission area।

## যা তৈরি হয়েছে

### Schema + migration
- Migration: `packages/db/prisma/migrations/20261010910000_sp1_social_foundation/migration.sql` (Prisma conventions অনুযায়ী হাতে লেখা; AD6/C5-এর ধাঁচ)।
- `SocialAccount` — org, `integrationId?`, platform (`meta_page` | `instagram`, plain String — schema-র AdAccount convention), externalId, name, username?, pictureUrl?, status (default `connected`), lastError?, createdById; `@@unique([organizationId, platform, externalId])`।
- `SocialPost` — caption, linkUrl?, `mediaRefs` Json (default `[]`), status (default `draft`), scheduledAt?, publishedAt?, platformPostId?, platformUrl?, error?, account relation Cascade; index `[organizationId, status]` ও `[socialAccountId]`।
- `MediaAsset` — kind (`image` | `video`), name, contentType, sizeBytes, storageKey, `publicToken?` @unique, createdById।
- Organization-এ back-relation: `socialAccounts`, `socialPosts`, `mediaAssets`।
- `prisma generate` সফল (dummy DATABASE_URL দিয়ে; generate-এর live DB লাগে না)।

### API (`apps/api/src/social/`)
- `social.constants.ts` — `SOCIAL_POST_STATUSES` (draft/scheduled/publishing/published/failed/cancelled/sent_to_creator), `SOCIAL_ACCOUNT_PLATFORMS`, `SOCIAL_MEDIA_KINDS`।
- Controller: `@PermissionArea("social")`, `organizations/:organizationId/social`, TenantGuard + RolesGuard (AdsController-এর ধাঁচ)। Connect/disconnect OWNER/ADMIN; media/post লেখা WRITE_ROLES (OWNER/ADMIN/MARKETING_MANAGER)।
- **POST accounts/meta/discover** — verify → listPages; সম্পূর্ণ side-effect-free (কোনো write/audit নয়)। Response-এ alreadyConnected ফ্ল্যাগ: org+platform+externalId row **যেকোনো status-এ** থাকলেই true (disconnected row-ও counts — reconnect একই row revive করে, AD5 semantics)। Page-এর Instagram না থাকলে `instagram: null` — কখনো বানানো হয় না।
- **POST accounts/meta/connect** — pageIds খালি/অনুপস্থিত → বাংলা 400; অজানা pageId → কোনো write-এর **আগে** বাংলা 400। প্রতিটি নির্বাচিত Page-এর জন্য নতুন Integration + sealed credential; Page ও তার Instagram **একই integrationId** শেয়ার করে। অ-নির্বাচিত Page/account কখনো ছোঁয়া হয় না।
- **GET accounts** — explicit field select-ধাঁচের serializer; integration relation কখনো include হয় না, তাই credential material response-এ আসতেই পারে না।
- **POST accounts/:id/disconnect** — AD2 reference-count discipline (নিচে দেখুন)। Post কখনো ছোঁয়া হয় না। Integration ছাড়া account-এ idempotent।
- **Media**: POST media (base64 JSON, inbox DTO-র ধাঁচ; raw-byte cap **2,100,000 bytes**), GET media (newest first, cap 200), GET media/:id/file (StreamableFile inline), POST/DELETE media/:id/public-link।
- **Public route**: `GET /public/media/:token` (@Public, PublicBrandingController-এর precedent) — token → bytes অথবা 404; org-এর কোনো তথ্য expose হয় না।
- **Posts**: POST (draft), GET list (`status`/`accountId` filter; অবৈধ status → বাংলা 400), GET one, PATCH ও DELETE — শুধু draft-এ, নইলে 409 বাংলা। প্রতি post-এ account summary `{id, platform, name, username}`।

### MetaClient.listPages()
`listAdAccounts`-এর paging discipline হুবহু (foreign paging URL কখনো follow হয় না): `GET /me/accounts`, fields `id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}`, limit 100।

## Credential design — কী reuse হলো এবং কেন PAGE token seal হয়

- নতুন কিছু বানানো হয়নি: প্রতিটি Page-এর জন্য `Integration` (provider **`meta_social`**) + `IntegrationCredential`, যার `encryptedData` বিদ্যমান **AES-256-GCM `encryptJson`** (integrations/crypto.ts) দিয়ে seal করা — Inbox connectMessaging ও AdAccount-এর একই যন্ত্র।
- **কী seal হয়: PAGE access token।** `/me/accounts`-এর response-এ প্রতিটি Page-এর নিজস্ব `access_token` থাকে — সেটাই Page token। Posting Page হিসেবে হয়, তাই Page token-ই লাগে; user token শুধু discover/connect কলের ভেতরে বাঁচে — কখনো persist/log/response-এ যায় না (spec দিয়ে যাচাই করা)।
- Inbox connection থেকে **আলাদা** Integration, কারণ posting permission (`pages_manage_posts`, `instagram_content_publish`) messaging permission থেকে আলাদা — plan-এর audit সিদ্ধান্ত।
- Disconnect/supersede AD2-র discipline mirror করে: Page+Instagram এক token শেয়ার করে, তাই একটি disconnect হলে অন্যটির credential অক্ষত থাকে; **শেষ referencer** disconnect হলেই credential rows মুছে Integration DISCONNECTED হয়। Reconnect-এর পর আগের CONNECTED integration supersede হয় শুধু তখনই যখন কোনো SocialAccount আর সেটিকে reference করে না (audit `social.integration_superseded`)।
- Audit metadata-তে কখনো token/credential যায় না (connect: শুধু platform + pageId; public-link: শুধু assetId — token নয়)।

## MediaAsset audit finding + যুক্তি

Plan-এর SP1 audit-এ পাওয়া গেছে: **`MediaStore` শুধু byte storage — কোনো asset registry নেই।** Inbox media `ChannelMessage` row-র সাথে বাঁধা (message-bound), আর `CreativeAsset` ad-account-bound (Meta hash/video id নিয়ে)। কোনোটাই tenant-এর post media বা public link ধারণ করতে পারে না। তাই ছোট্ট tenant media registry `MediaAsset` আবশ্যিক ছিল — এতে upload-এর metadata (kind/contentType/size, সবই magic-byte sniff থেকে), storageKey, আর opt-in publicToken থাকে। Bytes আগের মতোই MediaStore-এই থাকে; registry শুধু তার ওপরের registry স্তর।

## Public media design — link opt-in কেন

- Tenant media **default-এ private**: upload-এ `publicToken` null থাকে, bytes শুধু authenticated org route (`media/:id/file`) দিয়ে মেলে।
- Public link তৈরি একটি **স্পষ্ট, audited, OWNER/ADMIN/MARKETING_MANAGER-only** কাজ। Token = `randomBytes(32).toString("base64url")` — unguessable; তৈরির কাজটি idempotent (আগের token-ই ফেরত আসে); DELETE করলে token null হয়ে link তখনই মরে যায়।
- কেন দরকার: Instagram Content Publishing-এ media **public URL**-এ থাকা বাধ্যতামূলক — SP6-এ publishing সেই URL ব্যবহার করবে। ReportShare.token-এর precedent অনুসরণ করা হয়েছে।
- Public route শুধু bytes দেয় — asset-এর নাম/org/মালিক কিছুই নয়।

## Permission registration

`PERMISSION_AREAS`-এ `campaigns`-এর পরে যোগ হয়েছে: `{ key: "social", labelBn: "সোশ্যাল পোস্ট", label: "Social posts", minRole: "MARKETING_MANAGER", noteBn: "সোশ্যাল মিডিয়া পোস্ট তৈরি, শিডিউল ও প্রকাশ" }` (মোট area এখন 14)। Repo-তে কোনো বিদ্যমান spec exact area list/count assert করে না (grep দিয়ে যাচাই করা) — তাই কোনো spec বদলাতে হয়নি।

## Validations (সব সার্ভার-side, বাংলা 400)

- Media upload: অবৈধ base64 → 400; raw bytes > 2,100,000 → 400; **magic-byte sniff**-ই সিদ্ধান্ত নেয় (declared type কখনো বিশ্বাস করা হয় না) — sniff null অথবা kind image/video না হলে (যেমন PDF) → 400 "শুধু ছবি বা ভিডিও আপলোড করা যাবে"।
- Post: account org-এর না হলে 404; ফাঁকা caption → 400; linkUrl http(s) না হলে → 400; mediaRefs-এর প্রতিটি assetId এই org-এর MediaAsset হতে হবে (নাম ধরে 400) এবং ref-এর kind asset-এর আসল kind-এর সাথে মিলতে হবে → নইলে 400। DTO cap: caption 5000, linkUrl 2048, mediaRefs সর্বোচ্চ 10।

## Evidence ceiling (স্পষ্টভাবে)

- Sandbox-এ **Postgres নেই** — তাই evidence = unit specs (fake prisma, AD-spec ধাঁচ) + full jest suite + `tsc --noEmit`। কোনো live run দাবি করা হচ্ছে না।
- SP1 spec: **22/22 pass** (`apps/api/src/social/social.spec.ts`) — discover verbatim errors ও side-effect-free আচরণ, connect-এ PAGE token seal-এর decrypt round-trip, supersede শর্ত, key-scan credential hygiene, shared-token disconnect, posts রেখে disconnect, public link idempotency ও token-ছাড়া অ-resolvable থাকা, sniff rejection, storageKey আকার, post validation গুচ্ছ, non-draft 409, tenant isolation, এবং MetaClient.listPages-এর foreign-paging guard।
- Migration **locally apply হয়নি** — owner's server-এ `prisma migrate deploy` দিয়ে apply হবে। Full API suite + build totals এই doc-এর নিচে রান শেষে বসানো হয়েছে (coordinator-এর রিপোর্টে)।

## Deviations

- Disconnect audit: integration-ছাড়া (idempotent) ক্ষেত্রেও `social.account_disconnected` audit হয় `{ shared: false }` দিয়ে — task "audit" বলেছিল; idempotent পথেও কে disconnect চেষ্টা করল তার রেকর্ড থাকা ভালো।
- Public-link **তৈরির** audit শুধু তখনই হয় যখন সত্যিই নতুন token তৈরি হয় (idempotent ফেরতে "created" audit মিথ্যে হতো)। DELETE-এর audit action নাম: `social.media_public_link_removed` (task নাম নির্দিষ্ট করেনি)।
- Post create-এ caption trim করে সংরক্ষিত হয় (validation trim-এর পরের মানই stored)।
