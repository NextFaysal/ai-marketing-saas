# UX Roadmap — ব্যবহারকারীর অভিজ্ঞতা আরও ভালো করা (Plan)

**প্রসঙ্গ:** Design v2 (fe0ebe0) ও v3 (6b0c108) শেষে মালিকের প্রশ্ন (২০২৬-১০-১২ ০১:২৬ +06) —
"এখন user experience আরও better করতে আর কী কী করা যায়?" মালিকের সিদ্ধান্ত (০১:২৮): আগে পুরো রোডম্যাপ প্ল্যান।
নিচের প্রতিটি ঘাটতি একই দিনের code audit-এ যাচাই করা (speculation নয়); যেখানে যাচাই হয়নি, সেখানে "verify-first" লেখা আছে।

## নীতি

- **সততা:** কোনো optimistic "পাঠানো হয়েছে" দাবি নয় — platform নিশ্চিত না করলে মেসেজের অবস্থা pending/failed-ই থাকবে।
  কোনো invented metric নয়; সাফল্য মাপা হবে বিদ্যমান আসল signal দিয়ে (নিচে "মাপকাঠি")।
- **Scope শৃঙ্খলা:** যেখানে web-only সম্ভব সেখানেই; API ছোঁয়া লাগলে item-এ স্পষ্ট পতাকা (🚩)।
- **Overlap শৃঙ্খলা:** CX প্যাকেজ (B2–B5 বাকি) ও AG প্যাকেজের সাথে সংঘর্ষ নয় — এই রোডম্যাপ সেগুলোর
  ওপর দাঁড়ায়, ডুপ্লিকেট করে না। সমান্তরাল ট্র্যাক চলমান থাকলে commit-এর আগে git log/status দেখা বাধ্যতামূলক।
- **Push নিয়ম অপরিবর্তিত:** সব local commit; GitHub push শুধু মালিকের তাৎক্ষণিক নির্দেশে।

## বর্তমান অবস্থা — যা ইতিমধ্যে শক্তিশালী (নতুন করে বানানো নয়)

Realtime stream + presence/collision, ghost text ও tone, voice/drag-drop media, product card,
courier widget, smart folders (server counts), bulk, pipeline board, Cmd+K, j/k keyboard,
in-app notification bell (dashboard shell), PWA (sw.js), webchat widget-এ realtime + দুই দিকের
typing/presence, Design v2/v3-র আধুনিক চেহারা। CX B1 শেষ (CX2/CX3/CX12d live code-এ);
B2 (CX4 handover polish, CX5 snooze + action bar, CX11ac) পরবর্তী।

---

## Phase UX0 — Visual QA Baseline (আগে এটা, ছোট)

**কেন:** Design v2+v3 দুটোই build/typecheck দিয়ে যাচাই — আসল ডেটাসহ চোখে দেখা হয়নি একবারও।
বাকি সব UX কাজের আগে বাস্তব চেহারাটা জানা দরকার।

- Demo org-এ seeded কথোপকথন (বাংলা+ইংরেজি নাম, লম্বা নাম, ছবি/ভয়েস/failed মেসেজ, SLA breach, VIP)
  দিয়ে inbox-এর সব ভিউ (list/thread/board/media/manage) desktop + mobile আকারে screenshot।
- যা খুঁজব: overflow, বাংলা লেখা ভাঙা/wrap সমস্যা, contrast, tap target, composer ছোট পর্দায়, context drawer।
- ফলাফল: defect তালিকা (ছবিসহ) `docs/ux-qa-baseline-2026-10.md`; গুরুতর defect UX1-এর আগে ঠিক।
- **সীমা:** seeded data শুধু demo org-এ — production path-এ কোনো mock নয়। আকার: **S**।

## Phase UX1 — Quick Wins (web-only, একটি প্যাকেজ)

| # | Item | যাচাই করা বর্তমান অবস্থা | বদল | আকার |
|---|------|------------------------|------|------|
| Q1 | **বাংলা ফন্ট** | পুরো অ্যাপে শুধু `@fontsource-variable/inter` (layout.tsx); বাংলা glyph Inter-এ নেই → ডিভাইসভেদে fallback, অসঙ্গত রূপ | Hind Siliguri (বা Noto Sans Bengali) fontsource যোগ; font stack: Inter → Bengali font — Latin Inter-এই থাকবে, বাংলা per-glyph fallback-এ সুন্দর ফন্ট পাবে। tenant web + প্রয়োজনে admin | S |
| Q2 | **নতুন মেসেজে সাড়া** | Browser Notification API, শব্দ, title badge — তিনটাই নেই (grep-যাচাই)। stream-এ `message.created` আসে | (ক) Tab hidden থাকলে desktop notification (অনুমতি শুধু user gesture + Manage-তে toggle; ক্লিকে সেই কথোপকথন খুলবে) (খ) হালকা শব্দ (WebAudio, mute setting, default অন তবে ট্যাব active থাকলে নয়) (গ) Title badge `(n)` — 🚩 **একমাত্র API ছোঁয়া:** counts endpoint-এ আসল unread মোট সংখ্যা যোগ (loaded list-এর আংশিক যোগ দিয়ে বানানো সংখ্যা দেখানো হবে না) | M |
| Q3 | **পছন্দ মনে রাখা** | শুধু pane width localStorage-এ থাকে; filter/folder/view প্রতিবার reset | শেষ filter + smart folder + view mode persist (একই localStorage ধাঁচ); "reset" পথ palette-তে | S |
| Q4 | **⌘K-তে খোঁজা** | Palette-তে search input-ই নেই — শুধু action + প্রথম ৫ অপঠিত (code-যাচাই) | ওপরে search ঘর: নাম/ফোন/preview মিলিয়ে লোড করা তালিকা থেকে ফল (সৎ সীমা লেখা থাকবে: "লোড করা কথোপকথন থেকে"), Enter-এ খুলবে; বিদ্যমান server search (list-এর `q`) deep-link action-ও থাকবে | S |
| Q5 | **পাঠানোর feedback + Retry** | `sendReply` সার্ভার উত্তরের আগে thread-এ কিছু দেখায় না; failed মেসেজে শুধু "ব্যর্থ" লেখা, resend বোতাম নেই (code-যাচাই) | পাঠানোর সঙ্গে সঙ্গে **pending bubble** ("পাঠানো হচ্ছে…", ধূসর) — server-এর আসল মেসেজ এলে বদলে যাবে, ব্যর্থ হলে bubble লাল + **"আবার পাঠান"** (একই content নতুন send — পুরনো failed রেকর্ড ইতিহাসে থাকবে)। Composer-এর লেখা pending-তে চলে যাবে, ব্যর্থ হলে ফেরত আসবে। সততা: pending কখনো "পাঠানো হয়েছে" সাজবে না | M |

