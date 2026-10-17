# NF1 (FB1 Part A) Acceptance — Facebook Live Commerce BACKEND

**তারিখ:** ২০২৬-১০-১৭ · **Branch:** `new-frontier` (base `05b86e0c`) · **Scope:** Part A only —
Step-0 spikes + NF1 backend (data model + API). Frontend (Part B) এই batch-এ নেই।
Local commits only; push হয়নি (owner-এর push নির্দেশ ছাড়া push নয়)।

## Commits

| Item | Commit | বিষয় |
|---|---|---|
| 1 | `0822fee0` | Step-0 spikes: `docs/nf1-meta-live-spike.md` + `docs/nf2-video-provider-spike.md` (docs only) |
| 2 | `50d4d720` | Data model + migration `20261028000000_nf_live_commerce` |
| 3 | (this doc-এর commit) | API module `apps/api/src/live-commerce/` + app.module registration |

## Item 1 — Spikes (সারসংক্ষেপ)

- **NF1:** evidencable = Page broadcast creation shape
  (`POST /{page-id}/live_videos?status=LIVE_NOW`, Page token,
  `pages_read_engagement` + `pages_manage_posts`, response
  `{id, stream_url, secure_stream_url}`), comments polling shape
  (`GET /{live-video-id}/comments` → `{data:[{id, created_time,
  from:{id,name}, message}], paging:{cursors}}`), edge params
  (`filter/live_filter/order/since`, `summary.total_count`, errors
  100/190/200), `publish_video` + App Review আবশ্যক। NOT proven:
  কোনো live call হয়নি — আসল Page + App Review owner-gated (M30-ধাঁচের)।
  Design: LiveCommentsProvider port, polling only (SSE নয়),
  provider unavailable → typed ফলাফল + MANUAL mode, mode প্রতিটি
  response-এ লেবেলযুক্ত, Meta data কখনো বানানো হয় না।
- **NF2:** external video provider বেছে নেওয়া হয়নি (owner D3
  pending) → port + v1 local ffmpeg template rendering। ffmpeg
  dev machine-এ আছে (8.1.2), production runtime image-এ নেই
  (root Dockerfile-এর runtime apt line-এ শুধু `openssl
  ca-certificates fontconfig fonts-noto-core`)। **FB1-এ Dockerfile
  বদল এই Part A-তে করা হয়নি** — ffmpeg apt যোগ করা NF2 render
  কাজের অংশ (Part A-এর scope backend-only); spike-এ সিদ্ধান্ত
  রেকর্ড করা আছে, render job binary না থাকলে labelled error
  দেবে, কোনো asset বানাবে না।

## Item 2 — Data model

- Models: `LiveSession`, `LiveSessionProduct`, `LiveComment`,
  `LiveSessionOrder` (বিস্তারিত schema comment-এ)। Order-এ
  **কোনো column যোগ হয়নি** — attribution শুধু
  `LiveSessionOrder`-এ (`orderId` unique)।
- `LiveComment` unique `(liveSessionId, externalCommentId)` —
  Postgres-এ NULL distinct, তাই manual row কখনো collide করে না,
  meta comment একবারই জমা হয় (schema + migration দুটোতেই
  নথিভুক্ত)।
- Migration হাতে লেখা, পরে `prisma migrate diff --from-empty`
  দিয়ে তৈরি SQL-এর সঙ্গে এই চারটি table-এর column/index/FK
  statement-for-statement মিলিয়ে যাচাই করা হয়েছে।
- Gate: `pnpm db:generate` — Prisma Client clean generate হয়েছে।

## Item 3 — API module

Files: `live-commerce.controller.ts`, `live-commerce.service.ts`,
`live-commerce.dto.ts`, `live-comments.provider.ts`,
`live-commerce.module.ts`, `live-commerce.spec.ts`;
registration: `app.module.ts`।

- Controller: PosController-এর convention — `@PermissionArea("orders")`,
  `organizations/:organizationId`, TenantGuard + RolesGuard,
  write roles OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT।
  ("social" area-ও catalog-এ আছে, তবে সেটা post publishing-এর;
  live selling order-taking surface বলে "orders" বেছে নেওয়া হয়েছে।)
- Endpoints: session create/list/get/start/end; `PUT
  live-sessions/:id/products` (replace, ordered); `POST
  .../products/:productId/now-showing` (exactly one — spec-proven);
  `GET .../comments` (provider port → upsert; unavailable →
  stored + `mode:"manual"` + `providerStatus:"unavailable"` +
  reason); `POST .../comments` (manual import single/batch,
  external id দিলে dedupe + skipped গণনা response-এ);
  `POST .../comments/:commentId/order` (নিচে দেখুন);
  `GET .../recap`; `POST .../follow-up-segment`।
