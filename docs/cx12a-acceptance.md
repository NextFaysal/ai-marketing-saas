# CX12a — Setup Guide + Practice Mode: Acceptance

**তারিখ:** ২০২৬-১০-১২ · **অবস্থা:** LOCAL ONLY (uncommitted working tree; coordinator verify + commit করবে) · **Migration:** `20261012190000_cx12a_practice_mode` — hand-written SQL, sandbox-এ **UNAPPLIED** (এখানে কোনো Postgres নেই)।

## ১. Setup Guide

**সিদ্ধান্ত (কম invasive পথ):** বিদ্যমান onboarding পেজ (`apps/web/src/app/onboarding/page.tsx`) হলো org-তৈরির ২-ধাপের wizard — সেটি অপরিবর্তিত। Guided Setup একটি নতুন dashboard পেজ `apps/web/src/app/dashboard/setup/page.tsx` ("🧭 Setup Guide" nav entry + Settings গ্রুপে লিংক), যেটি নতুন endpoint `GET /organizations/:id/setup-guide` consume করে। এই endpoint `OrganizationsService.getOnboarding`-এর **একই real-row state source** ব্যবহার করে — কোনো দ্বিতীয় checklist state নেই।

**Checkers — reused vs new:**

| Step | Checker | Reused / New |
|---|---|---|
| profile | `BusinessProfile` row-এ description/websiteUrl/industry যেকোনো একটি আছে | **Reused** — getOnboarding-এর হুবহু একই শর্ত |
| store | `Store` count > 0 | **Reused** — একই শর্ত |
| products | `Product` count > 0 | **Reused** — একই শর্ত |
| team | ACTIVE `Membership` count > 1 | **Reused** — একই শর্ত |
| channel | `Integration` count, provider ∈ {whatsapp, messenger, instagram, telegram, email} **এবং** status = CONNECTED | **New** — পুরনো "integration" step যেকোনো integration গুনত; channel step শুধু messaging + CONNECTED গোনে |
| instructions | `AiInstructionVersion` count > 0 (CX2 publish-এর version row) | **New** — live textarea-র text নয়, সত্যিকারের **published** version থাকলেই done |
| courier | `Integration` count, provider ∈ {steadfast, pathao, redx} **এবং** status = CONNECTED | **New** |
| ai_schedule | `InboxSetting.aiScheduleByChannel` parse করে (CX12d `parseAiSchedule`) অন্তত একটি channel entry `enabled=true` | **New** — corrupt stored value = not done (defensive) |

প্রতিটি step: `done` শুধু real state থেকে, deep link (`href`) সঠিক settings surface-এ, progress `percent = round(done/total × 100)` একই checkers থেকে। **কোনো fake completion নেই।** Spec: `apps/api/src/organizations/cx12a-setup-guide.spec.ts` — প্রতিটি checker দুই দিকেই (present → done, absent → not done), progress math 0% / 3-of-8 = 38% / 100%, tenant isolation।

## ২. Practice Mode — schema

একটি migration, সম্পূর্ণ additive:
- `Organization.practiceMode` Boolean default false (org-level flag; sibling flag `Organization.socialRequireApproval`-এর পাশে — InboxSetting নয়, কারণ practice orders + courier-কেও প্রভাবিত করে)।
- `ChannelConversation.isPractice` Boolean default false।
- `Order.isPractice` Boolean default false।

Toggle/cleanup: **OWNER/ADMIN only** (`PracticeController`-এ repo-র RolesGuard pattern)। State GET যেকোনো member পড়তে পারে (banner-এর জন্য)। চালু থাকলে dashboard layout-এ **প্রতিটি পেজে** persistent banner: "🧪 Practice Mode চালু আছে — কোনো কিছুই আসল customer-এর কাছে যাবে না" (৩০ সেকেন্ডে refresh)।

**Practice conversation:** `POST /practice/conversation` একটি মাত্র synthetic thread তৈরি করে — channel `"practice"`, `integrationId = null`, `externalContactId = practice-<uuid>`, contactName "🧪 প্র্যাক্টিস Customer", কোনো phone নেই। অর্থাৎ **কোনো real channel identity নেই যা দিয়ে sender resolve হতে পারে** — এটি প্রথম barrier।

**Simulate:** `POST /practice/conversations/:id/simulate {content}` — শুধু practice conversation-এই চলবে (real conversation-এ 400), mode off থাকলে 400। Inbound message row তৈরি করে **একই dispatch** ডাকে যা আসল webhook message নেয়: `InboxService.ingestChatMessage → processInboundIntelligence` (classification, COD/CSAT/review capture, order bot, autopilot) — org-এর **আসল** instructions/KB/products দিয়ে।