**যাচাই:** build + vitest + tsc; UX0-র screenshot-এ Q1/Q5 পুনঃপরীক্ষা; notification প্রবাহ হাতে-কলমে (sandbox stream দিয়ে)।

## Phase UX2 — প্রথম দিনের অভিজ্ঞতা (CX12a-র সাথে সমন্বয়)

- **ডুপ্লিকেট নয়:** Setup Guide + Practice Mode CX প্যাকেজের CX12a (Batch B5) — এই রোডম্যাপ সেটা টানবে না।
- এই phase শুধু যা CX12a-র বাইরে: (ক) খালি inbox-এর empty state-কে ধাপে-ধাপে checklist-এ রূপ
  (বিদ্যমান onboarding step-এর আসল অবস্থা থেকে — বানানো ধাপ নয়), (খ) connect সফল/ব্যর্থ feedback-এর
  ভাষা ও পরের ধাপের দিকনির্দেশ polish, (গ) প্রথম AI Draft দেখার মুহূর্তে একবারের hint।
- **ক্রম:** CX B5 শেষ হলে, অথবা মালিক চাইলে CX12a-র সাথে মার্জ করে — সিদ্ধান্ত মালিকের। আকার: **M**।

## Phase UX3 — এজেন্টের কাজের গভীরতা (CX B2 শেষের পর)

- **Saved custom views:** নিজের filter 조합 নাম দিয়ে সেভ (যেমন "ঢাকার VIP অপঠিত") —
  🚩 ছোট API + model লাগবে (বর্তমানে কোথাও নেই, grep-যাচাই)। CX4/CX5-এর queue/snooze ধারণার সাথে মিলিয়ে নকশা।
- **Accessibility pass:** modal-এ focus trap + Esc ধারাবাহিকতা, tinted chip-গুলোর contrast যাচাই,
  নতুন মেসেজে aria-live, পুরো inbox keyboard দিয়ে চালানোর পূর্ণ পরীক্ষা (UX0 পদ্ধতিতে)।
- **ঘনত্ব পছন্দ:** compact/comfortable list density toggle (persist Q3-র ধাঁচে)। আকার: **M–L**।

## Phase UX4 — Customer-পক্ষ: Webchat Widget (verify-first)

Widget (`apps/web/public/chat-widget.js`) realtime + typing পেয়েছে; এই phase **audit দিয়ে শুরু** —
নিচের প্রার্থীরা audit-এ টিকলেই কাজ: greeting/প্রথম-বার্তা অভিজ্ঞতা, CX12d schedule অনুযায়ী
off-hours বার্তা, widget-এ বাংলা ফন্ট (Q1-এর সম্প্রসারণ), মোবাইলে full-sheet আচরণ, দীর্ঘ কথোপকথনে
scroll/history অনুভূতি, CSAT widget-এর ভিতরে। আকার: **M (audit S)**।

## Phase UX5 — মালিকের সিদ্ধান্তের বড় বিষয় (সময়সূচিতে নয়)

- **Dark Mode:** পুরো tenant অ্যাপের token পুনর্গঠন — inbox একা করা যায় না (বাকি অ্যাপের সাথে বেমানান হবে)।
  সিদ্ধান্ত পেলে আলাদা প্যাকেজ: token → shell → পেজ ধরে ধাপে।
- **বাংলা/English ভাষা toggle:** UI string সব পেজে inline বাংলা — i18n framework + ~৪০ পেজের string
  extraction বড় কাজ (**L+**)। আন্তর্জাতিক বিক্রেতা টার্গেট হলে মূল্য আছে; এখনই নয়, সিদ্ধান্ত মালিকের।

## মাপকাঠি — উন্নতি বুঝব কীভাবে (সব আসল signal)

- UX0 defect সংখ্যা ও তার বন্ধের হার; Q1-এর পর screenshot-এ বাংলা rendering তুলনা।
- SLA/first-response (বিদ্যমান inbox settings/report data), CSAT (বিদ্যমান), onboarding funnel (admin analytics-এ বিদ্যমান)।
- কোনো vanity metric, কোনো বানানো trend নয়।

## প্রস্তাবিত ক্রম

**UX0 → UX1 → (CX B2 চলতে থাকুক) → UX2 (CX B5-এর সাথে সমন্বয়ে) → UX3 → UX4; UX5 সিদ্ধান্ত-নির্ভর।**
প্রতিটি phase: audit-ভিত্তিক scope, build+test+acceptance doc, local commit only।