- Token পথ: `SocialPublishService.resolveAccountToken` (SocialModule
  থেকে) — একমাত্র বিদ্যমান sealed Page-token পথ; নতুন storage নেই।
  Graph call: shared `graphGet` (common/meta-graph), শুধু evidenced
  fields (`id,created_time,from{id,name},message`)।
- **Comment→order = `OrdersService.createManual`** ( বিদ্যমান একমাত্র
  manual-order দরজা; POS-ও integrations upsert-এর ওপর দাঁড়িয়ে
  একই পথ ব্যবহার করে)। Exactly-once: comment-এর জন্য
  `LiveSessionOrder` থাকলে createManual আর ডাকা হয় না, বিদ্যমান
  order-ই ফেরত যায় (spec-এ call-count দিয়ে প্রমাণিত)। Link
  `$transaction`-এর ভিতরে লেখা হয় যেখানে client সমর্থন করে।
- **Recap:** commentCount / distinct commenters / orderCount /
  revenueMinor — revenue শুধুমাত্র এই session-এর
  `LiveSessionOrder` link-এর order থেকে (unlinked order ও অন্য
  session-এর order spec-এ বাদ পড়েছে)।
- **Follow-up segment:** `MessagingService.createSavedAudience`
  reuse (CrmSegment নয় — কারণ Messaging-এর service-ই strict
  validated definition সহ shared creation পথ; CrmSegment-এর
  সমতুল্য shared service নেই)। **সীমাবদ্ধতা (honest):** audience
  vocabulary-তে id-list শর্ত নেই, তাই saved definition খালি
  শর্তের (vocabulary-র নিয়মে পুরো entity) — matched customer
  ids response + audit-এ থাকে, definition-এ জোর করে ঢোকানো
  হয়নি; commenter matching = commenterExternalId ↔ Customer
  .externalId / CustomerStoreIdentity + exact name; মেলেনি এমন
  commenter `unmatchedCount`-এ গণনা করা হয়, ভুয়া customer
  বানানো হয় না। Response-এর `note`-এ এই সীমাটা বলা আছে।

## Gates (এই batch-এ চালানো)

| Gate | ফলাফল |
|---|---|
| `pnpm db:generate` (Item 2) | PASS — client generated clean |
| Targeted jest `src/live-commerce/live-commerce.spec.ts` | **PASS — 16/16** (1 suite) |
| `pnpm --filter @repo/api lint` (`tsc --noEmit -p tsconfig.json`) | PASS — no errors |
| `pnpm --filter @repo/api build` (`tsc -p tsconfig.build.json`) | PASS |

Spec coverage: session create validation (meta-র দুটো field
আবশ্যক, foreign social account refused), lifecycle
(start/end/idempotent/ended-restart refused), **org isolation**
(org B প্রতিটি read/mutation-এ 404, কোনো mutation ঘটেনি),
products replace (foreign id → write-এর আগেই refused, পুরনো
তালিকা অক্ষত), now-showing exclusivity, provider-unavailable
honesty (stored only, labelled, nothing fabricated), manual
session-এ provider কখনো ডাকা হয় না, REAL provider দিয়ে
evidenced shape mapping + idempotent upsert + Graph call-এর
fields পিন করা, token failure → typed unavailable, manual
import dedupe রিপোর্টসহ, comment→order exactly-once
(createManual call-count = 1), cross-session comment order
refused, recap attributed-only, follow-up segment আসল
MessagingService দিয়ে matched/unmatched হিসাব।

**চালানো হয়নি (coordinator serially চালাবে):** full API suite,
fresh-PG migration gate।

## NOT BUILT / owed

- NF1 frontend (live session UI) — Part B।
- Meta broadcast তৈরি (`POST live_videos`) API থেকে ডাকা হয় না —
  `externalLiveVideoId` staff-supplied (spike §৩.7)।
- Live প্রমাণ শূন্য: আসল Page/token/App Review দিয়ে comments
  polling কখনো চালানো হয়নি (spike §৪ checklist unchecked)।
- Dockerfile-এ ffmpeg যোগ — NF2 render batch-এর কাজ (উপরে দেখুন)।
- Migration কোনো আসল DB-তে চলেনি; fresh-PG gate coordinator-এর।