**Catalog সিদ্ধান্ত:** demo seed audit-এ পাওয়া গেছে `packages/db/prisma/seed.ts` শুধু একটি dev org (`demo-store`) তৈরি করে, কোনো product catalog নয়; `seed-inbox-qa.ts` একটি demo org-এর QA conversations মাত্র। Tenant org-এ import করার মতো কোনো ecommerce demo catalog নেই — তাই **practice org-এর আসল catalog read-only ব্যবহার করে** (autopilot/bot সবসময়ই শুধু পড়ে; কোনো পথে product mutate হয় না — createChatOrder শুধু Order/OrderItem লেখে)।

## ৩. SEND GUARD — প্রতিটি outbound পথ, একে একে

| # | পথ | Practice-এ কী হয় | প্রমাণ |
|---|---|---|---|
| 1 | `InboxService.deliverText` — **একমাত্র send choke point** (sendReply, sendAutomatedMessage, autopilot — তিনটিই এর ভিতর দিয়ে যায়) | `conv.isPractice` হলে কোনো integration resolve, কোনো Meta/WhatsApp/Telegram/email client construction ছাড়াই synthetic `practice-*` id ফেরত দেয়। Caller row-টি status **`"practice"`** দিয়ে store করে (`statusForDelivery` helper — "sent" শুধু আসল platform id-র জন্য) | Spec: MetaMessagingClient prototype fake — practice sendReply/sendAutomatedMessage/autopilot তিন ক্ষেত্রেই sender **কখনো call হয়নি**, integration resolver-ও call হয়নি, reply store হয়েছে |
| 2 | `sendAutomatedMessage`-এর Meta config gate | `!conv.isPractice` শর্ত যোগ — practice-এর জন্য gate-ও skip; deliverText হলো দ্বিতীয়, স্বাধীন barrier | একই spec |
| 3 | Order bot (`botSend` → sendAutomatedMessage) | উপরের ১+২ দিয়ে covered; bot-এর সব বার্তা practice status-এ store হয় | Spec (sendAutomatedMessage order_bot tag) |
| 4 | Chat order → **WooCommerce push** | Practice হলে integration lookup-ই হয় না (`woo = null`) — আসল store-এ কোনো order তৈরি হয় না | Spec: order.created event-ও fire হয়নি |
| 5 | Chat order → **stock (InventoryService.applyOrderPlaced)** | Practice হলে skip — আসল স্টক কাটে না | Spec: inventory fake call হয়নি |
| 6 | Chat order → **Customer row** | Practice হলে তৈরি হয় না (createChatOrder + botStep confirm — দুই জায়গাতেই guard); practice order `customerId = null` নিয়ে তৈরি হয় | Spec: customers table খালি থাকে |
| 7 | Chat order → **`order.created` workflow event** | Practice হলে emit হয় না (workflow থেকে real customer-এর কাছে message যেতে পারত) | Spec |
| 8 | **Courier booking** (`CourierService.bookShipment`, bulk-ও এর ভিতর দিয়েই যায়) | Practice order → provider client তৈরি/call হওয়ার **আগেই** Bengali refusal: "এটি একটি প্র্যাক্টিস অর্ডার — প্র্যাক্টিস অর্ডারে কুরিয়ার বুকিং করা যায় না" | Spec: refusal + কোনো shipment row নেই; non-practice control অন্য error-এ fail করে |
| 9 | **CX6 courier notify** (chat → SMS → email) | Practice order-এ shipment থাকতেই পারে না (৮ নম্বর)। Defense-in-depth: `notifyCustomer` order re-read করে `isPractice` হলে কোনো channel-এই পাঠায় না | Code audit + guard |
| 10 | **CX3 autoreply sweep** (`runDueAutoReplies`) | Loop-এর প্রথমেই practice row skip — claim-ও করা হয় না, batch অক্ষত থাকে। (Query-level filter নয়: পুরনো CX specs-এর fake rows-এ fieldটি নেই — JS check একই production semantics দেয়, কারণ real row-তে default false সবসময় থাকে।) **জ্ঞাত সীমা:** org-এ reply-delay > 0 থাকলে practice conversation-এর deferred reply sweep থেকে fire হবে না; immediate dispatch (delay 0, default) পুরোপুরি চলে | Spec: due practice batch অক্ষত + পাশের real batch claim হয় |
| 11 | **CX7 chase sweep** (`OrderChaseService`) | Conversation practice হলে terminal stop `stoppedReason = "practice"` — sender কখনো call হয় না | Spec + real-session control (control-এ chase সত্যিই পাঠানো হয়) |
| 12 | **CX12b review sweep** | `noteDelivered` practice order-এর জন্য review row তৈরিই করে না; `sendAsk`-এ defense-in-depth guard row-টিকে `skipped_practice` করে দেয় (chat/SMS/email কোনোটিতেই যায় না) | Spec: delivered practice order → 0 row; real → 1 row |
| 13 | **Broadcast** (`messaging.service`) | Audience আসে Customer/AudienceRecord থেকে; practice কোনো Customer তৈরি করে না → কোনো practice recipient থাকতেই পারে না। Unreachable by construction | Code audit |
| 14 | **Social comments** (`SocialCommentsService`) | আলাদা `SocialPostComment` জগৎ — practice conversation সেখানে কোনো row তৈরি করে না। Unreachable | Code audit |
| 15 | **Webchat** (`WebchatService`) | আলাদা LiveChatSession/token জগৎ; practice conversation channel `"practice"` — কোনো public webchat endpoint এটি resolve করতে পারে না। Unreachable | Code audit |
| 16 | Handover/assignment sweeps | কোনো outbound send নেই (শুধু internal assignment state) — practice conversation-এ agent assign হওয়া বরং কাঙ্ক্ষিত (অনুশীলন) | Code audit |

