# Customer Experience Advanced Package (CX1–CX12) — Plan

**প্রসঙ্গ:** মালিকের ১৪টি feature-এর তালিকা (২০২৬-১০-১২ ০০:৩০ +06)। নিচের প্রতিটি verdict একই দিনের code audit থেকে (file ধরে যাচাই)।

## Audit সারসংক্ষেপ (১৮টি একক)
- **আছেই (২):** comment hide-word নিয়ম (11b — ingest-এ সত্যিই hide হয়), দৈনিক মালিক-রিপোর্ট (12e — M48 daily briefing; শুধু in-app, email copy নেই)
- **অর্ধেক (১৩):** 1, 2, 3, 4, 5, 6, 9, 10, 11a, 11c, 12a, 12b, 12c
- **নতুন (৩):** To Chase (7), label scan + ছবি দেখে product চেনা (8), channelভিত্তিক AI সময়সূচি (12d)

উল্লেখযোগ্য near-miss: comment-এর reply-delay setting **সংরক্ষিত হয় কিন্তু কখনো প্রয়োগ হয় না** (মৃত setting); AI "উত্তর দিতে পারল না" ঘটনাটা কোথাও **লেখাই থাকে না** (নীরবে হারিয়ে যায়); courier update customer-এর কাছে যায়, কিন্তু শুধু plain text-এ আর শুধু chat-যুক্ত order-এ।

## প্যাকেজ (৫ batch)

### Batch 1 — Inbox AI-র মেরুদণ্ড
- **CX2 AI Instructions Desk:** BusinessProfile.aiInstructions-এর জন্য draft → sample প্রশ্নে **test** (আসল AI দিয়ে dry-run, কোনো customer-এর কাছে যায় না) → **publish**; প্রতিটি publish-এ version snapshot; ইতিহাস + **rollback**; আর **"AI উত্তর দিতে পারেনি" তালিকা** — autopilot-এর NO_ANSWER ঘটনা এখন থেকে record হবে (প্রশ্ন, channel, সময়), Desk থেকে দেখা যাবে ও সেখান থেকেই instruction/knowledge ঠিক করার পথ থাকবে
- **CX3 Wait-before-answering:** inbox message-এর জন্য debounce setting (সেকেন্ড, channelভেদে) — একসাথে আসা message জমিয়ে **একটাই উত্তর**; comment-এর ক্ষেত্রে বিদ্যমান `replyDelaySeconds` সত্যিই প্রয়োগ + একই batching; দুই পথের setting আলাদা
- **CX12d Channelভিত্তিক AI সময়সূচি:** per-channel AI active hours (M68 agent-hours-এর ধাঁচে, কিন্তু AI-র জন্য) — সময়ের বাইরে AI থামে, handover/পরের জন্য জমে থাকে; perChannelModes-এর সাথে মিলিয়ে

### Batch 2 — Handover ও Chat অভিজ্ঞতা
- **CX4 Handover কিউ পলিশ:** আলাদা handover queue view — প্রতি item-এ **অপেক্ষার সময়** (live), escalation **কারণ field হিসেবে** (audit metadata থেকে বের করে), **timed assign** (X মিনিটের জন্য দায়িত্ব) + সময় শেষে **AI-তে অটো-ফেরত** (conversation আবার autopilot-এ; কেউ নিলে timer বাতিল)
- **CX5 এক-সারির Action Bar:** chat header-এ Done / Later (**snooze নতুন** — snoozedUntil + জাগানোর job) / Take over (এক click-এ assign-to-me + AI pause) / Back to AI / Timer (CX4) / Assign / Lead — সাতটা এক সারিতে
- **CX11ac Reply attribution + Quality:** ghost text/tone দিয়ে পাঠানো reply-তেও AI-সহায়তার দাগ; quick reply ব্যবহারের attribution; **reply quality analytics** — AI draft গ্রহণের হার, AI বনাম human CSAT ভাগ, agent/AI ভিত্তিক মান-সূচক (M70 scorecard-এর পাশে, সূত্র দেখিয়ে)

