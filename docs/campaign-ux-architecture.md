# Campaign UX Architecture — DX1

Campaign Builder Design+UX package-এর প্রথম phase (owner
অনুমোদন 2026-10-15; plan: Campaign-Design-UX-Plan-2026-10-15.md)।
এই doc-এ আগে অভিজ্ঞতার নকশা — journey, flow, state, friction —
visual কাজ (DX2/DX3) এর ওপর দাঁড়াবে। সব দাবি campaign-next
tree-র আসল code পড়ে (builder 1,894 lines, hub 1,098,
ad-accounts 877 — NB7 শেষ অবস্থা, HEAD 31cbee0 + NB8 চলমান)।
এই doc DX2 শুরুর সময় repo-র docs/campaign-ux-architecture.md
তে যাবে। NB8-এর surface (PMax draft manager, simulator,
report share) audit-এ "in-build, NB8" হিসেবে চিহ্নিত।

<!-- SECTIONS: 1 journeys · 2 screen/state inventory · 3 step-shell spec · 4 hub spec · 5 cross-cutting rules · 6 DX2/DX3 breakdown · 7 open questions -->

## 1. পাঁচটা Journey — আজ vs Target

ধাপ গণনা পদ্ধতি: একটা "ধাপ" = user-এর একটা সিদ্ধান্ত বা
একটা action যা ছাড়া journey এগোয় না (scroll গণনা নয়,
সিদ্ধান্ত গণনা)। সংখ্যাগুলো code-এর flow পড়ে গোনা।

### J1 — প্রথম Campaign (নতুন seller)

**আজ — ১১ ধাপ:** (1) Connect Center-এ গিয়ে Meta connect
(ad-accounts page-এর একদম নিচে connect form, line 803 —
প্রথম কাজটা page-এর শেষে), (2) hub-এ "New plan", (3) builder
খুলে Objective বাছাই, (4) ad account + page বাছাই, (5) Audience
section-এ scroll করে targeting, (6) Budget section-এ আলাদা
Save বোতাম, (7) Creative section-এ ad বানানো + আলাদা save,
(8) Review ধাপে গিয়ে প্রথমবার readiness দেখা — সমস্যা থাকলে
scroll করে ফিরে আগের section-এ, (9) Submit for approval,
(10) approve (নিজেই owner হলে আলাদা action), (11) Publish →
তারপর আবার builder থেকেই Activate।

Friction:
- **F-1 (সবচেয়ে বড়):** "ধাপ" আসলে ধাপ নয় — 5টা anchor
  (`CBX_STEPS`, line 566) একটাই 2,134-line page-এ scroll করে।
  সব section একসঙ্গে চোখে পড়ে; কোথায় আছি বোঝা যায় শুধু
  rail-এর active রঙে।
- **F-2:** Save খণ্ডিত — Budget (line 927), Dayparting
  (1154), Creative প্রতিটা আলাদা save; কোন section-এ unsaved
  বদল আছে তা কোথাও দেখা যায় না। ভুলে গেলে কাজ হারায়,
  notice toast ছাড়া চিহ্ন নেই।
- **F-3:** Readiness শুধু Review ধাপে (line 1948) — ভুলটা
  জানা যায় একদম শেষে, যেখানে তৈরি হয়েছিল সেখানে নয়।

**Target — ৭ ধাপ:** connect (ad-accounts-এর ওপরে, J-এর শুরুতে
প্রাসঙ্গিক হলে builder থেকেই deep-link), plan তৈরি, তারপর
step-shell-এ 5টা আসল ধাপ — এক সময়ে একটা, প্রতিটা ধাপে সেই
ধাপের readiness সেখানেই; ডানে স্থায়ী rail (budget মোট,
readiness সারাংশ, creative preview)। Submit + Approve +
Publish এক Review পর্দায় পরপর (আজকের spine-ই, শুধু সাজানো)।
বাদ পড়ে: আলাদা section-save গুলো (autosave), শেষে গিয়ে
ভুল খোঁজা (ধাপেই readiness), connect খোঁজা (deep-link)।

### J2 — COD Seller-এর সাপ্তাহিক চেক

