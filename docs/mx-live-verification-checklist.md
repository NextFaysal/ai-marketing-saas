# MX — Messaging Advanced লাইভ যাচাই Checklist

তারিখ: 2026-10-16 · প্যাকেজ: Messaging Advanced (MX1–MX16), Batch MB1–MB6 · সূত্র: `Messaging-Advanced-Plan-2026-10-16.md` + `docs/messaging-advanced-package-summary.md`।

**এই নথির অবস্থা: সব আইটেম UNCHECKED।** MX প্যাকেজের প্রতিটা ফিচারের প্রমাণ এখন পর্যন্ত spec/build/fixture/fresh-DB স্তরের (MB1–MB6 acceptance দ্রষ্টব্য) — লাইভে আসল SMTP/SMS/WhatsApp/Telegram/Push provider, আসল গ্রাহক বা real DB-র কোনোটাই এখনো ছোঁয়া হয়নি। এই checklist-এর কোনো বাক্স তখনই টিক দেওয়া যাবে যখন সংশ্লিষ্ট প্রমাণ (স্ক্রিনশট / provider প্যানেল / লাইভ পর্দার অবস্থা / DB সারি) হাতে থাকবে — প্রত্যাশা লিখে টিক দেওয়া যাবে না।

শব্দচিহ্ন: **[মালিক]** = মালিক প্যানেলে/ব্রাউজারে করবেন · **[Muse যাচাই]** = Muse বাইরে থেকে probe/লগ দেখে প্রমাণ দেবে · **[দুজনে]** = মালিক ধাপ চালাবেন, Muse সঙ্গে সঙ্গে যাচাই করবে।

সঙ্গী নথি: `docs/messaging-advanced-package-summary.md` (item-ভিত্তিক audit ও NOT BUILT register), `docs/m30-live-verification-sprint.md` (MS1–MS10-এর বাকি লাইভ ধাপ — এই checklist সেগুলোর বিকল্প নয়, MX-এর অতিরিক্ত অংশ)।

---

## পূর্বশর্ত (সব session-এর আগে)

- [ ] MX কোড (MB1–MB6, 62 commit) মালিকের নির্দেশে GitHub-এ push হয়েছে এবং Dokploy Redeploy সম্পন্ন — লাইভ API/web নতুন build-এ চলছে **[মালিক]**
  - প্রমাণ: লাইভে Messaging পেজে MX-এর অংশগুলো (Journeys, Growth, Governance, Analytics কার্ড) দেখা যায়; `api.qosprey.com/health` 200।
- [ ] লাইভ DB-তে 15টি MX migration চলেছে (মোট 226) **[Muse যাচাই]**
  - প্রমাণ: `_prisma_migrations`-এ `20261019000000`–`20261019070100` সারিগুলো finished অবস্থায়।
- [ ] পরীক্ষার org-এ `broadcast_send_sweep` job enabled; `INTERNAL_JOB_SECRET` নিশ্চিত **[মালিক]**
  - প্রমাণ: job config পর্দা + একটি scheduled broadcast নিজে থেকে fired হওয়ার লগ।
- [ ] আসল provider প্রস্তুত: (ক) tenant SMTP verify হয়ে সংরক্ষিত, (খ) অন্তত একটি আসল SMS gateway, (গ) আসল WABA + অনুমোদিত template, (ঘ) আসল LLM key (AI ধাপগুলোর জন্য), (ঙ) org-এর Telegram bot connected, (চ) দোকানে আসল push subscription দিতে রাজি এমন ব্রাউজার/ডিভাইস **[মালিক]**
  - প্রমাণ: প্রতিটি sender/config পর্দায় verified/connected অবস্থা (credential কখনো chat-এ নয় — শুধু প্যানেলে)।

## S1 — MX1 Scale engine (আসল বড় তালিকা)

- [ ] **বড় broadcast:** অন্তত 1,000+ আসল প্রাপকের তালিকায় broadcast পাঠানো — recipient rows chunk-এ তৈরি হয়, progress এগোয়, পুরো তালিকা memory-তে Json হিসেবে জমে না **[দুজনে]**
  - প্রমাণ: Broadcast report-এর মোট সংখ্যা বনাম `BroadcastRecipient` সারির সংখ্যা মিলে যায়।
