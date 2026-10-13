# Demo Chat Pack — Acceptance

**তারিখ:** ২০২৬-১০-১৩ · **Branch:** `in-package` (base `55c77c2`, IN package complete-এর ওপর) · **Migration:** নেই (schema ছোঁয়া হয়নি)
**উদ্দেশ্য:** মালিকের নির্দেশ — "কিছু demo chat add করো যাতে full system-টা বোঝা যায়।" CX12a Practice Mode-এর ওপর দাঁড়িয়ে এক click-এ ১২টি লেবেলযুক্ত practice conversation লোড হয়, যাতে নতুন tenant পুরো inbox system (order flow, handover, VIP, voice, chase, snooze, review…) আসল-মতো thread খুলে দেখতে পারে — অথচ কোনোটাই আসল customer/data নয়।

## যা তৈরি হলো

### API
- **`POST organizations/:id/practice/demo-pack`** (Roles: OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT — বিদ্যমান practice route-গুলোর ধাঁচে)। Practice Mode OFF থাকলে সৎ Bengali error: "আগে Practice Mode চালু করুন — তারপর Demo Chat লোড হবে"।
- **`PracticeService.loadDemoPack`** — org-এর প্রথম ACTIVE product (থাকলে) দিয়ে pure builder `apps/api/src/inbox/demo-pack.ts`-এর `buildDemoPack({now, actorId, product})` চালিয়ে row তৈরি করে: conversation → messages (symbolic `quoteRef` আসল message id-তে resolve হয়) → internal note → orders + items → BotSession। Audit: `practice.demo_pack_loaded` (conversations 12, orders 4)।
- **সব demo conversation:** `isPractice: true`, `integrationId: null`, `externalContactId: practice-demo-<slug>`, contactName-এর আগে **"🎬 Demo: "**। Channel আসল মান (whatsapp/messenger/instagram/webchat/email/telegram) — তাই channel chip/filter সত্যিকারের মতো দেখায়।
- **Idempotent:** `practice-demo-*` conversation থাকলে দ্বিতীয় load কিছু তৈরি করে না — `{created: false, count, scenarios}` (বিদ্যমান conversationIdসহ) ফেরত দেয়। Reset = বিদ্যমান practice cleanup (এক transaction-এ সব demo row মোছে) + আবার load।
- `getState`-এ যোগ: `demoConversations` count + `demoPackLoaded`।

### Scenario (চূড়ান্ত ১২টি)
| # | Slug | Channel | যা বোঝা যাবে |
|---|---|---|---|
| 1 | wa-full-order | whatsapp | দাম → AI grounded উত্তর (autoReply) → তথ্য → COD অর্ডার; ঠিকানার বার্তা pinned, AI বার্তায় read delivery status-এর নমুনা |
| 2 | msgr-product-card | messenger | Product card বার্তা, quote ধরে agent reply, customer-এর ❤️ reaction |
| 3 | msgr-complaint-handover | messenger | Negative sentiment, `handoverReason: "complaint"` + পুরোনো handoverAt (queue + SLA ঝুঁকি), @mentionসহ internal note |
| 4 | wa-vip | whatsapp | `vip` tag, priority high, ২টি বড় practice order, repeat stage |
| 5 | ig-image-product | instagram | Image ধরনের inbound (mediaUrl বানানো হয়নি) + product-match উত্তরের নমুনা |
| 6 | webchat-visitor | webchat | সাধারণ জিজ্ঞাসা, unread, unassigned, চলমান thread |
| 7 | wa-voice-order | whatsapp | Audio বার্তা + transcription (status `done`, provider `"demo"` লেবেলসহ) + অর্ধেক অর্ডার |
| 8 | msgr-to-chase | messenger | আটকে থাকা BotSession (`ask_address`, status active) — To Chase-এর পূর্বাবস্থা |
| 9 | email-support | email | Subjectসহ লম্বা support জিজ্ঞাসা, pending অবস্থা |
| 10 | wa-delivered-review | whatsapp | Delivered order, CSAT 5 rating (csatRating/csatRatedAt), review চাওয়া + প্রশংসা উত্তর, closed |
| 11 | tg-snoozed | telegram | `snoozedUntil` ভবিষ্যতে — snoozed folder-এ দেখা যাবে |
| 12 | wa-unassigned-new | whatsapp | assignedUserId null, unread 2, সদ্য আসা — smart folder/assign বোঝাতে |

### Practice Order
সরাসরি data (createChatOrder দিয়ে নয়): ৪টি (scenario 1-এ ১, 4-এ ২, 10-এ ১ delivered), সব `isPractice: true`, `conversationId`-linked, `customerId: null`, `source: "chat"`, `externalNumber: DEMO-1001…1004`, COD, `storeSyncStatus: "local_only"`। OrderItem: org-এর আসল catalog product থাকলে তারই id/name/price; **catalog খালি থাকলে** productId null + নাম "🎬 Demo পণ্য — নমুনা আইটেম (আসল ক্যাটালগে নেই)", দাম ৳১,২০০ — snapshot field যেভাবে schema দেয়। **Customer row তৈরি হয়নি, stock ছোঁয়া হয়নি, Woo push হয়নি** (spec দিয়ে প্রমাণিত)।