**আজ — ৩ জায়গায় ছড়ানো, কোনো একক ধাপ-ক্রম নেই:** hub-এ
portfolio totals (মোট খরচ), তারপর প্রতিটা plan আলাদা খুলে
builder-এ performance + CN7 recommendations, তারপর
ad-accounts-এ গিয়ে CN14 offline log (conversion loop চলছে
কিনা)। মোট কমপক্ষে 6–8টা navigation, seller নিজে মনে রাখে
কী দেখতে হবে।
**Target — ১ পর্দা:** hub-এর ওপরে "এই সপ্তাহে" card সারি —
মোট spend vs গত সপ্তাহ (portfolio totals থেকেই গণনা যায়),
CN7 recommendation count (মরা ad set × টি), CN14 loop status
(শেষ successful upload কবে, failed কয়টা — OfflineConversionLog
থেকেই), fatigue × টি creative। প্রতিটা card ক্লিকে ঠিক সেই
plan/section-এ। নতুন data source লাগে না — সব read-model
আছে; 🚩 শুধু একটা aggregate endpoint লাগতে পারে (নিচে §6)।

### J3 — WhatsApp Campaign (CN13)

**আজ — builder-এর Audience/Creative প্রবাহের ভেতরে:** destination
বাছাই Creative-এর কাছাকাছি একটা select; connected WhatsApp
না থাকলে লাল notice (line 1629 — এই state-টা ভালো design-এর
নমুনা: কারণ + করণীয় দুটোই আছে)। Welcome editor ad card-এ।
Conversation ফলাফল performance panel-এ আলাদা button খুলে।
Friction: destination সিদ্ধান্তটা Objective ধাপের সঙ্গে বাঁধা
নয় — ENGAGEMENT/CONVERSATIONS goal পরে বদলালে destination
ভুল থেকে যেতে পারে; দুটো একই ধাপে থাকা উচিত।
**Target:** Objective ধাপেই "কোথায় পাঠাবেন: Website /
WhatsApp / Lead form" — destination অনুযায়ী পরের ধাপগুলো
বদলায় (WhatsApp হলে নম্বর picker সেখানেই, Welcome Creative
ধাপে)। ফলাফল (conversations started) performance-এর মূল
সারিতেই, আলাদা panel-এ নয়।

### J4 — Full-funnel Bundle (CN16)

**আজ:** hub-এ wizard modal — তিন layer এক modal-এ, layer
ফলাফল শেষে লেখা আকারে ("verbatim layer results")। অসম্পূর্ণ
layer বোঝা যায় wizard শেষ হওয়ার পর builder-এ গিয়ে।
**Target:** modal নয়, পুরো পর্দার wizard — বাঁয়ে তিন layer-এর
ছবি-সহ মানচিত্র (কার কাছে যাচ্ছে), প্রতিটা layer-এর source
count সেখানেই (CN6 sourceCatalog), অসম্পূর্ণ layer wizard-এর
ভেতরেই হলুদ চিহ্নিত, "তবু তৈরি করুন (অসম্পূর্ণ ad set হিসেবে)"
স্পষ্ট বোতামে। শেষে সোজা builder-এর Review ধাপে।

### J5 — Optimisation Review

**আজ:** builder-এ plan খুলে নিচে performance → breakdowns →
creative insights → recommendations — চারটা আলাদা panel,
ক্রম user-এর নিজের খুঁজে নেওয়া। Recommendation-এর action
(নতুন draft / pause) panel-এর ভেতরেই আছে — ভালো; কিন্তু
কোনটা আগে দেখব তার কোনো ক্রম নেই।
**Target:** একটাই "Review" প্যানেল-ক্রম — সারাংশ (কী বদলেছে)
→ মরা/জেতা তালিকা → fatigue → প্রস্তাব। সংখ্যা আগে, action
পরে; প্রতিটা প্রস্তাবের পাশে তার প্রমাণ (spend/conversions)
এক লাইনে।

## 2. Screen ও State তালিকা

| Surface | Empty | Loading | Error | Honest-unavailable |
| --- | --- | --- | --- | --- |
| Hub plan list | আছে (কোনো plan নেই) | skeleton নেই, খালি থাকে | toast মাত্র | n/a |
| Builder | plan ছাড়া খুললে create ফর্ম | section ভেদে spinner নেই | notice লাল লেখা | estimate unavailable = লেখা (design নেই) |
| CTWA picker | **ভালো নমুনা** (line 1629) | — | readiness error row | — |
| Ad-accounts | filter-empty ভালো (line 432) | — | form error inline | CAPI/offline "configured নয়" = লেখা |
| Performance | published নয় = লেখা | — | — | no_data pacing = লেখা |

DX2-র কাজ: প্রতিটা "লেখা" state-কে §5-এর pattern-এ আনা —
icon + এক লাইনে কেন + পরের action-এর বোতাম। Loading-তে
skeleton (hub list + builder rail অন্তত)।

## 3. Step-shell Spec (Builder)

- বাঁয়ে: 5 ধাপের তালিকা (Objective+Destinations / Audience /
  Budget+Bidding / Creative / Review) — ক্লিকে section বদলায়,
  scroll নয়; প্রতিটা ধাপের পাশে তার নিজের readiness চিহ্ন
  (✓/⚠/⛔) — CN1-এর per-ad-set readiness থেকেই আসে, নতুন
  হিসাব নয়।
