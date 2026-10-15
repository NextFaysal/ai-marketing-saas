# Admin UX Screenshot & Usability QA Checklist (ADX13) — সব বাক্স UNCHECKED

> **অবস্থা: এই checklist শুধু তৈরি হয়েছে — কোনো screenshot এখনো তোলা
> হয়নি, কোনো QA চালানো হয়নি, একটি বাক্সও টেকা হয়নি।**
> এই checklist চলবে **শুধুমাত্র deploy-এর পরে** — মালিকের GitHub push
> নির্দেশ + Dokploy Redeploy-এর পর, live `admin.qosprey.com`-এ, আসল
> browser-এ। তার আগে নতুন shell-এর কোনো page-কেই "দেখে যাচাই করা"
> বলা যাবে না। Code, typecheck আর build দিয়ে এই QA প্রতিস্থাপিত
> হয় না — DB1–DB4-এর প্রতিটি acceptance doc-এ এই সীমা বলা আছে।
>
> **AN10 checklist-এর সঙ্গে সম্পর্ক:** `docs/admin-screenshot-qa-checklist.md`
> (AN10, ৪৯ বাক্স) আগের মতোই থাকছে — পুরনো surface-এর যে যাচাইগুলো
> সেখানে ছিল (responsive ভিত্তি, login/TOTP, table scroll নিয়ম)
> সেগুলো সেখানেই প্রযোজ্য। এই ADX13 checklist সেটিকে **প্রতিস্থাপন
> করে না**; এটি নতুন shell-এর (ADX2/ADX3 navigation ও topbar,
> ADX4 design system v3, ADX5–ADX11 page পুনর্গঠন, ADX12 states,
> ADX14 personalization) জন্য আলাদা, পূর্ণাঙ্গ যাচাই। দুটোই
> deploy-এর পরে চালাতে হবে; একই screenshot দুটোতেই প্রমাণ হিসেবে
> চলতে পারে, কিন্তু বাক্স আলাদা আলাদা টিকতে হবে।
>
> পদ্ধতি: প্রতিটি route-এর জন্য Desktop 1440px ও Mobile 390px —
> দুই viewport, এবং প্রতিটিতে দুই অবস্থা: **খালি ডেটা** (নতুন/ফাঁকা
> org বা filter-এ শূন্য ফল) ও **ভরা ডেটা** (আসল tenant ডেটা)।
> সমস্যা পেলে বাক্সের পাশে তারিখসহ নোট; fix হলে নতুন screenshot
> দিয়ে আবার যাচাই।

## সাধারণ (সব page-এ)

- [ ] কোনো লেখা card/table-এর বাইরে overflow বা কাটা যাচ্ছে না
- [ ] Dark theme-এ ছোট লেখা (text-slate-500) পড়া যায়
- [ ] Loading অবস্থায় skeleton/লোড-বার্তা দেখা যায় — ফাঁকা ঝলক নেই
- [ ] API ব্যর্থ হলে (DevTools-এ offline করে) ErrorState + 'আবার চেষ্টা করুন' আসে, অসীম 'লোড হচ্ছে…' নয়
- [ ] Button/input touch target mobile-এ চাপা যায় এমন আকারের

## Shell — Navigation, Palette, Bell, Badges (ADX2/ADX3)

- [ ] Sidebar: ৭টি group-ই দেখা যায়; সক্রিয় page-এর group নিজে থেকে খোলা থাকে
- [ ] Group ভাঁজ/খোলা: অবস্থা page বদলেও মনে থাকে (localStorage); ভাঁজ করা group-এ badge মোট সংখ্যা দেখা যায়
- [ ] প্রতিটি মেনু item-এ আলাদা SVG icon — emoji icon নেই, কোনো দুটো item-এ একই icon নয়
- [ ] Badge: Payouts/Tickets/Health/Alerts/Billing-এ আসল সংখ্যা — সংশ্লিষ্ট page-এর সংখ্যার সঙ্গে হুবহু মেলে; সংখ্যা ০ বা unavailable হলে badge নেই
- [ ] ⭐ প্রিয়: item-এর পাশের তারা চাপলে প্রিয় section-এ আসে; আবার চাপলে সরে যায়; reload-এর পরও থাকে
- [ ] প্রিয় খালি থাকলে hint লেখাটি দেখা যায় (ADX14) এবং প্রথম pin-এর পর অদৃশ্য হয়
- [ ] 🕘 সাম্প্রতিক: ঘোরা page-গুলো সর্বোচ্চ ৫টি, সর্বশেষ আগে
- [ ] Collapsed sidebar: icon-only অবস্থায় tooltip আসে, badge bubble দেখা যায়, সব item-এ পৌঁছানো যায়
- [ ] Mobile drawer: একই মেনু (group/badge/প্রিয়সহ), খোলে-বন্ধ হয়, item চাপলে drawer বন্ধ হয়
- [ ] Ctrl+K / Cmd+K: palette খোলে; page-এর নাম লিখলে ফল আসে; ↑/↓ + Enter-এ যাওয়া যায়; ESC-তে বন্ধ
- [ ] Palette-এ entity খোঁজ: user/org নামে আসল ফলাফল (existing /admin/search) আসে, ক্লিকে detail page খোলে
- [ ] Attention Bell: মোট সংখ্যা badge-গুলোর যোগফলের সঙ্গে মেলে; dropdown-এ প্রতিটি queue-র link কাজ করে
- [ ] Attention Bell: সব count সত্যিই ০ হলে dropdown-এ 'কোনো করণীয় নেই'; API বন্ধ থাকলে bell-ই দেখা যায় না (ভুয়া all-clear নয়)
- [ ] Topbar search form আগের মতোই /search-এ নিয়ে যায়
- [ ] Density toggle (ADX14): Compact চাপলে সব table ঘন হয়, reload-এর পরও থাকে; স্বাভাবিক-এ ফেরালে আগের মতো