- [ ] **মাঝপথে থামিয়ে resume:** পাঠানোর মাঝে pause → resume; যাদের কাছে ইতিমধ্যে provider confirm পৌঁছেছে তারা দ্বিতীয়বার পায় না **[দুজনে]**
  - প্রমাণ: কোনো প্রাপকের কাছে duplicate বার্তা আসেনি (নিজের test inbox/phone-এ যাচাই) + delivery সারিতে একটিই sent।
- [ ] **Plan cap সৎ বার্তা:** cap-এর চেয়ে বড় তালিকা দিলে পাঠানো শুরুর আগেই স্পষ্ট refusal আসে, আংশিক send হয় না **[মালিক]**

## S2 — MX2 Cascade ও SMS failover

- [ ] **Cascade কার্যকর:** WhatsApp নম্বর ভুল/অনুপলব্ধ এমন প্রাপকের ক্ষেত্রে পরের channel (SMS/Email) চেষ্টা হয় এবং report-এ attempt chain দেখা যায় **[দুজনে]**
  - প্রমাণ: report-এর cascade অংশে প্রতি attempt-এর আলাদা delivery সারি ও শেষ channel।
- [ ] **SMS gateway failover:** প্রধান gateway বন্ধ/ব্যর্থ অবস্থায় দ্বিতীয় gateway দিয়ে send সফল হয়; পরপর ব্যর্থতায় circuit breaker report-এ দেখা যায় **[দুজনে]**
  - প্রমাণ: দ্বিতীয় gateway-র প্যানেলে send লগ + report-এর breaker event।
- [ ] **Rate ছাড়া cheapest-first নয়:** কোনো channel-এর rate সেট না থাকলে report-এ `ratesMissing` নোটসহ org order-ই থাকে — বানানো দাম কোথাও নেই **[Muse যাচাই]**

## S3 — MX3 Quiet hours ও stream separation

- [ ] **Quiet hours কার্যকর:** org timezone-এ quiet window চলাকালে marketing broadcast defer হয় (provider-এর কাছে কিছু যায় না), window শেষে নিজে থেকে পাঠানো শুরু হয় **[দুজনে]**
  - প্রমাণ: sweep লগে `deferred: "quiet_hours"` + window-পরবর্তী sent সময়।
- [ ] **Transactional অক্ষত:** একই সময়ে একটি আসল order notification / Shop OTP সঙ্গে সঙ্গে পৌঁছায় — marketing defer তাকে আটকায় না **[দুজনে]**
  - প্রমাণ: test order-এর notification সময় বনাম broadcast-এর defer সময়।

## S4 — MX4/MX5 Journey ও preset

- [ ] **Journey live run:** একটি preset (যেমন welcome series) enable করে আসল lead/order ঘটনায় run শুরু হয়; প্রতি step-এর সংখ্যা Journeys পর্দায় আসল run অনুযায়ী বাড়ে **[দুজনে]**
- [ ] **Exit-on-purchase:** journey-তে থাকা গ্রাহক আসল order দিলে পরের resume-এ run exit হয়, বাকি step পাঠানো হয় না **[দুজনে]**
  - প্রমাণ: stepsLog-এ order id-সহ exit এন্ট্রি; গ্রাহকের কাছে পরের ধাপের বার্তা আসেনি।

## S5 — MX6 Keyword ও poll (WhatsApp)

- [ ] **Keyword reply:** আসল WhatsApp নম্বর থেকে keyword পাঠালে tag লাগে এবং (সেট থাকলে) auto-reply আসল message id-সহ ফেরত আসে **[দুজনে]**
- [ ] **STOP সর্বোচ্চ:** একই নম্বর থেকে STOP পাঠালে suppression সঙ্গে সঙ্গে কার্যকর — পরের broadcast ওই নম্বরে যায় না, keyword campaign-ও আর চলে না **[দুজনে]**
- [ ] **Poll tally:** দুটি নম্বর থেকে vote দিলে tally distinct conversation অনুযায়ী গোনে; মত বদলালে latest vote-ই থাকে **[মালিক]**

## S6 — MX7 Email builder, brand kit, versioning

- [ ] **Block builder থেকে আসল send:** block দিয়ে বানানো template আসল SMTP দিয়ে পৌঁছায়; product slot-এ আসল পণ্যের নাম/দাম আসে, খালি slot ফাঁকাই থাকে **[দুজনে]**
- [ ] **Brand kit:** Org Settings-এ রঙ/logo বদলালে নতুন broadcast-এ নতুন kit, আগের পাঠানো বার্তা অপরিবর্তিত **[মালিক]**
- [ ] **Version stamp:** report-এ কোন template version দিয়ে পাঠানো হয়েছে তা মেলে **[Muse যাচাই]**