- মাঝে: শুধু সক্রিয় ধাপের কাজ।
- ডানে স্থায়ী rail: মোট budget (CN2 effective, mode label সহ),
  pacing (published হলে), readiness সারাংশ (error × টি,
  warning × টি), creative preview (CB3-এর বিদ্যমান preview)।
- Autosave: section save গুলো থাকে API-তে, কিন্তু UI-তে
  একটাই অবস্থা — "সব সেভ হয়েছে · HH:MM" / "সেভ হচ্ছে…" /
  "⚠ সেভ হয়নি — আবার চেষ্টা" (আসল save ফলাফল থেকে;
  optimistic মিথ্যা নয়)।
- Mobile: এক column; rail ভাঁজ হয়ে নিচে; ধাপ তালিকা ওপরে
  horizontal chip।
- Exit/resume: hub-এ "অসমাপ্ত কাজ" card — শেষ সম্পাদিত draft
  plan গুলো (listPlans-এ updatedAt আছে কিনা DX2-তে যাচাই;
  থাকলে API ছোঁয়া লাগবে না)।

## 4. Hub Spec

ওপরে J2-র "এই সপ্তাহে" সারি → তার নিচে tab: Plans /
Calendar / Portfolio (আজ সব এক page-এ গাদাগাদি)। Saved
views Plans tab-এই থাকে। Blueprints tab আগের মতোই।

## 5. Cross-cutting নিয়ম

- Status রঙ: সবুজ = চলছে/সফল, হলুদ = মনোযোগ (warning,
  held, incomplete), লাল = আটকে আছে (error, failed) —
  একটাই অর্থ সব surface-এ।
- বাংলা: body text-এ line-height 1.7; সংখ্যা সব জায়গায়
  এক format — ৳ + bn-BD grouping (NB7-এর experiment panel
  ইতিমধ্যে bn-BD date ব্যবহার করে — সেটাই মান)।
- Tap target কমপক্ষে 40px; rail-এর ধাপ বোতাম পুরো প্রস্থ।
- Honest state pattern: icon + "কেন এমন" এক লাইনে + পরের
  action। CTWA notice (line 1629) এই pattern-এর বিদ্যমান
  নমুনা — বাকিগুলোকে এর স্তরে আনা।

## 6. DX2/DX3 কাজের ভাগ

DX2 (builder+hub): step-shell রূপান্তর (L; behaviour অপরিবর্তিত
— zero-loss spec + label set-diff দিয়ে প্রমাণ), autosave
অবস্থা (M), hub tab + এই-সপ্তাহে সারি (M; 🚩 সম্ভাব্য: সাপ্তাহিক
aggregate-এর জন্য একটা ছোট read endpoint লাগতে পারে —
portfolio totals + recommendation count + offline-log status
একসঙ্গে; DX2 শুরুতেই যাচাই, থাকলে লাগবে না), state design
প্রতিটা surface (M), responsive পূর্ণ pass (M)।
DX3 (Frontier surfaces): J3 destination-একীকরণ (M), J4 wizard
পূর্ণপর্দা (M), J5 review ক্রম (S), NB8 surfaces (in-build —
PMax draft manager, simulator, report share) DX1 নীতি মেনে
সাজানো (M), visual consistency sweep (S)।

🚩 তালিকা: (ক) সাপ্তাহিক aggregate endpoint — যাচাই সাপেক্ষ;
(খ) hub resume card-এর জন্য updatedAt — listPlans-এ থাকলে
কোনো API কাজ নেই। দুটোই DX2-র প্রথম দিনে নিষ্পত্তি হবে;
এর বাইরে API ছোঁয়ার পরিকল্পনা নেই।

## 7. Owner-এর সিদ্ধান্ত (2026-10-15 10:28 +06 — দুটোই সুপারিশমতো)

1. **Autosave** — step-shell-এ ধাপ বদলালেই আগের ধাপের কাজ
   সেভ হবে; আলাদা "Next"-এ save বোতাম থাকবে না। (সঙ্গে
   §3-এর সৎ save-অবস্থা display থাকবেই।)
2. **"এই সপ্তাহে" সারি hub-এর একদম ওপরে** — Plans tab-এর
   ভেতরে নয়।

DX1 এখানেই সম্পূর্ণ। DX2 শুরু হবে NB8 শেষ হওয়ার পর,
campaign-next-এর তখনকার HEAD থেকে; এই doc তখন repo-র
docs/campaign-ux-architecture.md তে যাবে।
