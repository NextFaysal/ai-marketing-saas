# IN6 — Message Lifecycle (Delivery/Read · Quote · Reaction · Pin) Acceptance

Worktree `~/workspace/ai-marketing-saas-in`, branch `in-package`,
B2 HEAD `2f6a019` থেকে। মালিকের অনুমোদন: পুরো IN1–IN10 প্যাকেজ
(2026-10-12 22:16 +06), B3 = IN6 + IN7। Main repo ছোঁয়া হয়নি;
push/fetch হয়নি।

## কী তৈরি হলো

### IN6a — Delivery/read status (শুধু প্ল্যাটফর্ম-নিশ্চিত)
- Schema (additive): `ChannelMessage.deliveryStatus` (sent|delivered|read|failed),
  `deliveredAt`, `readAt`। Migration: `20261012230000_in6_message_lifecycle`
  (হাতে-লেখা, additive only)।
- আগে: webhook `statuses` শুধু legacy `status` কলাম আপডেট করত, কোনো
  timestamp ছিল না, Messenger read সম্পূর্ণ ignored ছিল (parser comment)।
  এখন: `nextDeliveryPatch` (message-lifecycle.ts) monotonic প্যাচ —
  sent(1) < delivered(2) < read(3); পেছনের status সামনেরটা overwrite
  করে না; failed non-read state থেকে বসে, read-কে overwrite করে না,
  failed থেকে resurrection হয় না; প্রথম deliveredAt/readAt stamp অটুট থাকে।
- WhatsApp statuses এখন per-status timestamp সহ parse হয় → stamp আসল
  প্ল্যাটফর্ম-সময়। Messenger delivery mids → delivered।
- Messenger/Instagram read watermark এখন সত্যিই প্রয়োগ হয়: সেই
  conversation-এর (org + integration + channel + contact scoped)
  watermark-এর আগের outbound মেসেজগুলো read। Watermark-এর বাইরের/
  পরের মেসেজ অপরিবর্তিত।
- Webchat: visitor-এর আসল read পথ আছে — `listMessages` (widget এই
  call-এই থ্রেড রেন্ডার করে)। সেখানে outbound রো read মার্ক হয়
  (একই monotonic patch); stream খোলাকে read ধরা হয়নি।
- UI: আউটগোয়িং বাবলের নিচে — WhatsApp ✓(sent) / ✓✓(delivered) /
  নীল ✓✓(read); Messenger/IG "Delivered"/"Seen" লেবেল; webchat "Seen"
  (শুধু read হলে)। **deliveryStatus না থাকলে কিছুই দেখায় না।**
  Telegram/Email-এ tick নেই।

### IN6b — Reply-to / quote
- Schema: `replyToMessageId` (additive)। Agent send: service যাচাই করে
  target এই conversation-এরই মেসেজ — অন্য থ্রেডের/অস্তিত্বহীন id = 400,
  কোনো রো তৈরি হয় না।
- Customer inbound quote-ও ধরা হয়: WhatsApp `context.id` / Messenger
  `message.reply_to.mid` → একই conversation-এ আমাদের রো-তে resolve;
  resolve না হলে null (অন্য থ্রেডের টেক্সট কখনো টানা হয় না)।
- UI: প্রতিটি মেসেজে ↩️ Quote বোতাম, composer-এ quote প্রিভিউ + ✕,
  থ্রেডে quoted snippet (ক্লিকে আসল মেসেজে jump)। পাঠানোর সময়
  pending bubble-ও একই quote দেখায়।
- Customer-এর কাছে quote পাঠানো: WhatsApp-এ Meta-র আসল
  `context: {message_id}` (client-এ যোগ করা হয়েছে), Messenger/IG-তে
  Send API-র আসল top-level `reply_to: {mid}` (Meta docs যাচাইকৃত)।
  অন্য channel-এ quote শুধু অভ্যন্তরীণ — composer-এ সেটা স্পষ্ট
  সতর্কতা লেখা থাকে; প্ল্যাটফর্মে quote হিসেবে যাওয়ার ভান নেই।

### IN6c — Reactions
- Schema: `reactions` JSON — `[{emoji, actor: "customer"|"page", at}]`,
  actor-প্রতি একটি (নতুন emoji আগেরটা replace করে, unreact সরায়)।
- Ingest: WhatsApp reaction message (type "reaction") — চ্যাট মেসেজ
  হিসেবে thread-এ **আসে না**; Messenger/IG `message_reactions`
  webhook (emoji অথবা named love/like/… → emoji normalize)।
  আমাদের কাছে নেই এমন মেসেজের reaction drop হয়, invent হয় না।
- Agent reaction পাঠানো: Meta-র আসল sender_action API
  (POST /me/messages, `sender_action: react/unreact`,
  `payload: {message_id, reaction}` — Meta "Sender actions" docs
  যাচাইকৃত 2026-10-12)। সফল = Meta response-এ recipient_id;
  তবেই "page" entry সংরক্ষিত। ব্যর্থতায় Meta-র verbatim error,
  কিছুই সংরক্ষিত হয় না। **শুধু Messenger/Instagram-এ বোতাম**;
  WhatsApp/অন্য channel-এ service 400 দিয়ে সৎভাবে refuse করে
  (WhatsApp Cloud API-তে business-এর reaction পাঠানোর endpoint নেই)।
- UI: থ্রেডে emoji ব্যাজ (customer/page আলাদা title), Messenger/IG-তে
  😊 React পিকার + নিজের reaction তোলার অপশন।