## S7 — MX8 Personalization ও unique coupon

- [ ] **Unique coupon আসল redemption:** দুজন প্রাপকের কাছে দুটি আলাদা code যায়; একটি code দোকানে একবার ব্যবহার হয়, দ্বিতীয়বার একই code প্রত্যাখ্যাত হয় **[দুজনে]**
  - প্রমাণ: দুটি আলাদা `StoreDiscount` সারি (origin `messaging_unique`) + checkout-এ দ্বিতীয় ব্যবহারের refusal।
- [ ] **Resume-এ দ্বিতীয় coupon নয়:** send মাঝপথে থামিয়ে resume করলে আগে code পাওয়া প্রাপক নতুন code পায় না **[দুজনে]**
- [ ] **Loyalty variable:** loyalty চালু org-এ আসল balance বার্তায় আসে; যার balance নেই তার ক্ষেত্রে বানানো সংখ্যা আসে না **[দুজনে]**

## S8 — MX9 WhatsApp category rate ও quality guard

- [ ] **আসল quality rating:** Meta থেকে sync হয়ে আসা আসল quality rating hub-এ দেখা যায়; guard চালু থাকলে RED/REJECTED template দিয়ে নতুন broadcast তৈরি আটকে যায় **[দুজনে]**
  - প্রমাণ: Meta প্যানেলের rating বনাম hub-এর rating একই।
- [ ] **Category rate:** marketing/utility rate আলাদা সেট করলে estimate সেই category-র rate দিয়েই হয়; rate না থাকলে কোনো সংখ্যা দেখায় না **[মালিক]**
- [ ] **Carousel submit:** carousel template Meta-তে submit হয়ে approval অবস্থা sync হয় (broadcast send NOT BUILT — যাচাইয়ের আওতার বাইরে) **[দুজনে]**

## S9 — MX10 Preference center, opt-in, import

- [ ] **Preference center live:** আসল unsubscribe/preference link খুলে channel বন্ধ করলে পরের broadcast সেই channel-এ ওই গ্রাহকের কাছে যায় না; unsubscribe-all এক click-এই কাজ করে **[দুজনে]**
- [ ] **Double opt-in:** join page/form দিয়ে signup করলে pending অবস্থায় কোনো marketing বার্তা যায় না; confirm link-এ click-এর পরই audience-এ সক্রিয় হয় **[দুজনে]**
- [ ] **QR opt-in:** QR scan করে আসল signup সম্পন্ন হয় এবং Lead তালিকায় source `messaging_form` হিসেবে আসে **[মালিক]**
- [ ] **CSV import hygiene:** duplicate/invalid/role address-সহ test CSV দিলে commit-এর আগেই কারণসহ hygiene report আসে; শুধু clean row import হয় **[মালিক]**

## S10 — MX11 Score, holdout, NL draft

- [ ] **Score বাস্তবের সাথে মেলে:** একজন আসল সক্রিয় গ্রাহকের score ও evidence পর্দায় তার আসল click/order ইতিহাসের সাথে মিলিয়ে দেখা **[দুজনে]**
- [ ] **Holdout:** holdout চালু broadcast-এ held-out অংশের কাছে কোনো বার্তা যায় না এবং report-এ held-out সংখ্যা দেখা যায়; resume-এ কেউ holdout থেকে বেরিয়ে আসে না **[দুজনে]**
- [ ] **NL draft (আসল LLM):** বর্ণনা দিয়ে rule-এর খসড়া আসে; মানুষ confirm না করা পর্যন্ত কোনো audience তৈরি হয় না **[মালিক]**

## S11 — MX12 Web Push

- [ ] **আসল subscription-এ broadcast:** দোকানে opt-in করা আসল ব্রাউজারে push পৌঁছায়; report-এ sent আসল, delivered/read `null`-ই থাকে **[দুজনে]**
- [ ] **Gone subscription:** subscription মুছে/unsubscribe করলে পরের send-এ সেটি gone হিসেবে চিহ্নিত হয় ও আর resolve হয় না **[দুজনে]**