## Route ধরে ধরে — Desktop × Mobile × (খালি / ভরা ডেটা)

### 1. `/` — Command Center
দেখার বিষয়: আজকের করণীয় সারি, KPI card, timeline, quick actions
- [ ] Desktop 1440 · ভরা ডেটা: Command Center — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Command Center — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Command Center — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Command Center — EmptyState পড়া যায়, action button চাপা যায়

### 2. `/analytics` — Analytics
দেখার বিষয়: KPI strip, মাসের বার চার্ট ও table, Top Tenant, Health Score, AI খরচ, Onboarding board
- [ ] Desktop 1440 · ভরা ডেটা: Analytics — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Analytics — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Analytics — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Analytics — EmptyState পড়া যায়, action button চাপা যায়

### 3. `/users` — Users তালিকা
দেখার বিষয়: FilterBar, sortable table, দ্রুত-দেখুন drawer
- [ ] Desktop 1440 · ভরা ডেটা: Users তালিকা — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Users তালিকা — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Users তালিকা — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Users তালিকা — EmptyState পড়া যায়, action button চাপা যায়

### 4. `/users/[id]` — User Detail
দেখার বিষয়: sticky action header, Tabs (সারসংক্ষেপ/কার্যকলাপ/নোট), Breadcrumb
- [ ] Desktop 1440 · ভরা ডেটা: User Detail — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: User Detail — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: User Detail — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: User Detail — EmptyState পড়া যায়, action button চাপা যায়

### 5. `/orgs` — Organizations তালিকা
দেখার বিষয়: FilterBar, bulk bar, sortable table, দ্রুত-দেখুন drawer
- [ ] Desktop 1440 · ভরা ডেটা: Organizations তালিকা — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Organizations তালিকা — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Organizations তালিকা — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Organizations তালিকা — EmptyState পড়া যায়, action button চাপা যায়

### 6. `/orgs/[id]` — Org Detail
দেখার বিষয়: sticky action header, Tabs (সারসংক্ষেপ/Billing ও Limit/কার্যকলাপ/নোট), Breadcrumb
- [ ] Desktop 1440 · ভরা ডেটা: Org Detail — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Org Detail — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Org Detail — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Org Detail — EmptyState পড়া যায়, action button চাপা যায়

### 7. `/billing` — SaaS Billing
দেখার বিষয়: KPI strip, Tabs (Subscriptions/Invoices ও Manual Payment/Dunning)
- [ ] Desktop 1440 · ভরা ডেটা: SaaS Billing — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: SaaS Billing — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: SaaS Billing — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: SaaS Billing — EmptyState পড়া যায়, action button চাপা যায়

### 8. `/payouts` — Wallet Payouts
দেখার বিষয়: queue table (ধাপ column, four-eyes flag), ConfirmModal, Adjustment form
- [ ] Desktop 1440 · ভরা ডেটা: Wallet Payouts — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Wallet Payouts — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Wallet Payouts — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Wallet Payouts — EmptyState পড়া যায়, action button চাপা যায়

### 9. `/usage` — Usage & Cost
দেখার বিষয়: sortable ranking table, AI-by-feature section
- [ ] Desktop 1440 · ভরা ডেটা: Usage & Cost — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Usage & Cost — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Usage & Cost — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Usage & Cost — EmptyState পড়া যায়, action button চাপা যায়

### 10. `/tickets` — Support Tickets
দেখার বিষয়: inbox master-detail, status filter chips, reply box
- [ ] Desktop 1440 · ভরা ডেটা: Support Tickets — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Support Tickets — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Support Tickets — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Support Tickets — EmptyState পড়া যায়, action button চাপা যায়

