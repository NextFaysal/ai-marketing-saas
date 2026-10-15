# AN17 — Release-Day Admin Setup (integration-5 deploy-এর দিনের তালিকা)

Admin Next AB4 · এই checklist তখনই চলবে যখন integration-5 build
(AN1–AN3 সহ) মালিকের push + Dokploy Redeploy দিয়ে live হবে।
ক্রম অনুযায়ী সাজানো; প্রতিটি ধাপ checkbox। যেসব ধাপ তৃতীয়
পক্ষের approval-এ আটকে থাকে, সেগুলোতে **[তৃতীয় পক্ষের
approval-নির্ভর]** চিহ্ন আছে — সেগুলো আটকে থাকা bug নয়।

## ধাপ ১ — LinkedIn Platform App (AN1)

- [ ] Admin → **Settings → 💼 LinkedIn App** কার্ডে platform-এর
  LinkedIn App-এর Client ID ও Client Secret বসান (মালিক নিজে
  বসাবেন; secret কখনো chat-এ নয়)।
- [ ] **Test** বোতামে যাচাই করুন — এটি client-auth probe;
  pass মানে credential জোড়া LinkedIn চিনেছে। এটি Community
  Management API approval প্রমাণ করে না (ধাপ ২ দেখুন)।
- [ ] LinkedIn Developer Portal-এ ওই App-এর Auth সেটিংসে এই
  Redirect URI নিবন্ধন করুন:
  `https://api.qosprey.com/social/oauth/linkedin/callback`
- [ ] যাচাই: tenant Dashboard → Connections থেকে একটি LinkedIn
  Page connect চেষ্টা করে দেখুন — OAuth ঘুরে এসে account বাছাই
  (pick) পর্যন্ত যায় কিনা।

## ধাপ ২ — LinkedIn Community Management API Approval **[তৃতীয় পক্ষের approval-নির্ভর]**

- [ ] LinkedIn-এর কাছে Community Management API access-এর
  আবেদন করুন (আলাদা track — এই release-এর অংশ নয়)।
- [ ] মনে রাখবেন: এই approval না এলে LinkedIn-এ **post publish
  প্রত্যাখ্যানই থাকবে** — সেটি প্রত্যাশিত আচরণ, bug নয়।
  Connect (account যুক্ত করা) approval ছাড়াই চলার কথা।

## ধাপ ৩ — Google Pack: Redirect URI + API Enable

একই platform Google App-এ (Admin → Settings → Google কার্ডে
যেটি বসানো আছে):

- [ ] Google Cloud Console → ওই OAuth Client-এ এই ৩টি Redirect
  URI নিবন্ধন করুন:
  - [ ] `https://api.qosprey.com/social/oauth/google-ga4/callback`
  - [ ] `https://api.qosprey.com/social/oauth/google-merchant/callback`
  - [ ] `https://api.qosprey.com/social/oauth/google-business/callback`
- [ ] Google Cloud Console → APIs & Services-এ এই ৩টি API
  enable করুন:
  - [ ] Google Analytics Admin API
  - [ ] Merchant API
  - [ ] Google Business Profile API
- [ ] যাচাই: tenant Dashboard → Connections থেকে GA4 / Merchant /
  Business Profile — যেকোনো একটি connect চেষ্টা করুন; account
  picker পর্যন্ত যাওয়া চাই। কোনো API enable না থাকলে Google
  নিজেই error দেখাবে — সেটি verbatim পড়ে বুঝুন কোনটি বাকি।

## ধাপ ৪ — Per-Org Job Enable (প্রতিটি live org-এর জন্য)

জায়গা: **tenant Dashboard → Automations → "রেডিমেড ব্লুপ্রিন্ট
ও টেমপ্লেট" অংশ** — টেমপ্লেট Install করলেই ওই org-এর Job তৈরি
হয়ে enable হয় (আলাদা Admin পেজ থেকে নয়)।

- [ ] **Connection Health Sweep (টেমপ্লেট)**
  (`connection_health_sweep`, প্রতি ৬০ মিনিট) — Install করুন।
  এটি ছাড়া CC12 monitoring/alert চলবে না, আর Admin-এর AN15
  Connection Health Board-এ তথ্য জমবে না।
- [ ] **Wallet Payout Sweep (টেমপ্লেট)**
  (`wallet_payout_sweep`, প্রতি ২৪ ঘণ্টা) — Install করুন।
  এটি CC26 payout automation-এর schedule চালায় (request তৈরি
  করে মাত্র — approve/mark-paid আগের মতোই মানুষের হাতে)।
- [ ] যেসব org-এ Wallet/platform payment চালু নেই, সেখানে
  Wallet Payout Sweep ইনস্টল না করলেও ক্ষতি নেই — সিদ্ধান্তটি
  org ধরে লিখে রাখুন।

## ধাপ ৫ — Four-Eyes সীমার চূড়ান্ত মান (AN3)

- [ ] Admin → **Settings → Wallet কার্ড → "Four-eyes payout
  সীমা"** ঘরে চূড়ান্ত মান বসান।
  - মান (minor unit-এ): ______________ *(মালিক পূরণ করবেন —
    এই নথিতে কোনো মান প্রস্তাব করা হয়নি। খালি রাখলে নিয়ম
    বন্ধই থাকবে।)*
- [ ] যাচাই: সীমার ওপরে একটি payout approve → mark-paid অন্য
  admin দিয়ে করতে হয় কিনা দেখুন; সীমার নিচের payout আগের
  মতোই চলবে।

## ধাপ ৬ — CC28 Tenant-নিজের-App নির্দেশনা যাচাই

যাচাই শেষ (এই নথি লেখার সময়েই code-এ মিলিয়ে দেখা হয়েছে):
নির্দেশনা **আছেই** — নতুন UI লেখার দরকার নেই।

- জায়গা: **tenant Dashboard → Connections → "নিজের Google
  অ্যাপ" কার্ড** — note-এ Google Cloud Console-এ নিবন্ধন করা
  বাধ্যতামূলক Redirect URI-গুলো তালিকা আকারে দেখায় (API-র
  guide থেকে আসে)।
- জায়গা: **tenant Dashboard → Connections → "নিজের LinkedIn
  অ্যাপ" কার্ড** — note-এ Auth সেটিংসে নিবন্ধনের Callback
  URL দেখায়।
- [ ] Deploy-এর পর live-এ একবার চোখে দেখুন: দুটি কার্ডেই
  URI-গুলো লোড হচ্ছে কিনা (লোড না হলে কার্ড নিজেই "(লোড
  হয়নি — পেজটি আবার লোড করুন)" দেখায়)।

## শেষ যাচাই

- [ ] Admin → **Health → Connection Health Board**: sweep চলার
  পর (ধাপ ৪) check record জমতে শুরু করেছে কিনা — তার আগে
  সব connection "তথ্য নেই" দেখানোই সঠিক।
- [ ] Admin → System → Deploy Readiness-এ নতুন করে একবার চোখ
  বুলিয়ে নিন (env তালিকা অপরিবর্তিত আছে কিনা)।
- [ ] এই checklist-এর কোন ধাপ বাকি থাকলে, সেটি এই নথিতেই
  অ-টিক অবস্থায় রেখে দিন — হয়নি এমন ধাপ "হয়ে গেছে" বলা
  যাবে না।