## ৪. Exclusions (default)

- **Orders:** `OrdersService.list` default `isPractice: false`; controller-এ `?practice=1` হলো "প্র্যাক্টিস অর্ডার দেখান" filter। `stats` (dashboard counts) দুটি groupBy-তেই `isPractice: false`। CSV export-এও excluded। Executive report (`reports/executive.service`) order groupBy + top-items order filter-এ `isPractice: false`।
- **Inbox:** practice conversation inbox list-এ **দেখা যায়** (সেখানেই অনুশীলন — 🧪 labelসহ)। `unreadTotal`-এ **কোনো leak নেই**: unread increment শুধু webhook ingest পথে হয়, simulate পথ সেখানে যায় না (code-verified)। Folder `all` count-এ threadটি গোনা হয় (list-এর সাথে consistent; একটি মাত্র labelled thread)। **Team report** (`getTeamReport`): conversation loads-এর পরে practice rows filter আউট — workload/CSAT/response-time কোথাও practice গোনা হয় না।
- Platform admin-এর cross-org counts (`admin.service`) ইচ্ছাকৃতভাবে অপরিবর্তিত — সেটি platform operations-এর হিসাব, tenant analytics নয়।

## ৫. Cleanup ("Practice শেষ করুন")

`POST /practice/cleanup` (OWNER/ADMIN) — **একটি transaction**-এ: org-এর সব practice conversation-এর messages → drafts/notes/bot sessions/chase chains → conversations delete; practice orders-এর items/reviews → orders delete; `practiceMode = false`; audit log `practice.cleanup` (metadata-তে deleted counts)। Spec প্রমাণ করে: cleanup-এর পর org-এর real rows **হুবহু** আগের অবস্থায়, অন্য org-এর practice data **অক্ষত**, দ্বিতীয় run no-op success (idempotent)।

## ৬. Evidence ceiling

- Sandbox-এ কোনো Postgres নেই: সব প্রমাণ **fake-prisma specs + full suite + builds**। Migration লেখা হয়েছে কিন্তু **কোথাও apply হয়নি** — deploy-এর সময় Dokploy/migration step-এ apply হতে হবে।
- কোনো live send, live Meta/Woo/courier call এই কাজে হয়নি বা দাবি করা হচ্ছে না। Autopilot/order-bot practice-এ চলার প্রমাণ unit-level dispatch দিয়ে (একই `processInboundIntelligence` পথ), live org-এ visual QA হয়নি।
- Web: নতুন Setup পেজ + banner compile-verified (tsc-তে touched ফাইলে ০ error); full `next build` বর্তমানে workflows track-এর deleted `@/lib/automation-blueprints` import-এ আগে থেকেই blocked (pre-existing, CX12a-র নয়)।

## ৭. Gates (exact numbers)

- Targeted: `cx12a-setup-guide.spec.ts` 12/12, `cx12a-practice.spec.ts` 21/21 — মোট **33/33 pass**।
- Full API jest: **1798/1800 tests, 200/207 suites pass**। Failures শুধু পরিচিত parallel-track: `courier/courier.spec.ts` (AG1 — ablation দিয়ে যাচাই: আমার CX12a block সরালেও fail থাকে), `customers/c3-customers-export.spec.ts` (AG1), এবং webchat `TS2304 parseCourierCard` দিয়ে blocked suites: `inbox/m66-visitor-stream`, `inbox/nextgen-p2`, `inbox/nextgen-p3`, `inbox/phase-f`, `workflows/a2-shipment-di`। `cx3-debounce` এই run-এ **pass**।
- API `tsc --noEmit` + `npm run build`: একমাত্র error ওই একই pre-existing `webchat.service.ts(195,16) TS2304`।
- Web vitest: **100/100 pass** (workflows track worktree-তে ৪টি lib test file delete করেছে — তাই মোট সংখ্যা আগের 112 থেকে কম; CX12a-র নয়)। Web tsc: মোট ৩টি error, সবই pre-existing owner-merge `automations/page.tsx` EmptyState/onAction mismatch; CX12a-র touched ফাইলে (setup page, layout, nav) **০ error**।
