# Admin Screenshot QA Checklist (AN10) — সব বাক্স UNCHECKED

> **অবস্থা: এই checklist শুধু তৈরি হয়েছে — কোনো screenshot এখনো তোলা
> হয়নি, কোনো QA হয়নি।** আসল QA চলবে শুধুমাত্র এই build (integration-5
> + AB2) deploy হওয়ার পরে — অর্থাৎ মালিকের GitHub push + Dokploy
> Redeploy-এর পর, live admin.qosprey.com-এ, আসল browser-এ।
> তার আগে কোনো page-কেই "দেখে যাচাই করা" বলা যাবে না।
>
> পদ্ধতি (SD8-এর ধাঁচে): প্রতিটি page-এর জন্য Desktop 1440px ও
> Mobile 390px — দুই viewport-এ screenshot; নিচের "যা দেখতে হবে"
> মিলিয়ে দেখা; সমস্যা পেলে এই doc-তেই পাশে লিখে রাখা, fix হলে
> তারিখসহ টিক। QA-তে ধরা পড়া visual bug-এর fix AB2 batch-এর মধ্যেই
> হবে — নতুন feature এই QA থেকে আসবে না।

## সাধারণ (সব page-এ)

- [ ] Sidebar/drawer: mobile-এ drawer খোলে-বন্ধ হয়, desktop-এ collapse ঠিক আছে
- [ ] Table: mobile-এ crush না হয়ে horizontal scroll হচ্ছে (globals.css নিয়ম)
- [ ] কোনো লেখা card-এর বাইরে overflow / কাটা যাচ্ছে না
- [ ] Button/input touch target হাতে চাপা যায় এমন আকারের
- [ ] Dark theme-এ contrast পড়া যায় (বিশেষ করে text-slate-500 ছোট লেখা)

## Page ধরে ধরে

### 1. `/` — Command Center (Overview)
- [ ] Desktop 1440: KPI stat card সারি, failed-jobs attention panel, activity timeline, quick action — কোনোটা ভাঙা নয়
- [ ] Mobile 390: KPI card এক কলামে স্তূপ, DB status pill ভাঙেনি, timeline-এর সময় (fmtDateTime) ঠিকঠাক বসেছে

### 2. `/login`
- [ ] Desktop 1440: split-screen layout দুই অংশ সমান, form মাঝখানে
- [ ] Mobile 390: এক কলামে form পড়া/ভরা যায়, button পুরো চওড়া

### 3. `/login/totp` (AB2-তে বদল হয়েছে)
- [ ] Desktop 1440: শিরোনাম sm:text-2xl হয়েছে, card মাঝখানে
- [ ] Mobile 390: ৬-ঘরের code input-এ tracking ছড়িয়ে overflow হয়নি, container padding ঠিক

### 4. `/users` — User তালিকা (AB2-তে বদল)
- [ ] Desktop 1440: search সারি এক লাইনে (input + খুঁজুন button)
- [ ] Mobile 390: search input ও button আলাদা সারিতে স্তূপ, table scroll হচ্ছে, শেষ লগইন/যোগের তারিখ ঠিক ফরম্যাটে

### 5. `/users/[id]` — User detail
- [ ] Desktop 1440: status/grant/revoke/reset action, notes তালিকা (তারিখসহ) ঠিক আছে
- [ ] Mobile 390: detail সারিগুলো ভাঙেনি, audit trail-এর তারিখ ডানদিকে বসেছে

### 6. `/orgs` — Organization তালিকা (AB2-তে বদল)
- [ ] Desktop 1440: search সারি এক লাইনে; বাছাই করলে bulk bar উপরে আসে
- [ ] Mobile 390: search স্তূপ আকারে, bulk bar-এর button-গুলো wrap হয়ে ভাঙেনি, তৈরি-তারিখ date ফরম্যাটে

### 7. `/orgs/[id]` — Org detail
- [ ] Desktop 1440: subscription/flags/limits/notes/support-view/timeline/View-As সব panel বসেছে
- [ ] Mobile 390: দুই-কলাম grid এক কলামে নেমেছে, timeline-এর সময় ঠিক আছে

### 8. `/billing`
- [ ] Desktop 1440: summary card, payment table, coupon/dunning অংশ — টাকার অঙ্ক ও তারিখ ঠিক
- [ ] Mobile 390: card grid স্তূপ, payment table scroll, invoice button চাপা যায়

### 9. `/payouts` — Wallet Payouts (AB2-তে বদল)
- [ ] Desktop 1440: status select ডানদিকে auto-width, table-এর action button পাশাপাশি
- [ ] Mobile 390: status select পুরো চওড়া, Adjustment form-এর submit button পুরো চওড়া, table scroll