### IN6d — Pin
- Schema: `pinnedAt` + `pinnedBy` (ChannelMessage-এই, আলাদা মডেল নয়)।
- `POST …/messages/:messageId/pin {pinned}` — org-scoped
  (getConversationOrThrow + message অবশ্যই সেই conversation-এর),
  pin/unpin দুটোই audit (`inbox.message.pinned/unpinned`)।
- UI: থ্রেডের ওপরে pinned তালিকা; ক্লিকে সেই মেসেজে jump+highlight
  (IN1 search jump-এর একই mechanism)। সব channel-এ চলে — pure DB feature।

## Channel সততা সারণি

| Channel | Read/Delivery | Quote (customer-এর কাছে) | Reaction পাঠানো | Reaction পাওয়া | Pin |
|---|---|---|---|---|---|
| WhatsApp | ✅ আসল (statuses webhook) | ✅ আসল (context.message_id) | ❌ endpoint নেই — বোতাম নেই | ✅ আসল (reaction message) | ✅ DB |
| Messenger | ✅ আসল (delivery mids + read watermark) | ✅ আসল (reply_to.mid) | ✅ আসল (sender_action) | ✅ আসল (message_reactions) | ✅ DB |
| Instagram | ✅ আসল (একই messaging webhook) | ✅ আসল (একই Send API) | ✅ আসল (sender_action) | ✅ আসল (message_reactions) | ✅ DB |
| Webchat | ✅ read শুধু (visitor listMessages fetch = আসল view; delivered ধাপ নেই) | ❌ অভ্যন্তরীণ মাত্র (UI-তে লেখা আছে) | ❌ বোতাম নেই | ❌ widget-এ reaction নেই | ✅ DB |
| Telegram | ❌ কিছু দেখায় না (আমাদের integration-এ confirmed status আসে না) | ❌ অভ্যন্তরীণ মাত্র | ❌ বোতাম নেই | ❌ parse হয় না | ✅ DB |
| Email | ❌ কিছু দেখায় না | ❌ অভ্যন্তরীণ মাত্র | ❌ বোতাম নেই | ❌ — | ✅ DB |

## যাচাই (targeted; full gate coordinator চালাবে)
- নতুন spec `apps/api/src/inbox/in6-lifecycle.spec.ts`: **27/27 pass** —
  monotonic patch, reaction replace/unreact, parser (WA reaction
  আলাদা, statuses timestamp, Messenger reaction/watermark/quote),
  client payload (context/reply_to/sender_action + verbatim error),
  webhook end-to-end (delivered→read stamps, late delivered regress
  করে না, failed resurrection নেই, অন্য org-র মেসেজে প্রয়োগ নেই,
  watermark scope, inbound quote resolve), quote validation
  (cross-thread 400 + কিছু পাঠানো হয় না), pin org-scope + audit,
  agent reaction (WhatsApp refuse; Messenger Meta-confirm-এর পরেই
  সংরক্ষণ, Meta failure-তে অপরিবর্তিত), webchat visitor read।
- পাশের spec: meta-messaging + inbox.service + m66 + in1 + in3 + in4
  সহ মোট **87/87 pass**। দ্রষ্টব্য: `meta-messaging.spec.ts`-এর দুটি
  পুরনো expectation হালনাগাদ হয়েছে — parser-এর additive shape
  (statuses-এ `at`, খালি shape-এ `reactions`/`readWatermarks`);
  আচরণ বদলায়নি, শুধু নতুন ফিল্ড।
- Web helper `apps/web/src/lib/inbox-in6.test.ts`: **9/9 pass**।
- API tsc clean, Web tsc clean, Prisma schema valid 🚀।

## সৎ সীমা
1. **Migration কোনো আসল DB-তে চালানো হয়নি:** `20261012230000_in6_message_lifecycle`
   deploy-এ চালাতে হবে + `prisma generate` — না হলে lifecycle
   কলামগুলোতে write ব্যর্থ হবে।
2. **Live Meta প্রমাণ নেই (M30 pending):** সব পথ fixture/fake-fetch
   প্রমাণিত। Meta docs দিয়ে endpoint আকার যাচাই করা হয়েছে
   (context, reply_to, sender_action), কিন্তু আসল Page/নম্বরে
   reaction/quote/read একবারও যায়নি।
3. Messenger read watermark `createdAt`-এর সঙ্গে তুলনা করে
   (আমাদের outbound রো-তে platformTimestamp বসে না) — watermark
   Meta-র নিজের semantics অনুযায়ীই "এর আগের সব পড়া হয়েছে",
   তবে সীমানার কাছের মেসেজে কয়েক সেকেন্ডের হেরফের সম্ভব।
4. WhatsApp statuses-এর `at` না থাকলে (Messenger delivery)
   webhook পৌঁছানোর সময়ই stamp — প্ল্যাটফর্ম-সময় দাবি করা হয়নি সেখানে।
5. Quote শুধু text send-এ (sendReply) — media/template send-এ
   quote প্যারামিটার নেই (সেগুলোতে quote অভ্যন্তরীনও বসে না)।
6. getConversation quote resolve শুধু fetched 100 মেসেজের page +
   প্রয়োজনে একই conversation-এ scoped lookup; target মুছে গেলে/
   না মিললে থ্রেডে "পাওয়া যাচ্ছে না" দেখায়।
7. Webchat stream (SSE) খোলাকে read ধরা হয়নি — শুধু listMessages
   fetch; widget যদি stream-only মোডে চলে তবে read দেরিতে বসতে পারে।