### 11. `/audit` — Audit Trail
দেখার বিষয়: FilterBar, table, detail drawer, CSV export
- [ ] Desktop 1440 · ভরা ডেটা: Audit Trail — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Audit Trail — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Audit Trail — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Audit Trail — EmptyState পড়া যায়, action button চাপা যায়

### 12. `/settings` — Settings & Config Hub
দেখার বিষয়: sub-nav + ৭ section (আলাদা section-এ নিচে পূর্ণ যাচাইও আছে)
- [ ] Desktop 1440 · ভরা ডেটা: Settings & Config Hub — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Settings & Config Hub — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Settings & Config Hub — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Settings & Config Hub — EmptyState পড়া যায়, action button চাপা যায়

### 13. `/health` — Platform Health
দেখার বিষয়: traffic-light strip (এক নজরে), Integrations/Jobs/Connections/Scheduled Jobs cards
- [ ] Desktop 1440 · ভরা ডেটা: Platform Health — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Platform Health — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Platform Health — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Platform Health — EmptyState পড়া যায়, action button চাপা যায়

### 14. `/social-ops` — Social & Ads Ops
দেখার বিষয়: Social section ও Ad section (failed first), row retry
- [ ] Desktop 1440 · ভরা ডেটা: Social & Ads Ops — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Social & Ads Ops — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Social & Ads Ops — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Social & Ads Ops — EmptyState পড়া যায়, action button চাপা যায়

### 15. `/alerts` — Proactive Alerts
দেখার বিষয়: severity group (HIGH/MEDIUM), Nudge buttons
- [ ] Desktop 1440 · ভরা ডেটা: Proactive Alerts — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Proactive Alerts — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Proactive Alerts — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Proactive Alerts — EmptyState পড়া যায়, action button চাপা যায়

### 16. `/system` — System & Reliability
দেখার বিষয়: Tabs (Deploy/Queues/Errors/Backup/Webhooks/Activity Log), page-level deploy banner
- [ ] Desktop 1440 · ভরা ডেটা: System & Reliability — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: System & Reliability — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: System & Reliability — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: System & Reliability — EmptyState পড়া যায়, action button চাপা যায়

### 17. `/growth` — Growth Ops
দেখার বিষয়: Tabs (Campaigns/Referrals/Changelog/Feedback)
- [ ] Desktop 1440 · ভরা ডেটা: Growth Ops — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Growth Ops — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Growth Ops — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Growth Ops — EmptyState পড়া যায়, action button চাপা যায়

### 18. `/security` — Security
দেখার বিষয়: Tabs (Allowlist ও TOTP/Sessions/Admin Access)
- [ ] Desktop 1440 · ভরা ডেটা: Security — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Security — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Security — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Security — EmptyState পড়া যায়, action button চাপা যায়

### 19. `/admins` — Admins রোস্টার
দেখার বিষয়: roster table (mobile-এ card form — ADX12)
- [ ] Desktop 1440 · ভরা ডেটা: Admins রোস্টার — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Admins রোস্টার — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Admins রোস্টার — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Admins রোস্টার — EmptyState পড়া যায়, action button চাপা যায়

### 20. `/search` — Search
দেখার বিষয়: Users/Organizations/Orders — তিন কলামের ফলাফল
- [ ] Desktop 1440 · ভরা ডেটা: Search — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Search — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Search — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Search — EmptyState পড়া যায়, action button চাপা যায়

### 21. `/login` — Login
দেখার বিষয়: split-screen form
- [ ] Desktop 1440 · ভরা ডেটা: Login — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Login — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Login — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Login — EmptyState পড়া যায়, action button চাপা যায়

### 22. `/login/totp` — Login TOTP
দেখার বিষয়: ৬-সংখ্যার code form
- [ ] Desktop 1440 · ভরা ডেটা: Login TOTP — সব section/card ঠিকঠাক বসেছে, কিছু ভাঙেনি
- [ ] Desktop 1440 · খালি ডেটা: Login TOTP — EmptyState/খালি-বার্তা ঠিক আসে, ভাঙা layout নয়
- [ ] Mobile 390 · ভরা ডেটা: Login TOTP — স্তূপ/scroll ঠিক আছে, কোনো crush/overflow নেই
- [ ] Mobile 390 · খালি ডেটা: Login TOTP — EmptyState পড়া যায়, action button চাপা যায়

বিশেষ mobile যাচাই (ADX12):

- [ ] /admins: Mobile 390-এ roster table card-আকারে আসে — প্রতিটি ঘরে column-নাম (data-label) দেখা যায়, Tier/TOTP badge ঠিক থাকে
- [ ] /users, /orgs, /audit: Mobile-এ FilterBar '🔎 ফিল্টার' toggle-এ ভাঁজ হয়; খুললে সব filter ব্যবহার করা যায়; Desktop-এ সবসময় খোলা
- [ ] /users, /orgs: Mobile-এ বাকি table horizontal scroll-ই আছে (card form করা হয়নি — নকশা অনুযায়ী)
- [ ] /tickets: Mobile-এ ticket বাছলে তালিকা লুকিয়ে conversation আসে; '← তালিকায় ফিরুন' কাজ করে