### 10. `/tickets` — Support Tickets (AB2-তে বড় বদল)
- [ ] Desktop 1440: **তালিকা ও detail পাশাপাশি দুই কলামে** (আগে `.grid2` class defined-ই ছিল না — এবারই প্রথম আসল দুই-কলাম হওয়ার কথা, বিশেষ করে যাচাই করতে হবে)
- [ ] Mobile 390: detail তালিকার নিচে, reply textarea ও পাঠান বোতাম স্তূপ আকারে, message bubble-এর পাশের ফাঁক (inline style 32px) পড়া বাধা দিচ্ছে কিনা

### 11. `/audit` — Audit Trail (AB2-তে বদল)
- [ ] Desktop 1440: filter সারি এক লাইনে — prefix select, ID input, তারিখ, Take, CSV button
- [ ] Mobile 390: প্রতিটি filter পুরো চওড়া হয়ে একটার নিচে একটা, CSV button পুরো চওড়া, table scroll, সময়ের ফরম্যাট ঠিক

### 12. `/analytics`
- [ ] Desktop 1440: 12-মাস series, top tenant, health score, AI cost + rate editor ঠিকঠাক
- [ ] Mobile 390: stat grid স্তূপ, chart/table crush হয়নি

### 13. `/usage` — Usage & Cost (AB2-তে বদল)
- [ ] Desktop 1440: AI by Feature filter input 256px (!w-64 sm-এ), days select ও CSV button এক সারিতে
- [ ] Mobile 390: filter input পুরো চওড়া (আগে fixed 256px ছিল), header সারি wrap হয়ে ভাঙেনি, দুটো table-ই scroll

### 14. `/health`
- [ ] Desktop 1440: failed sync, scheduled job, integration board, retry button
- [ ] Mobile 390: দুই-কলাম grid এক কলামে, job-এর সময় ফরম্যাট ঠিক

### 15. `/alerts` — Proactive Alerts (AB2-তে বদল)
- [ ] Desktop 1440: alert card এক সারিতে — badge, বিবরণ, Org/Nudge button পাশাপাশি
- [ ] Mobile 390: card column আকারে স্তূপ, তিনটে action button-ই পুরো চওড়া হয়ে একটার নিচে একটা, লেখা পড়া যাচ্ছে

### 16. `/admins` — Admins Roster (AB2-তে বদল)
- [ ] Desktop 1440: roster table, TOTP সতর্কতা banner, tier badge ঠিক
- [ ] Mobile 390: লম্বা email ভেঙে (break-all) cell-এর মধ্যে থাকে, table scroll, লাল সতর্কতা সারি চেনা যায়

### 17. `/security`
- [ ] Desktop 1440: TOTP enrol, View-As session, API key, IP allowlist, login anomaly — সব অংশ
- [ ] Mobile 390: grid এক কলামে, শেষ লগইন/মেয়াদের সময় ফরম্যাট ঠিক, key তালিকা overflow হয়নি

### 18. `/settings` — Settings + Dynamic Platform Config
- [ ] Desktop 1440: ১১টা config card (LinkedIn সহ — AN1), Wallet card-এ fee + four-eyes ঘর ও নতুন ব্যাখ্যা-লাইন (AN11) পড়া যাচ্ছে
- [ ] Mobile 390: card grid এক কলামে, লম্বা callback URL <code> ভেঙে বাইরে যাচ্ছে না, announcement তালিকার তারিখ ঠিক

### 19. `/growth`
- [ ] Desktop 1440: campaign তালিকা, changelog, referral, feedback — তারিখ ও টাকার ফরম্যাট ঠিক
- [ ] Mobile 390: grid গুলো স্তূপ, campaign সারির তারিখ কাটা যাচ্ছে না

### 20. `/social-ops`
- [ ] Desktop 1440: social ও ads board, মোট সংখ্যা bn-BD সংখ্যা-ফরম্যাটে (এটি date helper-এর বাইরে — আগের মতোই থাকার কথা)
- [ ] Mobile 390: board গুলো স্তূপ, শেষ check-এর সময় ঠিক ফরম্যাটে

### 21. `/system` — System & Reliability
- [ ] Desktop 1440: env-check, version/uptime, queue, webhook, DLQ, backup panel — সব অংশ ও সময়ের ফরম্যাট
- [ ] Mobile 390: অংশগুলো স্তূপ, queue যাচাইয়ের সময় (time ফরম্যাট) ঠিক, log table scroll

### 22. `/search`
- [ ] Desktop 1440: user/org/order ফলাফল grid তিন কলামে
- [ ] Mobile 390: ফলাফল এক কলামে, খালি ফলাফলে সৎ বার্তা

---

## ফলাফল লেখার জায়গা (QA-র সময় ভরতে হবে)

| Page | Desktop | Mobile | পাওয়া সমস্যা | Fix commit |
|---|---|---|---|---|
| (QA হয়নি — deploy-এর পর ভরা হবে) | — | — | — | — |