### Counts exclusion fix (একই commit-এ)
Demo row যাতে আসল সংখ্যা দূষিত না করে: `InboxService.conversationFolderCounts`-এর সব count (all/mine/unassigned/SLA/handover/snoozed/VIP) ও `unreadTotal` এখন practice বাদ দিয়ে গোনে — team report ও IN10 analytics-এর বিদ্যমান exclusion-এর সাথে সামঞ্জস্য। পদ্ধতি fake-spec-safe: where-এ সরাসরি `isPractice: false` না বসিয়ে practice-only count বিয়োগ করা হয়েছে (অনেক বিদ্যমান spec-এর fake row-তে isPractice undefined)। Demo conversation তালিকায় *দেখা* যাবে (সেটাই উদ্দেশ্য), কিন্তু কোনো সংখ্যায় আসল workload হিসেবে গণনা হবে না।

### Web UI
Setup পেজের Practice কার্ডে "🎬 Demo Chat Pack" উপ-অংশ: ব্যাখ্যা + সতর্কতা (আসল customer-এর কাছে কিছু যাবে না, Cleanup-এ সব মুছবে), Practice OFF থাকলে disabled বোতাম + কারণ, লোড হলে API response থেকে scenario তালিকা (title + feature + Inbox লিংক) ও reset নির্দেশনা। Inbox কোনো conversation deep-link param সমর্থন করে না — বানানো param না দিয়ে সাধারণ `/dashboard/inbox` লিংক।

## প্রমাণ (spec: `demo-chat-pack.spec.ts`, ৭টি test)
- **OFF refuse:** Practice বন্ধ থাকলে Bengali error, কোনো row তৈরি হয় না।
- **Load সঠিকতা:** ঠিক ১২টি conversation; channel বণ্টন whatsapp 5 / messenger 3 / instagram 1 / webchat 1 / telegram 1 / email 1; সব isPractice/integrationId null/prefix ঠিক; ৪টি practice order (totals subtotal + shipping 6000 মিলিয়ে যাচাই); **Customer row 0টি; integration table-এর কোনো find call-ই হয়নি (0)**।
- **Guard (সবচেয়ে জরুরি):** আসল channel নাম (whatsapp) থাকা সত্ত্বেও লোড হওয়া demo conversation-এ আসল `InboxService.deliverText` practice-* id ফেরত দেয় এবং MetaMessagingClient-এর কোনো send method **call হয়নি** (prototype spy) — কোনো sender resolve হয় না।
- **Idempotency:** দ্বিতীয় load `created: false`, মোট সংখ্যা অপরিবর্তিত।
- **Counts:** demo (unreadসহ) + ১টি আসল conversation থাকা অবস্থায় folder counts-এর all = 1, unreadTotal শুধু আসলটির, handover শুধু আসলটির।
- **Cleanup:** বিদ্যমান cleanup-এ সব demo conversation/message/order/BotSession মুছে যায়, গণনা শূন্যে ফেরে।
- **Controller:** demo-pack route-এর ROLES_KEY metadata যাচাই।

## Full gate (coordinator নিজে চালিয়েছে)
| Gate | ফলাফল | IN final baseline |
|---|---|---|
| API jest (full) | **2019/2019, 220 suites** | 2012/2012, 219 |
| API tsc | clean | clean |
| Web vitest | **156/156, 22 files** | 156/156 |
| Web tsc | clean | clean |
| Web next build | green | green |

হিসাব মেলে: 2012 + নতুন 7 = 2019; suites 219 + 1 = 220। সংশ্লিষ্ট গুচ্ছ (cx12a, ux1-counts, in4-sla, cx4, cx5, nextgen-p2, in1, in10, cx2) আগেই আলাদা করে সবুজ যাচাই হয়েছে (116/116 + 19/19)। **Zero regression; কোনো flake আসেনি।**

## সৎ সীমা
- **CourierShipment বানানো হয়নি:** context panel-এর shipment widget customer-linked order দিয়ে আসে — demo order ইচ্ছাকৃতভাবে customer-less, তাই widget-এ tracking card দেখা যাবে না; আর courier sync path-এ practice guard নেই — demo shipment থাকলে "sync" চাপলে আসল courier API-তে ভুয়া tracking code যেত। Scenario 1 তাই order পর্যন্তই; tracking card বুঝতে আসল (বা practice simulate-এর) সম্পূর্ণ flow লাগবে।
- **Context panel-এর order তালিকা/lifetime:** customerId ছাড়া customerContext order ফেরত দেয় না — demo order Orders পেজে (`?practice=1`) ও conversation-linked হিসেবে থাকে, panel-এর customer order তালিকায় নয়। Demo-র জন্য Customer row বানানো হয়নি বলেই এই সীমা — প্রতারণা এড়াতে ইচ্ছাকৃত।
- Demo row-র delivery/read status, transcription ও reaction **নমুনা অবস্থা** — নামেই demo (🎬), কোনো platform দাবি নয়; আসল platform থেকে আসা তথ্য নয়।
- Scenario 5-এর ছবি: কোনো আসল image bytes/mediaUrl নেই — type "image" + caption-এ demo লেবেল; MediaView আসল ছবি দেখাবে না।
- কোনো live DB/Meta প্রমাণ নেই (সব spec/fake স্তরে; M30 বাকি)। Migration লাগেনি — deploy-এ এই feature-এর জন্য বাড়তি ধাপ নেই।