### Batch 3 — Customer-এর কাছে ডেলিভারি অভিজ্ঞতা
- **CX1 Customer Courier Record:** customer-প্রতি **delivery success %** (decided ভিত্তিতে, M50-র শ্রেণিবিভাগ পুনঃব্যবহার), courier-ভিত্তিক ভাঙন, আর inbox-এর customer panel-এ courier record কার্ড (360-তে যুক্ত)
- **CX6 Tracking Card + সব customer-এর কাছে update:** text-এর বদলে **tracking card** (public tracking linkসহ — ReportShare-ধাঁচের token link); chat-যুক্ত নয় এমন order-এর customer-এর জন্য **SMS/email পথ** (courier update সেখানে); আর **scheduled courier auto-sync job** (এতদিন deferred ছিল — update যাতে নিজে থেকে যায়)
- **CX12b ডেলিভারির পর অটো রিভিউ:** delivered হলে customer-কে অটো review/rating চাওয়া (chat-এ) + rating সংগ্রহ ও তালিকা; workflow preset-এর team-reminder থেকে আলাদা আসল customer-facing flow। 12e-র ছোট সংযোজন: দৈনিক রিপোর্টের **email copy** (ঐচ্ছিক)

### Batch 4 — Chase, Voice, Knowledge, Broadcast
- **CX7 To Chase:** অসম্পূর্ণ chat order (BotSession আটকে থাকা) ধরে AI-র chase — নির্ধারিত ব্যবধানে ভদ্র তাড়া (সর্বোচ্চ N বার, stop শব্দ/মানুষ নিলে/order সম্পূর্ণ হলে থামে), প্রতিটা chase recordসহ; setting-এ on/off + ব্যবধান
- **CX12c Voice Note-এ Order:** inbound voice note **auto-transcribe** হয়ে order bot/autopilot-এ ঢোকে — customer voice-এই order করতে পারে; transcript সবসময় message-এ দৃশ্যমান, AI ভুল বুঝলে মানুষ ঠিক করতে পারে (order তৈরি শুধু নিশ্চিত তথ্যে)
- **CX9 Knowledge Base — File Ingestion:** paste-এর পাশাপাশি **file upload** (PDF/text/doc থেকে text বের করে KnowledgeDocument); retrieval আপাতত keyword-ই (chunk করে ভালো করা), embeddings/semantic এই ধাপে নয় — নথিতে স্পষ্ট লেখা থাকবে
- **CX10 Follow-up নিয়ম + Broadcast ঠিক করা:** follow-up timing **settings আকারে** (stageভেদে default ব্যবধান); Broadcast-এ **আগের প্রাপক বাদ** দেওয়ার option + opt-out বাদ + **পাঠানোর আগেই সঠিক প্রাপক সংখ্যা** + **preview** (কারা পাচ্ছে তার নমুনা তালিকা)

### Batch 5 — Packing ও Setup
- **CX8 Packing সহায়ক:** (ক) **Label scan** — packing desk-এ label-এর ছবি তুললেই vision দিয়ে tracking/order নম্বর পড়ে সংশ্লিষ্ট parcel/order খুলে আনে; voice দিয়েও নম্বর বলে খোঁজা। (খ) **ছবি দেখে product চেনা** — customer ছবি পাঠালে vision দিয়ে tenant-এর catalog-এর product-এর সাথে মেলানো (product-এর আসল ছবি/নাম ভিত্তিতে; মিল নিশ্চিত না হলে AI অনুমান বলবে না — সম্ভাব্য তালিকা agent-কে দেখাবে)। সৎ সীমা: এটা vision-LLM মেলানো, similarity-index নয়
- **CX12a Setup Guide + Practice Mode:** নতুন tenant-এর জন্য ধাপে ধাপে guide (বিদ্যমান checklist-এর ওপর) + **practice mode** — demo data/demo conversation-এ AI reply ও order flow অনুশীলন, আসল customer-এর কাছে কিছু যায় না; practice শেষে পরিষ্কার করে আসল শুরু

## নিয়ম
প্রতিটি item: audit-ভিত্তিক scope, build + tests + acceptance doc, local commit only — GitHub push মালিকের স্পষ্ট নির্দেশ ছাড়া নয়। কোনো AI আচরণ "কাজ করে" বলা হবে শুধু প্রমাণ থাকলে; customer-এর কাছে কিছু "পাঠানো হয়েছে" বলা হবে শুধু platform নিশ্চিত করলে।