## S12 — MX13 Telegram

- [ ] **আসল bot broadcast:** bot-এ /start করা আসল chat-এ broadcast পৌঁছায়, delivery-তে আসল message_id থাকে; button-সহ বার্তায় button কাজ করে **[দুজনে]**
- [ ] **STOP/START:** chat থেকে STOP পাঠালে পরের broadcast যায় না; START পাঠালে আবার যায় **[দুজনে]**
- [ ] **Blocked bot:** bot block করা chat-এ failure আসল Telegram error-সহ রেকর্ড হয়, sent বলে গণনা হয় না **[Muse যাচাই]**

## S13 — MX14 On-site notification

- [ ] **আসল গ্রাহকের কেন্দ্রে:** broadcast-এর পর আসল গ্রাহক তার account পেজের Notifications tab-এ বার্তা দেখে; খুললে unread badge কমে ও delivery-তে read stamp পড়ে **[দুজনে]**
- [ ] **অন্যের notification নয়:** অন্য গ্রাহকের notification id দিয়ে খুলতে গেলে 404 (তথ্য ফাঁস হয় না) **[Muse যাচাই]**

## S14 — MX15 Governance

- [ ] **Health dashboard বাস্তব:** S1–S13-এর আসল send-গুলোর পর health পর্দার failure rate/reason লাইভ delivery সারির সাথে মেলে; bounce/complaint `null`-ই থাকে **[Muse যাচাই]**
- [ ] **WhatsApp hard-failure suppression:** অস্তিত্বহীন নম্বরে WhatsApp পাঠিয়ে Meta hard failure এলে ওই ঠিকানা auto-suppress হয় ও পরের broadcast-এ বাদ পড়ে **[দুজনে]**
- [ ] **Approval workflow:** setting চালু করে non-approver দিয়ে broadcast বানালে তা `pending_approval`-এ আটকে থাকে; creator নিজে approve করতে পারে না; অন্য approver approve করলে তবেই পাঠানো যায় **[দুজনে]**
- [ ] **Budget cap:** ছোট cap সেট করে বড় broadcast দিলে queue হওয়ার আগেই দুটি সংখ্যাসহ block আসে; rate-বিহীন channel-এ warning-সহ allow হয় **[মালিক]**

## S15 — MX16 Analytics, auto-winner, scheduled report

- [ ] **Analytics মিলিয়ে দেখা:** এক সপ্তাহের আসল broadcast-গুলোর analytics সংখ্যা পৃথক report-গুলোর যোগফলের সাথে মেলে; CSV-র সংখ্যা পর্দার সংখ্যার হুবহু একই **[Muse যাচাই]**
- [ ] **Auto-winner (সতর্ক পরীক্ষা):** ছোট আসল তালিকায়, min sample পূরণের আগে winner ঘোষণা হয় না; তাৎপর্যপূর্ণ ফল এলে বাকিদের কাছে winning version যায় এবং সিদ্ধান্তটি Broadcast-এ রেকর্ড থাকে **[দুজনে]**
- [ ] **Scheduled report:** `messaging_summary` schedule বানালে নির্ধারিত cadence-এ আসল email-এ report পৌঁছায়, revenue "association" label-সহ **[মালিক]**
- [ ] **AI planner (আসল LLM):** goal দিলে পুরো proposal আসে; কোনো piece নিজে থেকে apply হয় না — প্রতিটি ধাপে মানুষের click লাগে **[মালিক]**

---

## সমাপনী নোট

- এই checklist-এর কোনো অংশই MS প্যাকেজের M30 বাকি ধাপগুলোকে (আসল SMTP/SMS/WABA/LLM-এর মৌলিক যাচাই) প্রতিস্থাপন করে না — সেগুলো ছাড়া উপরের অনেক বাক্সই চালানো যাবে না।
- NOT BUILT আইটেমগুলো (যেমন carousel broadcast send, WhatsApp Flows, Messenger broadcast) এই checklist-এ নেই — সেগুলো যাচাই করার কিছু নেই; তালিকা `messaging-advanced-package-summary.md`-এর register-এ।
- কোনো বাক্সে ব্যর্থতা ধরা পড়লে সেটি acceptance doc-এ নয়, এই checklist-এই ব্যর্থ হিসেবে টীকা দিয়ে রাখতে হবে — পরে fix হলে প্রমাণসহ পুনরায় টিক।