## Settings Config Hub — Section ও Hash যাচাই (ADX9)

- [ ] /settings#ai সরাসরি খুললে AI ও মিডিয়া section সক্রিয় থাকে
- [ ] /settings#apps, #messaging, #payment, #flags, #announce, #general — প্রতিটি hash-এ সঠিক section খোলে
- [ ] /settings#payment-bkash: Payment section খোলে, bKash block দৃশ্যমান হয় ও highlight ring আসে (কয়েক সেকেন্ডে মিলিয়ে যায়)
- [ ] /settings#apps-meta, #messaging-smtp, #ai-llm, #payment-wallet — alias hash-গুলোও সঠিক block-এ পৌঁছায়
- [ ] Section বদলালেও অন্য section-এর ফর্মে লিখে রাখা (unsaved) লেখা হারায় না (সব section mounted থাকে)
- [ ] Sub-nav click-এ URL-এর hash বদলায় — link copy করে অন্য tab-এ খুললে একই section আসে
- [ ] প্রতিটি config block-এ source badge (Admin Console থেকে সেট / Server Env / সেট করা নেই) payload-এর সঙ্গে মেলে

## ৫টি Journey — লক্ষ্য ধাপ মাপা (ADX1 architecture অনুযায়ী)

গণনা পদ্ধতি architecture doc §৬-এর মতোই: ১ ধাপ = ১ navigation click,
১ in-page locate (খোঁজা/scroll), অথবা ১ action click। প্রতিটি journey
আসল browser-এ করে ধাপ গুনে লিখতে হবে; লক্ষ্য ছাড়ালে বাক্স টেকা যাবে না।

- [ ] J1 সকালের যাচাই — লক্ষ্য ১ glance (+১/drill-down): Login → Command Center: badge/bell দেখেই পাঁচ queue-র অবস্থা জানা যায়, কোনো page না খুলে · মাপা ধাপ: ____
- [ ] J2 Payout অনুমোদন — লক্ষ্য ৩ ধাপ: Bell/Payouts badge → queue-তে pending সবার ওপরে → Approve → ConfirmModal-এ নিশ্চিত · মাপা ধাপ: ____
- [ ] J3 Ticket সামলানো — লক্ষ্য ৪ ধাপ: Tickets badge → Tickets → ওপরের ticket খোলা → একই জায়গায় reply পাঠানো (page বদল ছাড়া) · মাপা ধাপ: ____
- [ ] J4 Config বদল — লক্ষ্য ৩ ধাপ: Ctrl+K 'bkash' অথবা /settings#payment-bkash link → bKash block সামনে → Save → Test · মাপা ধাপ: ____
- [ ] J5 সমস্যা খোঁজা — লক্ষ্য ৩ ধাপ: Health badge/bell → Health → traffic-light strip-এ ব্যর্থ অংশ চিহ্নিত → Retry; অথবা Ctrl+K দিয়ে org খুঁজে detail (Breadcrumb দেখা যায়) · মাপা ধাপ: ____

## Saved Views (ADX14)

- [ ] /users: filter+search সেট করে নাম দিয়ে view সেভ; অন্য filter বদলে view চাপলে হুবহু আগের অবস্থা ফেরে; reload-এর পরও view থাকে
- [ ] /orgs: একই loop (q + status + plan)
- [ ] /audit: একই loop (prefix/org/actor/entity/date/take)
- [ ] /tickets: status filter view সেভ/apply/delete কাজ করে
- [ ] View মুছলে তালিকা থেকে সরে যায়; ভাঙা/পুরনো localStorage মান থাকলেও page ভাঙে না (default অবস্থায় খোলে)
- [ ] localStorage বন্ধ (private mode) থাকলেও কোনো page-এ error আসে না — personalization নীরবে অনুপস্থিত থাকে

## Sign-off

- [ ] সব route × viewport × অবস্থা screenshot তোলা ও ওপরের বাক্স টেকা হয়েছে
- [ ] ৫টি journey-র মাপা ধাপ লক্ষ্যের মধ্যে (বা বেশি হলে কারণ লিখে রাখা হয়েছে)
- [ ] ধরা পড়া visual bug-গুলো এই doc-তে তালিকাভুক্ত; fix হলে পুনঃscreenshot দিয়ে যাচাই
- [ ] QA চালিয়েছেন: ____________ · তারিখ: ____________ · Build/Commit: ____________
- [ ] মালিকের sign-off: ____________

---
*এই checklist-এর একটি বাক্সও এখন টেকা নয়। Execution deploy-গated —
push ও Redeploy মালিকের হাতে।*
